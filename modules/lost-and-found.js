/**
 * LostAndFound - Orphaned chat reference detection and reconciliation
 *
 * Detects stored chat keys (pins, folder assignments) that no longer
 * resolve in the live chat index, finds candidate replacements by
 * matching on the stable avatar component, and provides resolution APIs
 * for relinking, removing, or skipping orphaned entries.
 *
 * Replaces the old silent-delete approach (cleanOrphanedPins /
 * cleanOrphanedAssignments for chat-key orphans) with a user-driven
 * reconciliation flow. Folder-ID orphans (assignments pointing to
 * deleted folders) are a separate concern handled by FolderSystemManager.
 *
 * @module LostAndFound
 */

import * as CoreAPI from './core-api.js';
import * as ChatIdentifier from '../utils/chat-identifier.js';

/**
 * Maximum age of a snapshot for which we will spend time fetching candidate
 * messages to look for an exact-text match. Snapshots older than this are
 * unlikely to reflect any message still present in the live chat file, and
 * scanning ancient candidates wastes network time.
 */
const SNAPSHOT_MATCH_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Acceptance window around a snapshot's `updatedAt` timestamp. A candidate
 * message whose timestamp falls outside this window is not considered an
 * exact match even if its text is identical.
 */
const SNAPSHOT_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

export class LostAndFound {
    constructor() {
        /** @type {OrphanReport|null} Last detection result, cached for UI */
        this._lastReport = null;
    }

    // ─────────────────────────────────────────
    // DETECTION
    // ─────────────────────────────────────────

    /**
     * Scan all stored chat keys (pins + folder assignments) and identify
     * those that no longer exist in the ChatRepository cache.
     *
     * Caller MUST ensure ChatRepository.fetchAllChats() has completed
     * before calling this (the coordinator guarantees this in Phase 2).
     *
     * @returns {OrphanReport}
     *
     * @typedef {Object} OrphanReport
     * @property {OrphanRecord[]} orphans
     * @property {number} totalPins      - Total pinned keys scanned
     * @property {number} totalFolderKeys - Total chat-folder keys scanned
     *
     * @typedef {Object} OrphanRecord
     * @property {string}   chatKey   - The orphaned chat key
     * @property {string}   avatar    - Avatar extracted from key
     * @property {string}   fileName  - Filename extracted from key
     * @property {string[]} sources   - Where the orphan was found: 'pin' | 'folder'
     * @property {string[]} folderIds - Folder IDs the orphan was assigned to (empty if pin-only)
     */
    detectOrphanedReferences() {
        const chatRepository = CoreAPI.getModule('ChatRepository');
        const stateManager = CoreAPI.getModule('StateManager');

        if (!chatRepository || !stateManager) {
            console.error('[ChatPlus2] LostAndFound: required modules not available');
            return { orphans: [], totalPins: 0, totalFolderKeys: 0 };
        }

        const pinnedChats = stateManager.get('pinnedChats') || [];
        const chatFolders = stateManager.get('chatFolders') || {};

        // Collect all orphaned keys into a Map for merging duplicates
        /** @type {Map<string, OrphanRecord>} */
        const orphanMap = new Map();

        const addOrphan = (chatKey, source, folderIds = []) => {
            if (orphanMap.has(chatKey)) {
                const existing = orphanMap.get(chatKey);
                if (!existing.sources.includes(source)) {
                    existing.sources.push(source);
                }
                for (const id of folderIds) {
                    if (!existing.folderIds.includes(id)) {
                        existing.folderIds.push(id);
                    }
                }
            } else {
                const avatar = ChatIdentifier.extractAvatarFromKey(chatKey);
                const fileName = ChatIdentifier.extractFileNameFromKey(chatKey);
                orphanMap.set(chatKey, {
                    chatKey,
                    avatar,
                    fileName,
                    sources: [source],
                    folderIds: [...folderIds],
                });
            }
        };

        // Scan pins
        for (const key of pinnedChats) {
            if (!chatRepository.getChatByKey(key)) {
                addOrphan(key, 'pin');
            }
        }

        // Scan folder assignments
        for (const key of Object.keys(chatFolders)) {
            if (!chatRepository.getChatByKey(key)) {
                addOrphan(key, 'folder', chatFolders[key]);
            }
        }

        const report = {
            orphans: Array.from(orphanMap.values()),
            totalPins: pinnedChats.length,
            totalFolderKeys: Object.keys(chatFolders).length,
        };

        this._lastReport = report;

        if (report.orphans.length > 0) {
            console.debug(
                `[ChatPlus2] LostAndFound: detected ${report.orphans.length} orphan(s)`,
                report.orphans.map(o => o.chatKey)
            );
        }

        return report;
    }

    /**
     * Get the last detection report without re-scanning.
     * @returns {OrphanReport|null}
     */
    getLastReport() {
        return this._lastReport;
    }

    // ─────────────────────────────────────────
    // CANDIDATE MATCHING
    // ─────────────────────────────────────────

    /**
     * Find candidate replacement chats for a single orphan.
     * Matches on the avatar component (stable across renames) and uses
     * filename prefix similarity for confidence scoring.
     *
     * @param {OrphanRecord} orphan
     * @returns {CandidateMatch[]}
     *
     * @typedef {Object} CandidateMatch
     * @property {string} chatKey        - Live chat key
     * @property {string} fileName       - Live chat filename
     * @property {string} characterName  - Display name
     * @property {string|null} lastMessage - Last message preview
     * @property {string|null} lastMessageDate - Date string for sorting
     * @property {'exact'|'high'|'medium'|'low'} confidence
     */
    findCandidates(orphan) {
        const chatRepository = CoreAPI.getModule('ChatRepository');
        if (!chatRepository) return [];

        const liveChatsByAvatar = chatRepository.getChatsByAvatar(orphan.avatar);

        if (!liveChatsByAvatar || liveChatsByAvatar.length === 0) {
            return [];
        }

        // Build candidate list
        const candidates = liveChatsByAvatar.map(chat => {
            const chatKey = ChatIdentifier.getChatKey(chat);
            return {
                chatKey,
                fileName: chat.file_name,
                characterName: chat.character_name || chat.entity?.name || orphan.avatar,
                lastMessage: chat._stats?.lastMessage || null,
                lastMessageDate: chat._stats?.lastMessageDate || null,
                confidence: this._scoreConfidence(
                    orphan.fileName,
                    chat.file_name,
                    liveChatsByAvatar.length
                ),
            };
        });

        // Sort by most recent first; nulls (no date) sink to the end
        candidates.sort((a, b) => {
            const dateA = a.lastMessageDate;
            const dateB = b.lastMessageDate;
            if (!dateA && !dateB) return 0;
            if (!dateA) return 1;
            if (!dateB) return -1;
            return new Date(dateB) - new Date(dateA);
        });

        return candidates;
    }

