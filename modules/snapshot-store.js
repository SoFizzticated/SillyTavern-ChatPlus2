/**
 * SnapshotStore — Persistent last-message snapshot database
 *
 * Stores the most recent message text for every "tracked" chat key (pinned
 * or in a folder). The data lives in a JSON file on the SillyTavern server
 * (`user/files/chatplus2-snapshots.json`), separate from extension settings
 * so it doesn't bloat the main settings payload.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  FILE FORMAT (chatplus2-snapshots.json)                              │
 * │                                                                      │
 * │  {                                                                   │
 * │    "version": 1,                                                     │
 * │    "snapshots": {                                                    │
 * │      "avatar.png:chat_filename": {                                   │
 * │        "lastMessage": "Hey, how are you?",                           │
 * │        "updatedAt": 1712000000000                                    │
 * │      }                                                               │
 * │    }                                                                 │
 * │  }                                                                   │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Read:  GET  /user/files/chatplus2-snapshots.json
 * Write: POST /api/files/upload  { name, data (base64) }
 *
 * Event hooks (stubs for future wiring):
 *   - onChatChanged(data)    → capture snapshot for the chat that was switched to
 *   - onMessageReceived(data)→ update snapshot for the active chat
 *
 * @module SnapshotStore
 */

import * as CoreAPI from './core-api.js';

const DB_FILENAME = 'chatplus2-snapshots.json';
const DB_READ_PATH = `/user/files/${DB_FILENAME}`;
const DB_VERSION = 1;

