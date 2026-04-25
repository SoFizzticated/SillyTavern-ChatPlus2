/**
 * EventHandlers — Centralized SillyTavern event subscription module.
 *
 * Registers and manages the lifecycle of all ST event listeners used by
 * ChatPlus 2. Each handler is a standalone method so it can be tested or
 * overridden independently. Clean teardown is guaranteed via destroy().
 *
 * @module EventHandlers
 */

import * as CoreAPI from '../modules/core-api.js';

export default class EventHandlers {
    /**
     * @param {Object} modules - Live module references needed by the handlers
     * @param {import('../modules/state-manager.js').default}      modules.stateManager
     * @param {import('../modules/chat-repository.js').default}    modules.chatRepository
     * @param {import('../modules/pinned-chats.js').default}       modules.pinnedChatsManager
     * @param {import('../modules/folder-system.js').default}      modules.folderSystemManager
     * @param {import('../modules/recent-chats.js').default}       modules.recentChatsView
     * @param {import('../modules/snapshot-store.js').default}     modules.snapshotStore
     * @param {import('../modules/lost-and-found.js').default}     modules.lostAndFound
     */
    constructor({ stateManager, chatRepository, pinnedChatsManager, folderSystemManager, recentChatsView, snapshotStore, lostAndFound }) {
        this.stateManager = stateManager;
        this.chatRepository = chatRepository;
        this.pinnedChatsManager = pinnedChatsManager;
        this.folderSystemManager = folderSystemManager;
        this.recentChatsView = recentChatsView;
        this.snapshotStore = snapshotStore;
        this.lostAndFound = lostAndFound;

        /** @type {Function[]} Unsubscribe callbacks, one per registered listener */
        this._unsubscribers = [];

        /**
         * GROUP_UPDATED fires on every member enable/disable toggle, avatar
         * change, name change, and strategy change — potentially many times in
         * rapid succession. Debounce the downstream view refresh so we don't
         * thrash the DOM.
         * @type {ReturnType<typeof setTimeout>|null}
         * @private
         */
        this._groupUpdateTimer = null;

        /**
         * Debounce timer for the non-destructive orphan rescan pipeline.
         * Multiple chat/character destructive events arriving in rapid
         * succession (e.g. CHARACTER_DELETED followed by N× CHAT_DELETED)
         * should coalesce into a single rebuild + scan + banner.
         * @type {ReturnType<typeof setTimeout>|null}
         * @private
         */
        this._rescanDebounceTimer = null;

        /**
         * Reasons accumulated across a debounced rescan window. The handler
         * that fires last wins for banner-copy purposes, but we keep the list
         * available for future diagnostics.
         * @type {string[]}
         * @private
         */
        this._pendingRescanReasons = [];
    }

    // ────────────────────────────────────────────────────────────────────────
    // Public API
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Subscribe to all required SillyTavern events.
     * Must be called exactly once during Phase 5 of coordinator init.
     */
    register() {
        this._unsubscribers.push(
            CoreAPI.onSTEvent('CHARACTER_RENAMED', (...args) => this._onCharacterRenamed(...args)),
            CoreAPI.onSTEvent('CHARACTER_DELETED', (data) => this._onCharacterDeleted(data)),
            CoreAPI.onSTEvent('CHARACTER_DUPLICATED', (data) => this._onCharacterDuplicated(data)),
            CoreAPI.onSTEvent('CHAT_CHANGED', (data) => this._onChatChanged(data)),
            CoreAPI.onSTEvent('CHAT_DELETED', (data) => this._onChatDeleted(data)),
            CoreAPI.onSTEvent('SETTINGS_LOADED_AFTER', () => this._onSettingsLoadedAfter()),
            CoreAPI.onSTEvent('GROUP_UPDATED', (data) => this._onGroupUpdated(data)),
            CoreAPI.onSTEvent('GROUP_CHAT_CREATED', (data) => this._onGroupChatCreated(data)),
            CoreAPI.onSTEvent('GROUP_CHAT_DELETED', (data) => this._onGroupChatDeleted(data)),
        );

        // Internal events — snapshot capture when a chat becomes tracked
        this._unsubscribers.push(
            CoreAPI.on('chat-pinned', ({ chatKey }) => this._onChatTracked(chatKey)),
            CoreAPI.on('chat-assigned-to-folder', ({ chatKey }) => this._onChatTracked(chatKey)),
        );

        console.debug(`[ChatPlus2] EventHandlers: registered ${this._unsubscribers.length} ST event listeners`);
    }