    /**
     * Find candidates for all orphans in a single pass, grouping by avatar
     * for efficiency (avoids redundant lookups when multiple orphans share
     * the same avatar).
     *
     * @param {OrphanRecord[]} orphans
     * @returns {Map<string, CandidateMatch[]>} Map of orphanKey → candidates
     */
    findAllCandidates(orphans) {
        /** @type {Map<string, CandidateMatch[]>} */
        const result = new Map();

        for (const orphan of orphans) {
            result.set(orphan.chatKey, this.findCandidates(orphan));
        }

        return result;
    }

    /**
     * Upgrade a single orphan's candidate list with snapshot-assisted exact
     * matching. Returns a new array where any candidate whose chat file
     * contains the snapshot's `lastMessage` within ±24h of `updatedAt`
     * is flagged with `confidence: 'exact'`.
     *
     * Fetches candidate messages via `CoreAPI.fetchChatMessages()` and
     * reuses the modal-scoped `previewCache` so no candidate is fetched
     * twice across the snapshot scan and the live-preview panel.
     *
     * Called only by the resolver. The synchronous `findCandidates()`
     * path is intentionally left untouched so the init-time banner and
     * `findAllCandidates()` remain non-blocking.
     *
     * @param {OrphanRecord} orphan
     * @param {{ lastMessage: string, updatedAt: number }|null} snapshot
     * @param {Map<string, Array<Object>>} previewCache - modal-scoped message cache
     * @returns {Promise<CandidateMatch[]>}
     */
    async findCandidatesWithSnapshotMatch(orphan, snapshot, previewCache) {
        const base = this.findCandidates(orphan);

        if (!snapshot || typeof snapshot.lastMessage !== 'string' || !snapshot.lastMessage) {
            return base;
        }
        if (!Number.isFinite(snapshot.updatedAt)) return base;
        if (Date.now() - snapshot.updatedAt > SNAPSHOT_MATCH_MAX_AGE_MS) {
            return base;
        }
        if (base.length === 0) return base;

        const isGroup = this._isGroupOrphan(orphan);
        const target = snapshot.lastMessage;
        const anchor = snapshot.updatedAt;

        const checks = base.map(async (cand) => {
            try {
                let messages = previewCache.get(cand.chatKey);
                if (!messages) {
                    messages = await CoreAPI.fetchChatMessages(orphan.avatar, cand.fileName, isGroup);
                    previewCache.set(cand.chatKey, messages);
                }
                if (!Array.isArray(messages) || messages.length === 0) return;

                if (this._messagesContainSnapshotMatch(messages, target, anchor)) {
                    cand.confidence = 'exact';
                }
            } catch (err) {
                console.warn(`[ChatPlus2] LostAndFound: snapshot scan failed for ${cand.chatKey}`, err);
            }
        });

        await Promise.allSettled(checks);
        return base;
    }

    /**
     * True if `messages` contains an entry whose `mes` text equals `target`
     * and whose timestamp is within `SNAPSHOT_MATCH_WINDOW_MS` of `anchor`.
     * When no timestamp can be parsed from a candidate message, accept the
     * match only if it is the last message in the array (position-based
     * fallback — mirrors how snapshots are captured).
     *
     * @private
     * @param {Array<Object>} messages
     * @param {string} target
     * @param {number} anchor - ms since epoch
     * @returns {boolean}
     */
    _messagesContainSnapshotMatch(messages, target, anchor) {
        const lastIndex = messages.length - 1;
        for (let i = lastIndex; i >= 0; i--) {
            const msg = messages[i];
            if (!msg || msg.mes !== target) continue;

            const ts = this._parseMessageTimestamp(msg);
            if (ts !== null) {
                if (Math.abs(ts - anchor) <= SNAPSHOT_MATCH_WINDOW_MS) return true;
                continue;
            }

            // No usable timestamp — accept only if this is the tail message
            if (i === lastIndex) return true;
        }
        return false;
    }

    /**
     * Parse a chat message's timestamp to ms-since-epoch. Prefers
     * `gen_started` (ISO-ish, reliable) over `send_date` (humanised).
     *
     * @private
     * @param {{ gen_started?: string, send_date?: string }} msg
     * @returns {number|null}
     */
    _parseMessageTimestamp(msg) {
        if (msg.gen_started) {
            const t = Date.parse(msg.gen_started);
            if (!Number.isNaN(t)) return t;
        }
        if (msg.send_date) {
            const t = Date.parse(msg.send_date);
            if (!Number.isNaN(t)) return t;
        }
        return null;
    }

    // ─────────────────────────────────────────
    // RESOLUTION
    // ─────────────────────────────────────────

    /**
     * Apply a single resolution decision.
     *
     * @param {Resolution} resolution
     * @returns {ResolutionResult}
     *
     * @typedef {Object} Resolution
     * @property {string} orphanKey
     * @property {'relink'|'remove'|'skip'} action
     * @property {string} [newKey] - Required when action is 'relink'
     *
     * @typedef {Object} ResolutionResult
     * @property {boolean} success
     * @property {string}  action
     * @property {string}  orphanKey
     * @property {string}  [newKey]
     * @property {string}  [error]
     */
    applyResolution(resolution) {
        const { orphanKey, action, newKey } = resolution;

        try {
            switch (action) {
                case 'relink':
                    return this._relink(orphanKey, newKey);
                case 'remove':
                    return this._remove(orphanKey);
                case 'skip':
                    return { success: true, action: 'skip', orphanKey };
                default:
                    return { success: false, action, orphanKey, error: `Unknown action: ${action}` };
            }
        } catch (error) {
            console.error(`[ChatPlus2] LostAndFound: resolution failed for ${orphanKey}:`, error);
            return { success: false, action, orphanKey, error: error.message };
        }
    }

    /**
     * Apply a batch of resolutions. Defers save until all are processed.
     *
     * @param {Resolution[]} resolutions
     * @returns {BatchResolutionSummary}
     *
     * @typedef {Object} BatchResolutionSummary
     * @property {number} relinked
     * @property {number} removed
     * @property {number} skipped
     * @property {number} errors
     * @property {ResolutionResult[]} results
     */
    applyBatchResolutions(resolutions) {
        const stateManager = CoreAPI.getModule('StateManager');
        const summary = { relinked: 0, removed: 0, skipped: 0, errors: 0, results: [] };

        for (const resolution of resolutions) {
            const result = this.applyResolution(resolution);
            summary.results.push(result);

            if (!result.success) {
                summary.errors++;
            } else {
                summary[result.action === 'relink' ? 'relinked'
                    : result.action === 'remove' ? 'removed'
                        : 'skipped']++;
            }
        }

        // Single save for the entire batch
        if (summary.relinked > 0 || summary.removed > 0) {
            stateManager?.save(true);
        }

        // Clear cached report — it's now stale
        this._lastReport = null;

        CoreAPI.emit('lost-found-resolved', summary);

        console.debug('[ChatPlus2] LostAndFound: batch resolved', summary);
        return summary;
    }

