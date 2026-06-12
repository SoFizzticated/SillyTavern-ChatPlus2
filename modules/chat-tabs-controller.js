/**
 * ChatTabsController - State model for multi-profile chat tabs
 *
 * The strip is always: [ Main chat chip ] [ secondary tab … ].
 *   - The "Main chat" chip (key = MAIN_KEY) represents whatever SillyTavern has
 *     loaded natively. It is always present, never closeable, selected by
 *     default, and its label tracks CHAT_CHANGED. Selecting it shows ST's own
 *     #chat. The controller does NOT own the live chat — it only reflects it.
 *   - "Secondary tabs" are headless chats opened from a Recent-chats entry's
 *     "+" button. Each has its own bound connection profile and is generated
 *     via CoreAPI.sendHeadlessMessage without switching the active character.
 *
 * Crucially, this controller does NOT auto-create tabs on CHAT_CHANGED (that
 * was the v1 bug that fought the Recent-chats open flow). Its only CHAT_CHANGED
 * job is to refresh the Main chip and re-select Main, so navigating ST natively
 * always reveals the chat that was opened.
 *
 * Owns no DOM — ChatTabsView renders from the emitted events.
 *
 * @module ChatTabsController
 */

import * as CoreAPI from './core-api.js';
import { getChatKey } from '../utils/chat-identifier.js';

export const MAIN_KEY = '__main__';

export default class ChatTabsController {
    /**
     * @param {import('./state-manager.js').default} stateManager
     */
    constructor(stateManager) {
        this.stateManager = stateManager;
        /** @type {Function|null} */
        this._chatChangedUnsub = null;
    }

    // ─────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────

    init() {
        this._pruneInvalidTabs();

        // Always start focused on the live chat — never cover it on load.
        const state = this._state();
        if (state.selectedKey !== MAIN_KEY && !this.getTab(state.selectedKey)) {
            state.selectedKey = MAIN_KEY;
            this._persist();
        }

        this._chatChangedUnsub = CoreAPI.onSTEvent('CHAT_CHANGED', () => this._handleChatChanged());

        CoreAPI.emit('chat-tabs-changed', { tabs: this.getTabs(), selectedKey: this.getSelectedKey() });
        return true;
    }

    destroy() {
        this._chatChangedUnsub?.();
        this._chatChangedUnsub = null;
    }

    // ─────────────────────────────────────────────────────────
    // Queries
    // ─────────────────────────────────────────────────────────

    /** @returns {Array<Object>} Secondary tabs (copy). */
    getTabs() {
        return [...(this._state().open || [])];
    }

    /** @returns {string} Selected key (MAIN_KEY or a secondary chatKey). */
    getSelectedKey() {
        return this._state().selectedKey || MAIN_KEY;
    }

    /** @param {string} chatKey @returns {Object|null} */
    getTab(chatKey) {
        if (!chatKey || chatKey === MAIN_KEY) return null;
        return (this._state().open || []).find(t => t.chatKey === chatKey) || null;
    }

    /**
     * Descriptor of the currently-loaded ST chat, for the Main chip label.
     * @returns {{ label: string, isGroup: boolean, chatKey: string|null, fileName: string, avatar: string|null }}
     */
    getMainChatInfo() {
        const context = CoreAPI.getContext();
        if (!context) return { label: 'Main chat', isGroup: false, chatKey: null, fileName: '', avatar: null };

        const isGroup = context.groupId !== undefined && context.groupId !== null;
        if (isGroup) {
            const group = (context.groups || []).find(g => String(g.id) === String(context.groupId));
            const groupFile = String(context.getCurrentChatId?.() || '').replace(/\.jsonl$/, '');
            return {
                label: group?.name || 'Group chat',
                isGroup: true,
                // Canonical group chat keys use the group id as the "avatar"
                // part (see chat-identifier.js) — built here so focusIfOpen
                // can match clicks on the live group chat. `avatar` stays
                // null: groups can't be demoted into secondary tabs.
                chatKey: groupFile ? `${String(context.groupId)}:${groupFile}` : null,
                fileName: groupFile,
                avatar: null,
            };
        }

        const char = (context.characters || [])[context.characterId];
        const fileName = context.getCurrentChatId?.();
        if (!char || !fileName) return { label: 'Main chat', isGroup: false, chatKey: null, fileName: '', avatar: null };
        const clean = String(fileName).replace(/\.jsonl$/, '');
        return {
            label: char.name || 'Main chat',
            isGroup: false,
            chatKey: `${char.avatar}:${clean}`,
            fileName: clean,
            avatar: char.avatar,
        };
    }