    /**
     * Remove all registered ST event listeners.
     * Safe to call multiple times.
     */
    destroy() {
        if (this._groupUpdateTimer) {
            clearTimeout(this._groupUpdateTimer);
            this._groupUpdateTimer = null;
        }
        if (this._rescanDebounceTimer) {
            clearTimeout(this._rescanDebounceTimer);
            this._rescanDebounceTimer = null;
        }
        this._pendingRescanReasons = [];
        for (const unsub of this._unsubscribers) {
            try { unsub(); } catch { /* best-effort */ }
        }
        this._unsubscribers = [];
        console.debug('[ChatPlus2] EventHandlers: all listeners removed');
    }

    // ────────────────────────────────────────────────────────────────────────
    // Private handlers
    // ────────────────────────────────────────────────────────────────────────

    /**
     * CHARACTER_RENAMED — deterministic key remap (Option A). ST gives us the
     * exact (oldAvatar, newAvatar) mapping, so we rewrite every stale key in
     * pinnedChats / chatFolders / snapshots directly instead of dropping them
     * into the Lost & Found pipeline. Any references that DON'T match the old
     * avatar are left alone and, if they happen to be broken for unrelated
     * reasons, will surface via the subsequent rescan.
     * @private
     */
    async _onCharacterRenamed(...args) {
        console.debug('[ChatPlus2] CHARACTER_RENAMED:', args);
        try {
            // ST source (public/script.js) emits CHARACTER_RENAMED with two
            // positional string args: (oldAvatar, newAvatar). Be defensive
            // against alternate payload shapes (single-string or object).
            let oldAvatar, newAvatar;
            if (args.length >= 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
                oldAvatar = args[0];
                newAvatar = args[1];
            } else if (args.length === 1 && typeof args[0] === 'object' && args[0]) {
                oldAvatar = args[0].oldAvatar;
                newAvatar = args[0].newAvatar;
            } else if (args.length === 1 && typeof args[0] === 'string') {
                oldAvatar = args[0];
            }

            if (oldAvatar) {
                this.chatRepository?.invalidateAvatar(oldAvatar);
            }
            if (newAvatar) {
                this.chatRepository?.invalidateAvatar(newAvatar);
            }

            if (oldAvatar && newAvatar && oldAvatar !== newAvatar) {
                const remapped = this._remapCharacterAvatar(oldAvatar, newAvatar);
                if (remapped > 0) {
                    console.debug(`[ChatPlus2] CHARACTER_RENAMED: remapped ${remapped} stored key(s)`);
                }
            }

            // Still rescan after the remap: picks up any other orphans and
            // lets LostAndFound surface them to the user. Non-destructive.
            this._triggerOrphanRescan('character-renamed');
        } catch (error) {
            console.error('[ChatPlus2] Error handling CHARACTER_RENAMED:', error);
        }
    }

    /**
     * CHARACTER_DELETED — non-destructive. Invalidate the cache and surface
     * any resulting orphans via the resolver rather than silently dropping
     * them from settings.
     * @private
     */
    async _onCharacterDeleted(data) {
        console.debug('[ChatPlus2] CHARACTER_DELETED:', data);
        try {
            if (data?.avatar) {
                this.chatRepository?.invalidateAvatar(data.avatar);
            }
            this._triggerOrphanRescan('character-deleted');
        } catch (error) {
            console.error('[ChatPlus2] Error handling CHARACTER_DELETED:', error);
        }
    }

    /**
     * CHARACTER_DUPLICATED — a new character with its own chat history has
     * appeared; rebuild the full index so it shows up immediately.
     * @private
     */
    _onCharacterDuplicated(data) {
        console.debug('[ChatPlus2] CHARACTER_DUPLICATED:', data);
        try {
            this.chatRepository?.rebuildIndex()
                .then(() => this.recentChatsView?.refresh())
                .catch(error => console.error('[ChatPlus2] Error rebuilding index after CHARACTER_DUPLICATED:', error));
        } catch (error) {
            console.error('[ChatPlus2] Error handling CHARACTER_DUPLICATED:', error);
        }
    }

    /**
     * CHAT_CHANGED — broadcast internally so any subscriber (e.g. TabController
     * or the "currently selected chat" widget) can update its display without
     * tight coupling back to this module.
     * Also notifies SnapshotStore so it can capture the new chat's last message.
     * @private
     */
    _onChatChanged(data) {
        console.debug('[ChatPlus2] CHAT_CHANGED:', data);
        try {
            CoreAPI.emit('chat-changed', data);
            this.snapshotStore?.onChatChanged(data);
        } catch (error) {
            console.error('[ChatPlus2] Error handling CHAT_CHANGED:', error);
        }
    }

    /**
     * Internal event — a chat was just pinned or assigned to a folder.
     * Ensure the SnapshotStore captures an initial snapshot.
     * @private
     * @param {string} chatKey
     */
    _onChatTracked(chatKey) {
        try {
            this.snapshotStore?.onChatTracked(chatKey);
        } catch (error) {
            console.error('[ChatPlus2] Error capturing initial snapshot:', error);
        }
    }