    /**
     * Convenience: detect orphans, find all candidates, and return both
     * in one call. Useful for the settings-panel button and Phase 3 check.
     *
     * @returns {{ report: OrphanReport, candidates: Map<string, CandidateMatch[]> }}
     */
    scan() {
        const report = this.detectOrphanedReferences();
        const candidates = this.findAllCandidates(report.orphans);
        return { report, candidates };
    }

    /**
     * Open the resolver filtered to a specific set of chat keys. Used by
     * render-time "N items unavailable" notices in the pinned section and
     * folder contents — they already know exactly which keys are stale,
     * so we don't want to dump the full orphan list on the user.
     *
     * If none of the supplied keys are actually orphaned (e.g., the cache
     * refreshed between render and click), a brief info toast is shown
     * and the resolver is not opened.
     *
     * @param {string[]} scopeKeys - Chat keys to include (others are filtered out)
     * @returns {Promise<BatchResolutionSummary|null>}
     */
    async openResolverFor(scopeKeys) {
        if (!Array.isArray(scopeKeys) || scopeKeys.length === 0) {
            return null;
        }

        const scope = new Set(scopeKeys);
        const fullReport = this.detectOrphanedReferences();
        const scopedOrphans = fullReport.orphans.filter(o => scope.has(o.chatKey));

        if (scopedOrphans.length === 0) {
            CoreAPI.showToast('Those references are no longer orphaned.', 'info');
            return null;
        }

        const scopedReport = {
            orphans: scopedOrphans,
            totalPins: fullReport.totalPins,
            totalFolderKeys: fullReport.totalFolderKeys,
        };
        const candidates = this.findAllCandidates(scopedOrphans);
        return this.showResolver(scopedReport, candidates);
    }

    /**
     * Single-entry API: detect, match, and open the resolver for one
     * specific stale key. Designed for Step 26 (live stale-key handling)
     * where a module discovers a single key that no longer resolves.
     *
     * If the key is not actually orphaned (e.g., it was resolved between
     * detection and UI display), the resolver opens in empty-state.
     *
     * @param {string} staleKey - The chat key that failed to resolve
     * @returns {Promise<BatchResolutionSummary|null>}
     */
    async resolveStaleKey(staleKey) {
        const chatRepository = CoreAPI.getModule('ChatRepository');

        // Verify it's truly stale
        if (chatRepository?.getChatByKey(staleKey)) {
            CoreAPI.showToast('That chat reference is valid — no action needed.', 'info');
            return null;
        }

        // Build a minimal single-orphan report
        const avatar = ChatIdentifier.extractAvatarFromKey(staleKey);
        const fileName = ChatIdentifier.extractFileNameFromKey(staleKey);
        const stateManager = CoreAPI.getModule('StateManager');

        const sources = [];
        const folderIds = [];
        const pinnedChats = stateManager?.get('pinnedChats') || [];
        if (pinnedChats.includes(staleKey)) sources.push('pin');

        const chatFolders = stateManager?.get('chatFolders') || {};
        if (chatFolders[staleKey]) {
            sources.push('folder');
            folderIds.push(...chatFolders[staleKey]);
        }

        // If the key isn't in any stored data, it's a transient reference
        if (sources.length === 0) sources.push('transient');

        const orphan = { chatKey: staleKey, avatar, fileName, sources, folderIds };
        const report = { orphans: [orphan], totalPins: pinnedChats.length, totalFolderKeys: Object.keys(chatFolders).length };
        const candidates = this.findAllCandidates(report.orphans);

        return this.showResolver(report, candidates);
    }

    // ─────────────────────────────────────────
    // PRIVATE — RESOLUTION HELPERS
    // ─────────────────────────────────────────

    /**
     * Relink: replace an orphaned key with a new key in pins and folders.
     * @private
     */
    _relink(orphanKey, newKey) {
        if (!newKey) {
            return { success: false, action: 'relink', orphanKey, error: 'newKey is required for relink' };
        }

        const pinnedChatsManager = CoreAPI.getModule('PinnedChatsManager');
        const stateManager = CoreAPI.getModule('StateManager');

        // Relink pin (if pinned)
        if (pinnedChatsManager) {
            const pinned = (stateManager.get('pinnedChats') || []);
            if (pinned.includes(orphanKey)) {
                pinnedChatsManager.updatePinnedKey(orphanKey, newKey);
            }
        }

        // Relink folder assignments (direct mutation to avoid per-item event churn)
        if (stateManager) {
            const chatFolders = stateManager.get('chatFolders') || {};
            if (chatFolders[orphanKey]) {
                const folderIds = chatFolders[orphanKey];
                delete chatFolders[orphanKey];

                // Merge into new key (in case newKey already has some assignments)
                const existing = chatFolders[newKey] || [];
                const merged = [...new Set([...existing, ...folderIds])];
                chatFolders[newKey] = merged;

                stateManager.set('chatFolders', chatFolders);
            }
        }

        // Update snapshot key so the stored last-message follows the relinked key
        const snapshotStore = CoreAPI.getSnapshotStore();
        snapshotStore?.updateKey(orphanKey, newKey);

        console.debug(`[ChatPlus2] LostAndFound: relinked ${orphanKey} → ${newKey}`);
        return { success: true, action: 'relink', orphanKey, newKey };
    }

    /**
     * Remove: delete an orphaned key from pins and folder assignments.
     * @private
     */
    _remove(orphanKey) {
        const pinnedChatsManager = CoreAPI.getModule('PinnedChatsManager');
        const stateManager = CoreAPI.getModule('StateManager');

        // Remove pin
        if (pinnedChatsManager) {
            const pinned = (stateManager.get('pinnedChats') || []);
            if (pinned.includes(orphanKey)) {
                pinnedChatsManager.unpin(orphanKey);
            }
        }

        // Remove folder assignments
        if (stateManager) {
            const chatFolders = stateManager.get('chatFolders') || {};
            if (chatFolders[orphanKey]) {
                delete chatFolders[orphanKey];
                stateManager.set('chatFolders', chatFolders);
            }
        }

        // Clean up the stored snapshot for this orphaned key
        const snapshotStore = CoreAPI.getSnapshotStore();
        snapshotStore?.removeSnapshot(orphanKey);

        console.debug(`[ChatPlus2] LostAndFound: removed ${orphanKey}`);
        return { success: true, action: 'remove', orphanKey };
    }