    /**
     * If the given chat is already open — as a secondary tab or as the live
     * main chat — focus it and return true. Returns false when it isn't open
     * anywhere, so callers can fall back to a heavy `openChat` switch.
     *
     * This is THE routing primitive for "open chat" clicks while the tabs
     * feature is on: it prevents heavy switches onto chats that are already
     * on screen and the duplicate-tab confusion that came with them.
     *
     * @param {Object} chat - { avatar, file_name, is_group?, group_id? }
     * @returns {boolean} True if an already-open chat was focused
     */
    focusIfOpen(chat) {
        let chatKey;
        try {
            chatKey = getChatKey(chat);
        } catch {
            return false;
        }
        if (this.getTab(chatKey)) {
            this.selectTab(chatKey);
            return true;
        }
        if (chatKey === this.getMainChatInfo().chatKey) {
            this.selectTab(MAIN_KEY);
            return true;
        }
        return false;
    }

    // ─────────────────────────────────────────────────────────
    // Mutations
    // ─────────────────────────────────────────────────────────

    /**
     * Open (or focus) a secondary headless tab for a character chat. If the
     * chat is already open (as a tab OR as the live main chat), it is focused
     * instead of being duplicated.
     * @param {Object} chat - { avatar, file_name, character_name?, is_group? }
     * @returns {Object|null} The tab object, or null if rejected/redirected
     */
    openSecondaryTab(chat) {
        if (!chat || chat.is_group || chat.group_id) {
            CoreAPI.showToast('Group chats can’t be opened as tabs yet', 'info');
            return null;
        }
        let chatKey;
        try {
            chatKey = getChatKey(chat);
        } catch (error) {
            console.warn('[ChatPlus2] openSecondaryTab: invalid chat', error);
            return null;
        }

        const existing = this.getTab(chatKey);
        if (existing) {
            this.selectTab(chatKey);
            return existing;
        }

        // Already the live main chat → focus the Main chip instead of
        // creating a secondary tab that duplicates it.
        if (chatKey === this.getMainChatInfo().chatKey) {
            this.selectTab(MAIN_KEY);
            CoreAPI.showToast('Already open as the main chat', 'info', 2000);
            return null;
        }

        const char = CoreAPI.getCharacterByAvatar(chat.avatar);
        const tab = {
            chatKey,
            avatar: chat.avatar,
            fileName: String(chat.file_name || '').replace(/\.jsonl$/, ''),
            characterName: chat.character_name || char?.name || '',
            profileId: CoreAPI.getActiveProfileId() || null,
            lastActiveAt: Date.now(),
        };

        const state = this._state();
        state.open.push(tab);
        state.selectedKey = chatKey;
        this._persist();
        CoreAPI.emit('chat-tabs-changed', { tabs: this.getTabs(), selectedKey: this.getSelectedKey() });
        return tab;
    }

    /**
     * Focus a tab (Main or secondary).
     * @param {string} key
     */
    selectTab(key) {
        const valid = key === MAIN_KEY || !!this.getTab(key);
        const target = valid ? key : MAIN_KEY;

        const state = this._state();
        if (state.selectedKey !== target) {
            state.selectedKey = target;
            const tab = this.getTab(target);
            if (tab) tab.lastActiveAt = Date.now();
            this._persist();
        }
        CoreAPI.emit('chat-tab-selected', { selectedKey: target });
    }

    /**
     * Close a secondary tab. If it was selected, fall back to Main.
     * @param {string} chatKey
     */
    closeTab(chatKey) {
        const state = this._state();
        const idx = (state.open || []).findIndex(t => t.chatKey === chatKey);
        if (idx === -1) return;
        state.open.splice(idx, 1);
        if (state.selectedKey === chatKey) state.selectedKey = MAIN_KEY;
        this._persist();
        CoreAPI.emit('chat-tabs-changed', { tabs: this.getTabs(), selectedKey: this.getSelectedKey() });
    }

    /**
     * Bind a connection profile to a secondary tab.
     * @param {string} chatKey
     * @param {string|null} profileId
     */
    setTabProfile(chatKey, profileId) {
        const tab = this.getTab(chatKey);
        if (!tab) return;
        tab.profileId = profileId || null;
        this._persist();
        CoreAPI.emit('chat-tab-profile-changed', { chatKey, profileId });
    }