    /**
     * SETTINGS_LOADED_AFTER — re-read extension settings so any changes applied
     * by another session or via import are picked up without a full page reload.
     * @private
     */
    _onSettingsLoadedAfter() {
        console.debug('[ChatPlus2] SETTINGS_LOADED_AFTER: reloading settings');
        try {
            this.stateManager?.load();
        } catch (error) {
            console.error('[ChatPlus2] Error handling SETTINGS_LOADED_AFTER:', error);
        }
    }

    /**
     * GROUP_UPDATED — fires on member add/remove/reorder/disable, avatar
     * change, name change, and strategy change. The ST payload is the full
     * group object.
     *
     * Our chat keys are now anchored on the immutable `group.id`, so avatar
     * changes no longer orphan pins / folder assignments. However the chat
     * objects in ChatRepository carry a cached `entity` reference and
     * `character_name`, so we still need to invalidate the group's cached
     * chats so the next render reflects the new member list / avatar / name.
     *
     * This event fires very frequently; debounce the view refresh.
     * @private
     */
    _onGroupUpdated(data) {
        console.debug('[ChatPlus2] GROUP_UPDATED:', data?.id ?? data);
        try {
            const groupId = data?.id ? String(data.id) : null;
            if (groupId) {
                this.chatRepository?.invalidateAvatar(groupId);
            }

            if (this._groupUpdateTimer) {
                clearTimeout(this._groupUpdateTimer);
            }
            this._groupUpdateTimer = setTimeout(() => {
                this._groupUpdateTimer = null;
                try {
                    // Re-fetch so the cache repopulates with the fresh entity
                    // (name, members, avatar_url) from ST's groups array.
                    this.chatRepository?.rebuildIndex()
                        .then(() => this.recentChatsView?.refresh())
                        .catch(err => console.error('[ChatPlus2] GROUP_UPDATED rebuild failed:', err));
                } catch (error) {
                    console.error('[ChatPlus2] GROUP_UPDATED debounced refresh failed:', error);
                }
            }, 250);
        } catch (error) {
            console.error('[ChatPlus2] Error handling GROUP_UPDATED:', error);
        }
    }

    /**
     * GROUP_CHAT_CREATED — a new group chat file has been initialized.
     * Rebuild the index so the new chat appears in Recent immediately.
     * @private
     */
    _onGroupChatCreated(data) {
        console.debug('[ChatPlus2] GROUP_CHAT_CREATED:', data);
        try {
            this.chatRepository?.rebuildIndex()
                .then(() => this.recentChatsView?.refresh())
                .catch(error => console.error('[ChatPlus2] Error rebuilding index after GROUP_CHAT_CREATED:', error));
        } catch (error) {
            console.error('[ChatPlus2] Error handling GROUP_CHAT_CREATED:', error);
        }
    }

    /**
     * GROUP_CHAT_DELETED — a group chat file has been deleted externally.
     * Non-destructive: rebuild the index and surface any resulting orphans
     * through the resolver rather than silently dropping pins/folder refs.
     * @private
     */
    async _onGroupChatDeleted(data) {
        console.debug('[ChatPlus2] GROUP_CHAT_DELETED:', data);
        try {
            this._triggerOrphanRescan('group-chat-deleted');
        } catch (error) {
            console.error('[ChatPlus2] Error handling GROUP_CHAT_DELETED:', error);
        }
    }

