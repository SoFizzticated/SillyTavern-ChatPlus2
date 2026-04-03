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
     */
    constructor({ stateManager, chatRepository, pinnedChatsManager, folderSystemManager, recentChatsView }) {
        this.stateManager = stateManager;
        this.chatRepository = chatRepository;
        this.pinnedChatsManager = pinnedChatsManager;
        this.folderSystemManager = folderSystemManager;
        this.recentChatsView = recentChatsView;

        /** @type {Function[]} Unsubscribe callbacks, one per registered listener */
        this._unsubscribers = [];
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
            CoreAPI.onSTEvent('CHARACTER_RENAMED', (data) => this._onCharacterRenamed(data)),
            CoreAPI.onSTEvent('CHARACTER_DELETED', (data) => this._onCharacterDeleted(data)),
            CoreAPI.onSTEvent('CHARACTER_DUPLICATED', (data) => this._onCharacterDuplicated(data)),
            CoreAPI.onSTEvent('CHAT_CHANGED', (data) => this._onChatChanged(data)),
            CoreAPI.onSTEvent('SETTINGS_LOADED_AFTER', () => this._onSettingsLoadedAfter()),
        );

        console.debug(`[ChatPlus2] EventHandlers: registered ${this._unsubscribers.length} ST event listeners`);
    }

    /**
     * Remove all registered ST event listeners.
     * Safe to call multiple times.
     */
    destroy() {
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
     * CHARACTER_RENAMED — evict the stale avatar from cache, prune any
     * orphaned pins / folder assignments, then refresh the recent-chats view.
     * @private
     */
    async _onCharacterRenamed(data) {
        console.debug('[ChatPlus2] CHARACTER_RENAMED:', data);
        try {
            if (data?.avatar) {
                this.chatRepository?.invalidateAvatar(data.avatar);
            }

            const removedPins = await this.pinnedChatsManager?.cleanOrphanedPins() ?? [];
            const orphanedAssignments = this.folderSystemManager?.cleanOrphanedAssignments() ?? 0;

            if (removedPins.length > 0 || orphanedAssignments > 0) {
                console.debug(
                    `[ChatPlus2] Post-rename cleanup: ${removedPins.length} pins,`,
                    `${orphanedAssignments} folder assignments removed`
                );
            }

            this.recentChatsView?.refresh();
        } catch (error) {
            console.error('[ChatPlus2] Error handling CHARACTER_RENAMED:', error);
        }
    }

    /**
     * CHARACTER_DELETED — same cleanup pipeline as rename; the character's
     * chats are gone so we need to evict and prune more aggressively.
     * @private
     */
    async _onCharacterDeleted(data) {
        console.debug('[ChatPlus2] CHARACTER_DELETED:', data);
        try {
            if (data?.avatar) {
                this.chatRepository?.invalidateAvatar(data.avatar);
            }

            const removedPins = await this.pinnedChatsManager?.cleanOrphanedPins() ?? [];
            const orphanedAssignments = this.folderSystemManager?.cleanOrphanedAssignments() ?? 0;

            console.debug(
                `[ChatPlus2] Post-deletion cleanup: ${removedPins.length} pins,`,
                `${orphanedAssignments} folder assignments removed`
            );

            this.recentChatsView?.refresh();
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
     * @private
     */
    _onChatChanged(data) {
        console.debug('[ChatPlus2] CHAT_CHANGED:', data);
        try {
            CoreAPI.emit('chat-changed', data);
        } catch (error) {
            console.error('[ChatPlus2] Error handling CHAT_CHANGED:', error);
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
}