    /**
     * Promote a secondary tab to the live chat (heavy switch), SWAPPING it with
     * the previous live chat:
     *   - The promoted chat becomes the live chat (shown by the Main chip), so
     *     its secondary tab is removed — otherwise it would exist twice.
     *   - The previously-live chat is demoted INTO that tab's slot, so it is
     *     never lost from the strip.
     * The demotion is skipped when the previous chat can't live as a secondary
     * tab (group chat / nothing loaded), is already open as another tab, or is
     * the very chat being promoted — in those cases the tab is simply removed.
     * @param {string} chatKey
     */
    async promote(chatKey) {
        const tab = this.getTab(chatKey);
        if (!tab) return;

        // Snapshot the live chat BEFORE the switch so it can be demoted.
        const prevMain = this.getMainChatInfo();

        const ok = await CoreAPI.openChat({ avatar: tab.avatar, file_name: tab.fileName, is_group: false });
        if (!ok) return;

        // Build the demoted tab for the previous main chat, when eligible.
        let demoted = null;
        if (prevMain.chatKey && !prevMain.isGroup && prevMain.avatar
            && prevMain.chatKey !== chatKey
            && !this.getTab(prevMain.chatKey)) {
            demoted = {
                chatKey: prevMain.chatKey,
                avatar: prevMain.avatar,
                fileName: prevMain.fileName,
                characterName: prevMain.label,
                profileId: CoreAPI.getActiveProfileId() || null,
                lastActiveAt: Date.now(),
            };
        }

        // Swap in-place: the demoted chat takes the promoted tab's slot.
        const state = this._state();
        const idx = (state.open || []).findIndex(t => t.chatKey === chatKey);
        if (idx !== -1) {
            if (demoted) state.open.splice(idx, 1, demoted);
            else state.open.splice(idx, 1);
        }
        if (state.selectedKey === chatKey) state.selectedKey = MAIN_KEY;
        this._persist();
        CoreAPI.emit('chat-tabs-changed', { tabs: this.getTabs(), selectedKey: this.getSelectedKey() });

        CoreAPI.showToast(
            demoted
                ? `Promoted “${tab.characterName || tab.fileName}” — “${demoted.characterName || demoted.fileName}” moved to its tab`
                : `Promoted “${tab.characterName || tab.fileName}” to the main chat`,
            'success'
        );
    }

    // ─────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────

    /** @private @returns {{open: Array, selectedKey: string}} */
    _state() {
        let s = this.stateManager.get('chatTabs');
        if (!s || typeof s !== 'object') {
            s = { open: [], selectedKey: MAIN_KEY };
            this.stateManager.set('chatTabs', s);
        }
        if (!Array.isArray(s.open)) s.open = [];
        if (typeof s.selectedKey !== 'string') s.selectedKey = MAIN_KEY;
        return s;
    }

    /** @private */
    _persist() {
        this.stateManager.set('chatTabs', this._state());
    }

    /**
     * Drop tabs whose character no longer exists; clear dangling profile ids.
     * @private
     */
    _pruneInvalidTabs() {
        const state = this._state();
        const profileIds = new Set(CoreAPI.getConnectionProfiles().map(p => p.id));
        const kept = [];
        for (const tab of state.open) {
            if (!tab || !tab.avatar || !tab.fileName) continue;
            if (!CoreAPI.getCharacterByAvatar(tab.avatar)) continue;
            if (tab.profileId && !profileIds.has(tab.profileId)) tab.profileId = null;
            kept.push(tab);
        }
        if (kept.length !== state.open.length) {
            state.open = kept;
            if (state.selectedKey !== MAIN_KEY && !kept.some(t => t.chatKey === state.selectedKey)) {
                state.selectedKey = MAIN_KEY;
            }
            this._persist();
        }
    }

    /**
     * CHAT_CHANGED: the live chat changed under us. Refresh the Main chip and
     * re-select Main so the user always sees what ST just loaded. No auto-add.
     * @private
     */
    _handleChatChanged() {
        const state = this._state();
        state.selectedKey = MAIN_KEY;
        this._persist();
        CoreAPI.emit('chat-tabs-changed', { tabs: this.getTabs(), selectedKey: MAIN_KEY });
        CoreAPI.emit('chat-tab-selected', { selectedKey: MAIN_KEY });
    }
}