    /**
     * CHAT_DELETED — user deleted a chat file via ST's "Manage chat files"
     * dialog (or via character-delete with "Delete chats" checked, in which
     * case CHARACTER_DELETED has already queued a rescan). Payload is just
     * the filename string (no avatar). Full rebuild is safer than guessing
     * the affected avatar from current chat context mid-event; debounce
     * coalesces bulk-delete bursts into a single rescan.
     * @private
     */
    _onChatDeleted(data) {
        console.debug('[ChatPlus2] CHAT_DELETED:', data);
        try {
            this._triggerOrphanRescan('chat-deleted');
        } catch (error) {
            console.error('[ChatPlus2] Error handling CHAT_DELETED:', error);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Orphan rescan pipeline (non-destructive)
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Debounced entry point for the non-destructive orphan rescan. Multiple
     * destructive events arriving in rapid succession (bulk delete, rename
     * cascade) coalesce into a single rebuild + scan + banner.
     *
     * Pipeline:
     *   1. await chatRepository.rebuildIndex()
     *   2. lostAndFound.scan() → { report, candidates }
     *   3. if report.orphans.length > 0 → emit 'lost-found-orphans-detected'
     *   4. recentChatsView.refresh() unconditionally
     *
     * @param {string} reason - Diagnostic tag used for banner copy selection
     * @private
     */
    _triggerOrphanRescan(reason) {
        this._pendingRescanReasons.push(reason);

        if (this._rescanDebounceTimer) {
            clearTimeout(this._rescanDebounceTimer);
        }

        this._rescanDebounceTimer = setTimeout(async () => {
            this._rescanDebounceTimer = null;
            const reasons = this._pendingRescanReasons.slice();
            this._pendingRescanReasons = [];
            // Last-wins for banner copy; all reasons retained in log.
            const primaryReason = reasons[reasons.length - 1] || 'unknown';

            try {
                await this.chatRepository?.rebuildIndex();

                if (this.lostAndFound) {
                    const { report, candidates } = this.lostAndFound.scan();
                    if (report?.orphans?.length > 0) {
                        console.warn(
                            `[ChatPlus2] Orphan rescan (${primaryReason}): ${report.orphans.length} orphaned reference(s)`,
                            { reasons, orphans: report.orphans.map(o => o.chatKey) }
                        );
                        CoreAPI.emit('lost-found-orphans-detected', {
                            report,
                            candidates,
                            reason: primaryReason,
                            reasons,
                        });
                    } else {
                        console.debug(`[ChatPlus2] Orphan rescan (${primaryReason}): no orphans`);
                    }
                }

                this.recentChatsView?.refresh();
            } catch (error) {
                console.error('[ChatPlus2] Orphan rescan failed:', error);
            }
        }, 250);
    }

    /**
     * Deterministic avatar remap after CHARACTER_RENAMED. Rewrites every
     * `${oldAvatar}:${filename}` key in pinnedChats, chatFolders, and the
     * snapshot store to use `${newAvatar}:${filename}` instead. No-op for
     * keys that don't match the old avatar.
     *
     * @param {string} oldAvatar
     * @param {string} newAvatar
     * @returns {number} Number of stored keys remapped (pins + folder keys + snapshots)
     * @private
     */
    _remapCharacterAvatar(oldAvatar, newAvatar) {
        if (!this.stateManager || !oldAvatar || !newAvatar || oldAvatar === newAvatar) return 0;

        let remapped = 0;
        const oldPrefix = `${oldAvatar}:`;
        const toNewKey = (key) => `${newAvatar}:${key.slice(oldPrefix.length)}`;

        // Pins (dedupe against existing entries that may already reference newAvatar)
        const pins = this.stateManager.get('pinnedChats');
        if (Array.isArray(pins) && pins.length > 0) {
            const seen = new Set();
            const nextPins = [];
            let changed = false;
            for (const key of pins) {
                let nextKey = key;
                if (typeof key === 'string' && key.startsWith(oldPrefix)) {
                    nextKey = toNewKey(key);
                    changed = true;
                    remapped += 1;
                }
                if (!seen.has(nextKey)) {
                    seen.add(nextKey);
                    nextPins.push(nextKey);
                }
            }
            if (changed) this.stateManager.set('pinnedChats', nextPins);
        }

        // Folder assignments
        const chatFolders = this.stateManager.get('chatFolders');
        if (chatFolders && typeof chatFolders === 'object') {
            const nextFolders = {};
            let changed = false;
            for (const [key, folderIds] of Object.entries(chatFolders)) {
                let nextKey = key;
                if (key.startsWith(oldPrefix)) {
                    nextKey = toNewKey(key);
                    changed = true;
                    remapped += 1;
                }
                // Union folder IDs if nextKey collides
                if (nextFolders[nextKey]) {
                    const union = new Set([...nextFolders[nextKey], ...(Array.isArray(folderIds) ? folderIds : [])]);
                    nextFolders[nextKey] = Array.from(union);
                } else {
                    nextFolders[nextKey] = Array.isArray(folderIds) ? folderIds.slice() : folderIds;
                }
            }
            if (changed) this.stateManager.set('chatFolders', nextFolders);
        }

        // Snapshots — iterate the internal map to catch any tracked key
        // using oldAvatar (covers pins, folder keys, and keys added for
        // chats that were only opened rather than explicitly tracked).
        if (this.snapshotStore && typeof this.snapshotStore.updateKey === 'function') {
            const db = this.snapshotStore._db;
            const all = db?.snapshots;
            if (all && typeof all === 'object') {
                for (const key of Object.keys(all)) {
                    if (key.startsWith(oldPrefix)) {
                        try {
                            this.snapshotStore.updateKey(key, toNewKey(key));
                            remapped += 1;
                        } catch (err) {
                            console.warn('[ChatPlus2] snapshot updateKey failed:', err);
                        }
                    }
                }
            }
        }

        return remapped;
    }
}