export class SnapshotStore {
    constructor() {
        /** @type {{ version: number, snapshots: Record<string, { lastMessage: string, updatedAt: number }> }} */
        this._db = { version: DB_VERSION, snapshots: {} };

        /** Whether the initial load from file has completed */
        this._loaded = false;

        /** Debounce timer ID for saving */
        this._saveTimer = null;

        /** Debounce delay (ms) */
        this.SAVE_DEBOUNCE_MS = 1500;

        /** Whether a save is currently in flight */
        this._saving = false;

        /** Dirty flag — set when data changes, cleared on successful save */
        this._dirty = false;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Load the snapshot database from the server file.
     * If the file doesn't exist yet, starts with an empty store.
     * @returns {Promise<void>}
     */
    async init() {
        try {
            const ctx = CoreAPI.getContext();
            const headers = ctx?.getRequestHeaders?.();
            if (!headers) {
                console.warn('[ChatPlus2] SnapshotStore: cannot init — no request headers');
                this._loaded = true;
                return;
            }

            const response = await fetch(DB_READ_PATH, {
                method: 'GET',
                headers,
            });

            if (response.ok) {
                const data = await response.json();
                if (data && typeof data === 'object' && data.snapshots) {
                    this._db = {
                        version: data.version ?? DB_VERSION,
                        snapshots: data.snapshots,
                    };
                    console.debug(
                        `[ChatPlus2] SnapshotStore: loaded ${Object.keys(this._db.snapshots).length} snapshot(s) from file`,
                    );
                }
            } else if (response.status === 404) {
                // File doesn't exist yet — first run
                console.debug('[ChatPlus2] SnapshotStore: no existing database file, starting fresh');
            } else {
                console.warn(`[ChatPlus2] SnapshotStore: unexpected status ${response.status} loading database`);
            }
        } catch (error) {
            console.error('[ChatPlus2] SnapshotStore: error loading database:', error);
        }

        this._loaded = true;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Read API
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Get the stored snapshot for a chat key.
     * @param {string} chatKey - e.g. "avatar.png:filename"
     * @returns {{ lastMessage: string, updatedAt: number } | null}
     */
    getSnapshot(chatKey) {
        return this._db.snapshots[chatKey] ?? null;
    }

    /**
     * Get the last message text for a chat key (convenience).
     * @param {string} chatKey
     * @returns {string | null}
     */
    getLastMessage(chatKey) {
        return this._db.snapshots[chatKey]?.lastMessage ?? null;
    }

    /**
     * Get ALL stored snapshots (shallow copy).
     * @returns {Record<string, { lastMessage: string, updatedAt: number }>}
     */
    getAll() {
        return { ...this._db.snapshots };
    }

    /**
     * Check if a snapshot exists for a chat key.
     * @param {string} chatKey
     * @returns {boolean}
     */
    has(chatKey) {
        return chatKey in this._db.snapshots;
    }

    /**
     * Get the number of stored snapshots.
     * @returns {number}
     */
    get size() {
        return Object.keys(this._db.snapshots).length;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Write API
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Store or update a snapshot for a chat key.
     * @param {string} chatKey
     * @param {string} lastMessage - Full last message text
     */
    setSnapshot(chatKey, lastMessage) {
        if (!chatKey || typeof lastMessage !== 'string') return;

        this._db.snapshots[chatKey] = {
            lastMessage,
            updatedAt: Date.now(),
        };
        this._markDirty();
    }

    /**
     * Remove a snapshot entry.
     * @param {string} chatKey
     * @returns {boolean} True if an entry was actually removed
     */
    removeSnapshot(chatKey) {
        if (!(chatKey in this._db.snapshots)) return false;

        delete this._db.snapshots[chatKey];
        this._markDirty();
        return true;
    }

    /**
     * Rename a chat key, preserving its snapshot data.
     * Used when Lost & Found relinks an orphaned key to a new one.
     * @param {string} oldKey
     * @param {string} newKey
     * @returns {boolean} True if the key was found and renamed
     */
    updateKey(oldKey, newKey) {
        const entry = this._db.snapshots[oldKey];
        if (!entry) return false;

        this._db.snapshots[newKey] = entry;
        delete this._db.snapshots[oldKey];
        this._markDirty();
        return true;
    }

    /**
     * Bulk-update multiple snapshots in one operation (single save).
     * @param {Array<{ chatKey: string, lastMessage: string }>} entries
     */
    bulkUpdate(entries) {
        if (!Array.isArray(entries) || entries.length === 0) return;

        const now = Date.now();
        for (const { chatKey, lastMessage } of entries) {
            if (chatKey && typeof lastMessage === 'string') {
                this._db.snapshots[chatKey] = { lastMessage, updatedAt: now };
            }
        }
        this._markDirty();
    }

    /**
     * Remove all snapshot entries whose keys are NOT in the provided set.
     * Useful for pruning snapshots of chats that are no longer tracked.
     * @param {Set<string>} activeKeys - Set of chat keys to keep
     * @returns {number} Number of pruned entries
     */
    prune(activeKeys) {
        let removed = 0;
        for (const key of Object.keys(this._db.snapshots)) {
            if (!activeKeys.has(key)) {
                delete this._db.snapshots[key];
                removed++;
            }
        }
        if (removed > 0) this._markDirty();
        return removed;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Event Hooks (stubs — will be wired to ST events in a future step)
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Hook: called when the active chat changes.
     * Future: capture the last message of the previous chat before switching.
     * @param {Object} _data - ST CHAT_CHANGED event data
     */
    onChatChanged(_data) {
        // TODO: Wire to ST CHAT_CHANGED event via EventHandlers.
        // When switching chats, capture the last message of the *new* chat
        // if it's a tracked key (pinned or in a folder).
    }

    /**
     * Hook: called when a new message is received or sent.
     * Future: update the snapshot for the currently active chat.
     * @param {Object} _data - ST event data
     */
    onMessageReceived(_data) {
        // TODO: Wire to ST MESSAGE_RECEIVED / MESSAGE_SENT events.
        // Update snapshot for the currently active chat key.
    }

    /**
     * Hook: called when a chat is pinned or assigned to a folder.
     * Captures an initial snapshot if one doesn't already exist.
     * @param {string} chatKey
     */
    async onChatTracked(chatKey) {
        // If we already have a snapshot, no need to re-capture
        if (this.has(chatKey)) return;

        // Try to get the last message from ChatRepository
        const repo = CoreAPI.getChatRepository();
        if (!repo) return;

        const chat = repo.getChatByKey(chatKey);
        if (!chat) return;

        const stats = await repo.getChatStats(chat);
        if (stats?.lastMessage) {
            this.setSnapshot(chatKey, stats.lastMessage);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Persistence — debounced file write
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Mark the database as dirty and schedule a debounced save.
     * @private
     */
    _markDirty() {
        this._dirty = true;
        this._scheduleSave();
    }

    /**
     * Schedule a debounced save to the server.
     * @private
     */
    _scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._persistToFile(), this.SAVE_DEBOUNCE_MS);
    }

    /**
     * Force an immediate save (bypasses debounce). Useful before page unload.
     * @returns {Promise<boolean>} Whether the save succeeded
     */
    async flush() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        if (!this._dirty) return true;
        return this._persistToFile();
    }

    /**
     * Write the database to the server file.
     * Uses SillyTavern's /api/files/upload endpoint with base64-encoded JSON.
     * @private
     * @returns {Promise<boolean>}
     */
    async _persistToFile() {
        if (this._saving) {
            // If already saving, reschedule
            this._scheduleSave();
            return false;
        }

        this._saving = true;
        try {
            const ctx = CoreAPI.getContext();
            const getRequestHeaders = ctx?.getRequestHeaders;
            if (!getRequestHeaders) {
                console.warn('[ChatPlus2] SnapshotStore: cannot save — no request headers');
                return false;
            }

            const jsonStr = JSON.stringify(this._db, null, 2);
            const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: DB_FILENAME,
                    data: base64Data,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[ChatPlus2] SnapshotStore: save failed (${response.status}):`, errorText);
                return false;
            }

            this._dirty = false;
            console.debug(`[ChatPlus2] SnapshotStore: saved ${this.size} snapshot(s) to file`);
            return true;
        } catch (error) {
            console.error('[ChatPlus2] SnapshotStore: error saving database:', error);
            return false;
        } finally {
            this._saving = false;
        }
    }
}

export default SnapshotStore;