    // ─────────────────────────────────────────
    // PRIVATE — CONFIDENCE SCORING
    // ─────────────────────────────────────────

    /**
     * Score confidence for a candidate match using prefix similarity.
     *
     * - **high**: only one live chat exists for this avatar (unambiguous)
     * - **medium**: shared filename prefix of ≥ 10 characters
     *   (ST filenames start with dates like "2024-4-15@12h" so a shared
     *    prefix typically means the same chat session was renamed)
     * - **low**: same avatar but no meaningful filename overlap
     *
     * @private
     * @param {string} orphanFileName
     * @param {string} candidateFileName
     * @param {number} totalCandidatesForAvatar
     * @returns {'high'|'medium'|'low'}
     */
    _scoreConfidence(orphanFileName, candidateFileName, totalCandidatesForAvatar) {
        // Unambiguous: only one chat file for this avatar
        if (totalCandidatesForAvatar === 1) {
            return 'high';
        }

        // Prefix match
        const sharedPrefix = this._sharedPrefixLength(orphanFileName, candidateFileName);
        if (sharedPrefix >= 10) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * Count the number of leading characters shared between two strings.
     * @private
     * @param {string} a
     * @param {string} b
     * @returns {number}
     */
    _sharedPrefixLength(a, b) {
        if (!a || !b) return 0;
        const limit = Math.min(a.length, b.length);
        let i = 0;
        while (i < limit && a[i] === b[i]) i++;
        return i;
    }

    // ─────────────────────────────────────────
    // RESOLVER UI
    // ─────────────────────────────────────────

    /**
     * Show the resolver modal populated with orphaned references and their
     * candidate matches. Layout: header → pagination strip → two-pane body
     * (orphan identity + origin breakdown + snapshot | candidate dropdown +
     * live preview) → footer (per-orphan actions + batch bar).
     *
     * Returns a promise that resolves with the batch resolution summary
     * once the user applies or dismisses the modal.
     *
     * @param {OrphanReport} report
     * @param {Map<string, CandidateMatch[]>} candidates
     * @returns {Promise<BatchResolutionSummary|null>} null if dismissed without action
     */
    showResolver(report, candidates) {
        return new Promise((resolve) => {
            const template = document.getElementById('chatplus-lostfound-template');
            if (!template) {
                console.error('[ChatPlus2] LostAndFound: resolver template not found');
                resolve(null);
                return;
            }

            const clone = template.content.cloneNode(true);
            const overlay = clone.querySelector('.chatplus-lostfound-overlay');
            const body = clone.querySelector('.chatplus-lf-body');
            const orphanPane = clone.querySelector('.chatplus-lf-orphan-pane');
            const candidatePane = clone.querySelector('.chatplus-lf-candidate-pane');
            const mobileTabs = clone.querySelectorAll('.chatplus-lf-mobile-tab');
            const pager = clone.querySelector('.chatplus-lf-pager');
            const pagerPrev = clone.querySelector('.chatplus-lf-pager-prev');
            const pagerNext = clone.querySelector('.chatplus-lf-pager-next');
            const pagerInd = clone.querySelector('.chatplus-lf-pager-indicator');
            const emptyState = clone.querySelector('.chatplus-lostfound-empty');
            const countEl = clone.querySelector('.chatplus-lostfound-count');
            const footer = clone.querySelector('.chatplus-lf-footer');

            const btnIgnore = clone.querySelector('.chatplus-lf-btn-ignore');
            const btnDelete = clone.querySelector('.chatplus-lf-btn-delete');
            const btnReconnect = clone.querySelector('.chatplus-lf-btn-reconnect');
            const actionsRow = clone.querySelector('.chatplus-lf-match-actions');
            const confirmStrip = clone.querySelector('.chatplus-lf-confirm-strip');
            const confirmCancel = clone.querySelector('.chatplus-lf-confirm-strip-cancel');
            const confirmOk = clone.querySelector('.chatplus-lf-confirm-strip-ok');

            /** @type {Map<string, Resolution>} Per-orphan chosen resolution */
            const decisions = new Map();
            /** @type {Map<string, Array<Object>>} candidate.chatKey → fetched messages */
            const previewCache = new Map();

            // Eager snapshot-assisted match scan; kicked off after mount.
            let snapshotPassComplete = false;
            /** @type {Promise<void>|null} */
            let snapshotPassPromise = null;

            let currentIndex = 0;
            /** @type {string|null} */
            let selectedCandidateKey = null;

            // ── Empty state (no orphans at all) ──
            if (report.orphans.length === 0) {
                body.style.display = 'none';
                pager.style.display = 'none';
                footer.style.display = 'none';
                emptyState.style.display = '';

                clone.querySelector('.chatplus-lostfound-close').addEventListener('click', () => {
                    overlay.remove();
                    resolve(null);
                });
                document.body.appendChild(overlay);
                return;
            }

            countEl.textContent = `${report.orphans.length} orphaned reference${report.orphans.length > 1 ? 's' : ''}`;
            if (report.orphans.length <= 1) pager.style.display = 'none';

            // ── Repaint both panes for the orphan at currentIndex ──
            const repaint = () => {
                const orphan = report.orphans[currentIndex];
                if (!orphan) return;

                // Reset inline delete-confirm whenever we change orphans
                confirmStrip.style.display = 'none';
                actionsRow.style.display = '';

                const cands = candidates.get(orphan.chatKey) || [];

                // LEFT pane
                orphanPane.replaceChildren();
                orphanPane.appendChild(this._renderOrphanPane(orphan));

                // RIGHT pane
                candidatePane.replaceChildren();
                selectedCandidateKey = null;
                candidatePane.appendChild(this._renderCandidatePane(
                    orphan, cands, decisions, previewCache,
                    (key) => {
                        selectedCandidateKey = key;
                        btnReconnect.disabled = !key;
                    }
                ));

                // Reconnect label reflects any queued decision
                const prior = decisions.get(orphan.chatKey);
                this._setReconnectButtonState(btnReconnect, prior?.action === 'relink' ? 'queued' : 'idle');
                btnReconnect.disabled = !selectedCandidateKey;

                // Pager state
                pagerInd.textContent = `${currentIndex + 1} / ${report.orphans.length}`;
                pagerPrev.disabled = currentIndex === 0;
                pagerNext.disabled = currentIndex === report.orphans.length - 1;

                // Reset mobile tabs to "orphan" view whenever the viewed
                // orphan changes — the Lost pane has the identity info the
                // user needs first before choosing a candidate.
                setActiveMobilePane('orphan');
            };

            // ── Mobile tab switcher (only visible on narrow viewports) ──
            /** @param {'orphan'|'candidate'} pane */
            const setActiveMobilePane = (pane) => {
                body.dataset.activePane = pane;
                mobileTabs.forEach(btn => {
                    const match = btn.dataset.pane === pane;
                    btn.classList.toggle('is-active', match);
                    btn.setAttribute('aria-selected', match ? 'true' : 'false');
                });
            };
            mobileTabs.forEach(btn => {
                btn.addEventListener('click', () => {
                    setActiveMobilePane(btn.dataset.pane);
                });
            });

            // ── Pagination ──
            pagerPrev.addEventListener('click', () => {
                if (currentIndex > 0) { currentIndex--; repaint(); }
            });
            pagerNext.addEventListener('click', () => {
                if (currentIndex < report.orphans.length - 1) { currentIndex++; repaint(); }
            });

            // ── Close / Escape / Arrow keys ──
            const cleanup = () => {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
            };
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    cleanup();
                    resolve(null);
                    return;
                }
                const inField = e.target && e.target.matches && e.target.matches('input, textarea, select');
                if (inField) return;
                if (e.key === 'ArrowLeft' && currentIndex > 0) {
                    currentIndex--;
                    repaint();
                } else if (e.key === 'ArrowRight' && currentIndex < report.orphans.length - 1) {
                    currentIndex++;
                    repaint();
                }
            };
            document.addEventListener('keydown', escHandler);

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    cleanup();
                    resolve(null);
                    return;
                }
                // Close open candidate dropdowns on outside click
                if (!e.target.closest('.chatplus-lf-dropdown')) {
                    overlay.querySelectorAll('.chatplus-lf-dropdown-panel').forEach(p => {
                        p.style.display = 'none';
                    });
                }
            });

            clone.querySelector('.chatplus-lostfound-close').addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            // ── Per-orphan actions ──
            btnReconnect.addEventListener('click', () => {
                const orphan = report.orphans[currentIndex];
                if (!selectedCandidateKey) {
                    CoreAPI.showToast('Select a chat to reconnect to.', 'warning');
                    return;
                }
                decisions.set(orphan.chatKey, {
                    orphanKey: orphan.chatKey,
                    action: 'relink',
                    newKey: selectedCandidateKey,
                });
                this._setReconnectButtonState(btnReconnect, 'queued');
                // Auto-advance to next unresolved orphan if any
                if (currentIndex < report.orphans.length - 1) { currentIndex++; repaint(); }
            });

            btnIgnore.addEventListener('click', () => {
                const orphan = report.orphans[currentIndex];
                decisions.set(orphan.chatKey, { orphanKey: orphan.chatKey, action: 'skip' });
                if (currentIndex < report.orphans.length - 1) { currentIndex++; repaint(); }
                else { repaint(); }
            });

            btnDelete.addEventListener('click', () => {
                actionsRow.style.display = 'none';
                confirmStrip.style.display = '';
            });

            confirmCancel.addEventListener('click', () => {
                confirmStrip.style.display = 'none';
                actionsRow.style.display = '';
            });

            confirmOk.addEventListener('click', () => {
                const orphan = report.orphans[currentIndex];
                confirmStrip.style.display = 'none';
                actionsRow.style.display = '';
                decisions.set(orphan.chatKey, { orphanKey: orphan.chatKey, action: 'remove' });
                if (currentIndex < report.orphans.length - 1) { currentIndex++; repaint(); }
                else { repaint(); }
            });

            // ── Batch: Auto-Reconnect Obvious ──
            const batchRelinkBtn = clone.querySelector('.chatplus-lostfound-batch-relink');
            const batchRelinkOrigHTML = batchRelinkBtn.innerHTML;
            const applyAutoReconnect = () => {
                for (const orphan of report.orphans) {
                    const cands = candidates.get(orphan.chatKey) || [];
                    const best = cands.find(c => c.confidence === 'exact')
                        || cands.find(c => c.confidence === 'high');
                    if (best) {
                        decisions.set(orphan.chatKey, {
                            orphanKey: orphan.chatKey,
                            action: 'relink',
                            newKey: best.chatKey,
                        });
                    }
                }
                repaint();
            };
            batchRelinkBtn.addEventListener('click', async () => {
                if (!snapshotPassComplete) {
                    batchRelinkBtn.disabled = true;
                    batchRelinkBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning snapshots…';
                    try { await snapshotPassPromise; } catch { /* handled per-orphan */ }
                    batchRelinkBtn.innerHTML = batchRelinkOrigHTML;
                    batchRelinkBtn.disabled = false;
                }
                applyAutoReconnect();
            });

            // ── Batch: Apply All ──
            clone.querySelector('.chatplus-lostfound-batch-apply').addEventListener('click', () => {
                for (const orphan of report.orphans) {
                    if (!decisions.has(orphan.chatKey)) {
                        decisions.set(orphan.chatKey, { orphanKey: orphan.chatKey, action: 'skip' });
                    }
                }
                const resolutions = Array.from(decisions.values());
                const summary = this.applyBatchResolutions(resolutions);
                cleanup();
                resolve(summary);
            });

            // ── Mount + initial paint ──
            document.body.appendChild(overlay);
            repaint();

            // ── Eager snapshot-assisted match pass ──
            // Runs sequentially to avoid fetch stampede; repaints when the
            // currently-viewed orphan's candidates get upgraded.
            const snapshotStore = CoreAPI.getSnapshotStore();
            snapshotPassPromise = (async () => {
                for (let i = 0; i < report.orphans.length; i++) {
                    const orphan = report.orphans[i];
                    const snap = snapshotStore?.getSnapshot(orphan.chatKey);
                    if (!snap) continue;
                    try {
                        const upgraded = await this.findCandidatesWithSnapshotMatch(
                            orphan, snap, previewCache,
                        );
                        const hadExact = upgraded.some(c => c.confidence === 'exact');
                        if (hadExact) {
                            candidates.set(orphan.chatKey, upgraded);
                            if (i === currentIndex) repaint();
                        }
                    } catch (err) {
                        console.warn('[ChatPlus2] LostAndFound: snapshot pass error', err);
                    }
                }
                snapshotPassComplete = true;
            })();
        });
    }

    /**
     * Build the LEFT pane for the active orphan: identity header, origin
     * breakdown ("where it was": pin / folder breadcrumb), and the stored
     * snapshot of its last seen message.
     *
     * @private
     * @param {OrphanRecord} orphan
     * @returns {DocumentFragment}
     */
    _renderOrphanPane(orphan) {
        const frag = this._tpl('chatplus-lf-orphan-pane-template');

        // Identity
        frag.querySelector('.chatplus-lf-orphan-avatar-slot')
            .replaceWith(this._buildOrphanAvatar(orphan, 'chatplus-lf-orphan-avatar'));

        const charName = frag.querySelector('.chatplus-lf-orphan-charname');
        const displayName = this._buildOrphanDisplayName(orphan);
        charName.textContent = displayName;
        charName.title = displayName;

        const fn = frag.querySelector('.chatplus-lf-orphan-filename');
        fn.textContent = orphan.fileName;
        fn.title = orphan.fileName;

        // Origin breakdown
        const originList = frag.querySelector('.chatplus-lf-origin-list');
        this._fillOriginList(originList, orphan);

        // Snapshot
        const snapshotStore = CoreAPI.getSnapshotStore();
        const storedMessage = snapshotStore?.getLastMessage(orphan.chatKey);
        const snapSlot = frag.querySelector('.chatplus-lf-snapshot-slot');
        if (storedMessage) {
            const body = this._tpl('chatplus-lf-snapshot-body-template');
            body.querySelector('.chatplus-lf-snapshot-body').textContent = storedMessage;
            snapSlot.replaceWith(body);
        } else {
            snapSlot.replaceWith(this._tpl('chatplus-lf-snapshot-empty-template'));
        }

        // Raw key
        frag.querySelector('.chatplus-lf-orphan-key').textContent = orphan.chatKey;

        return frag;
    }

    /**
     * Build the RIGHT pane for the active orphan: candidate dropdown selector
     * + live preview of the selected candidate's most recent messages.
     * Invokes `onCandidateChanged(chatKey|null)` whenever selection changes
     * (including initial seed), so the caller can enable/disable the footer
     * Reconnect button.
     *
     * @private
     * @param {OrphanRecord} orphan
     * @param {CandidateMatch[]} cands
     * @param {Map<string, Resolution>} decisions
     * @param {Map<string, Array<Object>>} previewCache
     * @param {(chatKey: string|null) => void} onCandidateChanged
     * @returns {DocumentFragment}
     */
    _renderCandidatePane(orphan, cands, decisions, previewCache, onCandidateChanged) {
        const frag = this._tpl('chatplus-lf-candidate-pane-template');

        // Queued-decision chip
        const chipSlot = frag.querySelector('.chatplus-lf-decision-chip-slot');
        const prior = decisions.get(orphan.chatKey);
        if (prior) {
            const chipLabels = { relink: 'Queued: Reconnect', remove: 'Queued: Delete', skip: 'Queued: Ignore' };
            const chipFrag = this._tpl('chatplus-lf-decision-chip-template');
            const chip = chipFrag.querySelector('.chatplus-lf-decision-chip');
            chip.classList.add(`chatplus-lf-decision-chip--${prior.action}`);
            chipFrag.querySelector('.chatplus-lf-decision-chip-label').textContent =
                chipLabels[prior.action] || prior.action;
            chipSlot.replaceWith(chipFrag);
        } else {
            chipSlot.remove();
        }

        const dropdownSlot = frag.querySelector('.chatplus-lf-dropdown-slot');
        const previewLabel = frag.querySelector('.chatplus-lf-preview-label');
        const previewPanel = frag.querySelector('.chatplus-lf-preview');
        const emptyEl = frag.querySelector('.chatplus-lf-candidate-empty');

        // No-candidate path
        if (cands.length === 0) {
            dropdownSlot.remove();
            previewLabel.remove();
            previewPanel.remove();
            emptyEl.style.display = '';
            onCandidateChanged?.(null);
            return frag;
        }

        // Happy path
        previewLabel.style.display = '';
        const isGroup = this._isGroupOrphan(orphan);
        const updatePreview = (cand) => {
            if (!cand) {
                previewPanel.replaceChildren();
                const statusFrag = this._tpl('chatplus-lf-preview-status-template');
                statusFrag.querySelector('.chatplus-lf-preview-status').textContent = 'No candidate selected.';
                previewPanel.appendChild(statusFrag);
                return;
            }
            this._renderPreviewPanel(previewPanel, cand, orphan, isGroup, previewCache);
        };

        const high = cands.find(c => c.confidence === 'high');
        const initial = cands.find(c => c.confidence === 'exact') || high || cands[0];
        let selectedKey = initial?.chatKey || null;

        const dropdown = this._renderCandidateDropdown(cands, selectedKey, (cand) => {
            selectedKey = cand.chatKey;
            onCandidateChanged?.(selectedKey);
            updatePreview(cand);
        });
        dropdownSlot.replaceWith(dropdown);

        onCandidateChanged?.(selectedKey);
        updatePreview(initial);

        return frag;
    }

    /**
     * Populate the given list element with per-origin rows. Dedupes `folderIds`
     * defensively so any upstream duplication does not result in cloned rows.
     *
     * @private
     * @param {HTMLElement} listEl - target `.chatplus-lf-origin-list`
     * @param {OrphanRecord} orphan
     */
    _fillOriginList(listEl, orphan) {
        const sources = Array.from(new Set(orphan.sources || []));
        // Coerce to strings before Set dedup so numeric/string id mixes collapse into one row.
        const folderIds = Array.from(new Set((orphan.folderIds || []).map(String)));

        // Pin
        if (sources.includes('pin')) {
            listEl.appendChild(this._tpl('chatplus-lf-origin-pin-template'));
        }

        // Folders (one row per unique folderId)
        if (sources.includes('folder') && folderIds.length > 0) {
            const fsm = CoreAPI.getFolderSystemManager();

            // Pre-resolve each folder's path so we can (a) subsume ancestor
            // rows when a descendant is also present (avoids showing both
            // "A" and "A > B" for a chat that the user sees as "in B"), and
            // (b) avoid a second getFolderPath() call in the render loop.
            /** @type {Map<string, Array<{ id: string, name: string }>>} */
            const pathById = new Map();
            for (const fid of folderIds) {
                let p = [];
                try {
                    p = (fsm && typeof fsm.getFolderPath === 'function')
                        ? (fsm.getFolderPath(fid) || [])
                        : [];
                } catch { p = []; }
                pathById.set(fid, p);
            }

            // Drop any folderId that is a strict ancestor of another present
            // folderId. Parallel assignments (siblings / unrelated branches)
            // are preserved as separate rows.
            const rendered = folderIds.filter(fid => {
                for (const otherId of folderIds) {
                    if (otherId === fid) continue;
                    const otherPath = pathById.get(otherId) || [];
                    // fid is a strict ancestor of otherId when otherPath contains
                    // fid but the leaf of otherPath is not fid itself.
                    if (otherPath.length > 1
                        && otherPath[otherPath.length - 1].id !== fid
                        && otherPath.some(f => f.id === fid)) {
                        return false;
                    }
                }
                return true;
            });

            for (const fid of rendered) {
                const folderFrag = this._tpl('chatplus-lf-origin-folder-template');
                const crumbEl = folderFrag.querySelector('.chatplus-lf-origin-breadcrumb');

                const folderPath = pathById.get(fid) || [];

                if (folderPath.length === 0) {
                    const missingFrag = this._tpl('chatplus-lf-origin-crumb-deleted-template');
                    missingFrag.querySelector('.chatplus-lf-origin-breadcrumb-crumb').title = fid;
                    crumbEl.appendChild(missingFrag);
                } else {
                    folderPath.forEach((f, i) => {
                        if (i > 0) crumbEl.appendChild(this._tpl('chatplus-lf-origin-crumb-sep-template'));
                        const segFrag = this._tpl('chatplus-lf-origin-crumb-template');
                        const seg = segFrag.querySelector('.chatplus-lf-origin-breadcrumb-crumb');
                        if (i === folderPath.length - 1) {
                            seg.classList.add('chatplus-lf-origin-breadcrumb-crumb--leaf');
                        }
                        const name = f.name || '(unnamed)';
                        seg.textContent = name;
                        seg.title = name;
                        crumbEl.appendChild(segFrag);
                    });
                }

                listEl.appendChild(folderFrag);
            }
        }

        // Transient-only hint
        if (!sources.includes('pin') && !sources.includes('folder')) {
            listEl.appendChild(this._tpl('chatplus-lf-origin-transient-template'));
        }

        if (listEl.children.length === 0) {
            listEl.appendChild(this._tpl('chatplus-lf-origin-missing-template'));
        }
    }

    /**
     * Replace the Reconnect button's contents with a template clone for the
     * requested state ('idle' | 'queued'). Keeps all label markup declarative
     * in lostfound.html instead of scattered `innerHTML` strings.
     *
     * @private
     * @param {HTMLButtonElement} btn
     * @param {'idle'|'queued'} state
     */
    _setReconnectButtonState(btn, state) {
        const id = state === 'queued'
            ? 'chatplus-lf-btn-reconnect-queued-template'
            : 'chatplus-lf-btn-reconnect-idle-template';
        btn.replaceChildren(this._tpl(id));
    }

    /**
     * Populate the live-preview panel for a selected candidate. Uses
     * CoreAPI.fetchChatMessages() and caches results per-candidate in the
     * modal-scoped previewCache. Renders last ~20 messages.
     *
     * @private
     * @param {HTMLElement} panel
     * @param {CandidateMatch} candidate
     * @param {OrphanRecord} orphan
     * @param {boolean} isGroup
     * @param {Map<string, Array<Object>>} previewCache
     */
    async _renderPreviewPanel(panel, candidate, orphan, isGroup, previewCache) {
        const PREVIEW_COUNT = 20;
        panel.dataset.candidateKey = candidate.chatKey;

        if (previewCache.has(candidate.chatKey)) {
            this._paintPreview(panel, previewCache.get(candidate.chatKey), PREVIEW_COUNT);
            return;
        }

        panel.replaceChildren(this._tpl('chatplus-lf-preview-spinner-template'));

        const messages = await CoreAPI.fetchChatMessages(orphan.avatar, candidate.fileName, isGroup);
        previewCache.set(candidate.chatKey, messages);

        if (panel.dataset.candidateKey !== candidate.chatKey) return;
        this._paintPreview(panel, messages, PREVIEW_COUNT);
    }

    /**
     * Paint messages into the preview panel.
     * @private
     */
    _paintPreview(panel, messages, count) {
        panel.replaceChildren();

        if (!Array.isArray(messages) || messages.length === 0) {
            const frag = this._tpl('chatplus-lf-preview-status-template');
            frag.querySelector('.chatplus-lf-preview-status').textContent = 'No messages in this chat.';
            panel.appendChild(frag);
            return;
        }

        const slice = messages.slice(-count);
        for (const msg of slice) {
            const rowFrag = this._tpl('chatplus-lf-preview-msg-template');
            const rowEl = rowFrag.querySelector('.chatplus-lf-preview-msg');
            const isUser = !!msg.is_user;
            rowEl.classList.add(`chatplus-lf-preview-msg--${isUser ? 'user' : 'ai'}`);
            rowFrag.querySelector('.chatplus-lf-preview-name').textContent =
                msg.name || (isUser ? 'User' : 'Assistant');
            rowFrag.querySelector('.chatplus-lf-preview-text').textContent = msg.mes || '';
            panel.appendChild(rowFrag);
        }

        panel.scrollTop = panel.scrollHeight;
    }

    /**
     * Return true if the orphan's avatar matches a known group.
     * @private
     */
    _isGroupOrphan(orphan) {
        const allGroups = CoreAPI.getAllGroups() || [];
        return allGroups.some(g =>
            String(g.id) === orphan.avatar ||
            g.avatar_url === orphan.avatar ||
            g.avatar === orphan.avatar
        );
    }

    /**
     * Build an avatar node for an orphan (group collage / character thumb / fallback).
     * @private
     * @param {OrphanRecord} orphan
     * @param {string} className
     * @returns {HTMLElement}
     */
    _buildOrphanAvatar(orphan, className) {
        const allGroups = CoreAPI.getAllGroups() || [];
        const matchingGroup = allGroups.find(g =>
            String(g.id) === orphan.avatar ||
            g.avatar_url === orphan.avatar ||
            g.avatar === orphan.avatar
        ) || null;

        if (matchingGroup) {
            const wrapFrag = this._tpl('chatplus-lf-avatar-group-template');
            const wrap = wrapFrag.querySelector('.chatplus-lostfound-avatar--group');
            wrap.classList.add(className);
            const groupEl = CoreAPI.getGroupAvatarElement(matchingGroup);
            if (groupEl) {
                wrap.appendChild(groupEl);
            } else {
                const fbFrag = this._tpl('chatplus-lf-avatar-fallback-template');
                fbFrag.querySelector('img').alt = matchingGroup.name || 'Group';
                wrap.appendChild(fbFrag);
            }
            return wrap;
        }

        const imgFrag = this._tpl('chatplus-lf-avatar-img-template');
        const img = imgFrag.querySelector('img');
        img.className = className;
        img.alt = orphan.avatar;
        img.onerror = () => { img.src = '/img/ai4.png'; };

        const ctx = CoreAPI.getContext();
        if (ctx?.getThumbnailUrl && orphan.avatar) {
            img.src = ctx.getThumbnailUrl('avatar', orphan.avatar);
        } else if (orphan.avatar) {
            img.src = `/characters/${orphan.avatar}`;
        } else {
            img.src = '/img/ai4.png';
        }
        return img;
    }

    /**
     * Resolve the orphan's display name (char name or group prefix + group name).
     * @private
     */
    _buildOrphanDisplayName(orphan) {
        const allGroups = CoreAPI.getAllGroups() || [];
        const matchingGroup = allGroups.find(g =>
            String(g.id) === orphan.avatar ||
            g.avatar_url === orphan.avatar ||
            g.avatar === orphan.avatar
        ) || null;
        if (matchingGroup) return `👥 ${matchingGroup.name || 'Group'}`;
        return (orphan.avatar || '').replace(/\.[^.]+$/, '');
    }

    /**
     * Build a searchable dropdown for candidate selection (select2-like).
     * @private
     * @param {CandidateMatch[]} cands
     * @param {string|null} preSelected - Pre-selected candidate key
     * @param {Function} onSelect - Called with selected CandidateMatch
     * @returns {HTMLElement}
     */
    _renderCandidateDropdown(cands, preSelected, onSelect) {
        const frag = this._tpl('chatplus-lf-dropdown-template');
        const wrapper = frag.querySelector('.chatplus-lf-dropdown');
        const trigger = wrapper.querySelector('.chatplus-lf-dropdown-trigger');
        const triggerLabel = wrapper.querySelector('.chatplus-lf-dropdown-label');
        const panel = wrapper.querySelector('.chatplus-lf-dropdown-panel');
        const search = wrapper.querySelector('.chatplus-lf-dropdown-search');
        const optionsList = wrapper.querySelector('.chatplus-lf-dropdown-options');

        const preSelectedCand = preSelected ? cands.find(c => c.chatKey === preSelected) : null;
        if (preSelectedCand) triggerLabel.textContent = preSelectedCand.fileName;

        // Group candidates by confidence so the dropdown reads
        // exact → high → medium → low, while keeping the existing
        // recency sort within each tier intact (cands is already
        // sorted by lastMessageDate desc upstream).
        const tierOrder = ['exact', 'high', 'medium', 'low'];
        const tierLabels = {
            exact: 'Exact match',
            high: 'High likelihood',
            medium: 'Medium likelihood',
            low: 'Low likelihood',
        };
        /** @type {Record<string, typeof cands>} */
        const buckets = { exact: [], high: [], medium: [], low: [] };
        const otherBucket = [];
        for (const cand of cands) {
            if (buckets[cand.confidence]) buckets[cand.confidence].push(cand);
            else otherBucket.push(cand);
        }

        const renderOption = (cand) => {
            const optFrag = this._tpl('chatplus-lf-dropdown-option-template');
            const option = optFrag.querySelector('.chatplus-lf-dropdown-option');
            if (cand.chatKey === preSelected) option.classList.add('selected');
            option.dataset.candidateKey = cand.chatKey;
            option.querySelector('.chatplus-lf-option-name').textContent = cand.fileName;

            const confEl = option.querySelector('.chatplus-lostfound-confidence');
            confEl.classList.add(`chatplus-lostfound-confidence--${cand.confidence}`);
            confEl.textContent = cand.confidence;

            const excerptEl = option.querySelector('.chatplus-lf-option-excerpt');
            if (cand.lastMessage) {
                excerptEl.textContent = cand.lastMessage.length > 80
                    ? cand.lastMessage.slice(0, 80).trimEnd() + '…'
                    : cand.lastMessage;
                excerptEl.style.display = '';
            } else {
                excerptEl.remove();
            }

            option.addEventListener('click', (e) => {
                e.stopPropagation();
                optionsList.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
                option.classList.add('selected');
                triggerLabel.textContent = cand.fileName;
                panel.style.display = 'none';
                onSelect(cand);
            });

            optionsList.appendChild(optFrag);
        };

        const renderGroup = (tierKey, list) => {
            if (!list.length) return;
            const header = document.createElement('div');
            header.className = `chatplus-lf-dropdown-group-header chatplus-lf-dropdown-group-header--${tierKey}`;
            header.dataset.tier = tierKey;
            header.textContent = tierLabels[tierKey] || tierKey;
            optionsList.appendChild(header);
            for (const cand of list) renderOption(cand);
        };

        for (const tier of tierOrder) renderGroup(tier, buckets[tier]);
        if (otherBucket.length) renderGroup('other', otherBucket);

        // Hide the search input entirely when there's nothing to search
        // (single-candidate or empty list — the search would just take up
        // valuable mobile real estate). Also avoid auto-focusing the search
        // input on coarse-pointer (touch) devices because that pops the
        // on-screen keyboard inside the bottom-sheet modal and squeezes the
        // candidate list / preview into an unusable strip (44a).
        const showSearch = cands.length > 1;
        if (!showSearch && search) {
            search.style.display = 'none';
        }
        const canHoverFocus = (typeof window.matchMedia === 'function')
            && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = panel.style.display !== 'none';
            panel.style.display = isOpen ? 'none' : '';
            if (!isOpen) {
                if (showSearch) {
                    search.value = '';
                    search.dispatchEvent(new Event('input'));
                    if (canHoverFocus) {
                        requestAnimationFrame(() => search.focus());
                    }
                }
            }
        });

        search.addEventListener('input', () => {
            const term = search.value.toLowerCase();
            // Walk the children so that group headers are hidden when
            // every option underneath them is filtered out. The headers
            // themselves don't participate in the text match.
            let currentHeader = null;
            let currentHasMatch = false;
            const flushHeader = () => {
                if (currentHeader) {
                    currentHeader.style.display = currentHasMatch ? '' : 'none';
                }
            };
            for (const child of optionsList.children) {
                if (child.classList.contains('chatplus-lf-dropdown-group-header')) {
                    flushHeader();
                    currentHeader = child;
                    currentHasMatch = false;
                    continue;
                }
                const matches = child.textContent.toLowerCase().includes(term);
                child.style.display = matches ? '' : 'none';
                if (matches) currentHasMatch = true;
            }
            flushHeader();
        });

        search.addEventListener('click', (e) => e.stopPropagation());

        return wrapper;
    }

    /**
     * Clone a sub-template by id. Returns a DocumentFragment (empty fragment
     * if the template is not registered).
     *
     * @private
     * @param {string} id
     * @returns {DocumentFragment}
     */
    _tpl(id) {
        const t = document.getElementById(id);
        if (!t || !(t instanceof HTMLTemplateElement)) {
            console.warn(`[ChatPlus2] LostAndFound: sub-template "${id}" not found`);
            return document.createDocumentFragment();
        }
        return /** @type {DocumentFragment} */ (t.content.cloneNode(true));
    }


}

export default LostAndFound;
