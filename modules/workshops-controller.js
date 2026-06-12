/**
 * WorkshopsController - Named snapshots of a full chat session
 *
 * A "workshop" is a saved working session: an ORDERED list of session tabs where
 * `tabs[0]` is the main chat and `tabs[1..]` are the secondary tabs, in the user's
 * order (never sorted). Users save the current session under a name, then open /
 * switch / close them like workspaces.
 *
 * Opening a workshop promotes `tabs[0]` to the LIVE main chat (heavy openChat
 * switch) and loads the rest as secondary tabs — a clean "open THIS workspace".
 * The session being replaced is auto-stashed into a single read-only "restore
 * session" slot — UNLESS it already matches a saved workshop (redundant).
 *
 * A "session tab" extends the secondary-tab shape
 * ({ chatKey, avatar, fileName, characterName, profileId, lastActiveAt }) with
 * { isGroup, groupId } so the main entry can also represent a group chat.
 *
 * Owns no DOM and never writes `chatTabs` directly — tab changes route through
 * ChatTabsController. Workshop + restoreSession state lives in StateManager.
 *
 * @module WorkshopsController
 */

import * as CoreAPI from './core-api.js';
import { MAIN_KEY } from './chat-tabs-controller.js';

export default class WorkshopsController {
    /**
     * @param {import('./state-manager.js').default} stateManager
     */
    constructor(stateManager) {
        this.stateManager = stateManager;
    }

    // ─────────────────────────────────────────────────────────
    // Queries
    // ─────────────────────────────────────────────────────────

    /** @returns {Array<Object>} Saved workshops (copy). */
    list() {
        const arr = this.stateManager.get('workshops');
        return Array.isArray(arr) ? [...arr] : [];
    }

    /** @returns {Object|null} The single restore-session slot, or null. */
    getRestoreSession() {
        return this.stateManager.get('restoreSession') || null;
    }

    /** @param {string} id @returns {Object|null} */
    getWorkshop(id) {
        return this.list().find(w => w.id === id) || null;
    }

    /** Whether the current session (main + tabs) matches a workshop (for "active" UI). */
    isActive(id) {
        const w = this.getWorkshop(id);
        return w ? this._sameSession(w.tabs, this._currentSession()) : false;
    }

    /** Whether there's a session worth saving (a main chat and/or tabs). */
    canSave() {
        return this._currentSession().length > 0;
    }

    // ─────────────────────────────────────────────────────────
    // Mutations
    // ─────────────────────────────────────────────────────────

    /**
     * Save the current session (main chat first, then secondary tabs) as a new
     * named workshop.
     * @param {string} name
     * @returns {Object|null} The created workshop, or null if rejected.
     */
    saveCurrent(name) {
        const trimmed = (name || '').trim();
        if (!trimmed) {
            CoreAPI.showToast('Workshop name cannot be empty', 'error');
            return null;
        }

        const session = this._currentSession();
        if (session.length === 0) {
            CoreAPI.showToast('Open a chat first, then save it as a workshop', 'info');
            return null;
        }

        const workshops = this.list();
        if (workshops.some(w => w.name.toLowerCase() === trimmed.toLowerCase())) {
            CoreAPI.showToast('A workshop with this name already exists', 'error');
            return null;
        }

        const workshop = {
            id: `workshop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name: trimmed,
            tabs: this._clone(session),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        workshops.push(workshop);
        this._saveWorkshops(workshops);
        CoreAPI.showToast(`Workshop “${trimmed}” saved`, 'success');
        return workshop;
    }

    /**
     * Overwrite a workshop's session with the current one.
     * @param {string} id
     * @returns {boolean}
     */
    update(id) {
        const workshops = this.list();
        const workshop = workshops.find(w => w.id === id);
        if (!workshop) return false;

        const session = this._currentSession();
        if (session.length === 0) {
            CoreAPI.showToast('No open session to save into this workshop', 'info');
            return false;
        }

        workshop.tabs = this._clone(session);
        workshop.updatedAt = Date.now();
        this._saveWorkshops(workshops);
        CoreAPI.showToast(`Workshop “${workshop.name}” updated`, 'success');
        return true;
    }

    /**
     * Rename a workshop.
     * @param {string} id @param {string} name @returns {boolean}
     */
    rename(id, name) {
        const trimmed = (name || '').trim();
        if (!trimmed) {
            CoreAPI.showToast('Workshop name cannot be empty', 'error');
            return false;
        }
        const workshops = this.list();
        const workshop = workshops.find(w => w.id === id);
        if (!workshop) return false;
        if (workshops.some(w => w.id !== id && w.name.toLowerCase() === trimmed.toLowerCase())) {
            CoreAPI.showToast('A workshop with this name already exists', 'error');
            return false;
        }
        workshop.name = trimmed;
        workshop.updatedAt = Date.now();
        this._saveWorkshops(workshops);
        return true;
    }

    /**
     * Delete a workshop.
     * @param {string} id @returns {boolean}
     */
    delete(id) {
        const workshops = this.list();
        const next = workshops.filter(w => w.id !== id);
        if (next.length === workshops.length) return false;
        this._saveWorkshops(next);
        return true;
    }

    /**
     * Open a workshop: stash the current session (if worthwhile), then make the
     * workshop's first tab the live main chat and load the rest as tabs.
     * @param {string} id @returns {Promise<boolean>}
     */
    async open(id) {
        const workshop = this.getWorkshop(id);
        if (!workshop) return false;

        this._stashCurrent();
        await this._applySession(workshop.tabs);
        CoreAPI.emit('workshops-changed');
        CoreAPI.showToast(`Opened workshop “${workshop.name}”`, 'success');
        return true;
    }

    /**
     * Close the current session's secondary tabs (the live main chat is left
     * untouched), stashing the full session first so it can be restored.
     */
    closeCurrent() {
        if ((this._tabsController()?.getTabs()?.length || 0) === 0) return;
        this._stashCurrent();
        this._tabsController()?.replaceOpenTabs([], MAIN_KEY);
        CoreAPI.emit('workshops-changed');
        CoreAPI.showToast('Closed all tabs', 'info');
    }

    /**
     * Restore the stashed "previous session": swap it in (main + tabs), and the
     * displaced session takes the slot if it's worth keeping (else it clears).
     * @returns {Promise<boolean>}
     */
    async restore() {
        const session = this.getRestoreSession();
        if (!session) return false;

        const current = this._currentSession();
        await this._applySession(session.tabs);

        const keep = current.length && !this._matchesAnyWorkshop(current);
        this.stateManager.set('restoreSession', keep ? { tabs: this._clone(current), stashedAt: Date.now() } : null);

        CoreAPI.emit('workshops-changed');
        CoreAPI.showToast('Restored previous session', 'success');
        return true;
    }

    /** Discard the restore-session slot without restoring it. */
    dismissRestoreSession() {
        if (!this.getRestoreSession()) return;
        this.stateManager.set('restoreSession', null);
        CoreAPI.emit('workshops-changed');
    }

    // ─────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────

    /** @private @returns {import('./chat-tabs-controller.js').default|null} */
    _tabsController() {
        return CoreAPI.getModule('ChatTabsController');
    }

    /**
     * The current working session: [ mainTab, ...secondaryTabs ]. The main entry
     * is omitted when nothing is loaded.
     * @private @returns {Array<Object>}
     */
    _currentSession() {
        const ctrl = this._tabsController();
        const session = [];

        const main = ctrl?.getMainChatInfo?.();
        if (main && main.chatKey) {
            session.push({
                chatKey: main.chatKey,
                avatar: main.avatar || null,
                fileName: main.fileName,
                characterName: main.label,
                profileId: CoreAPI.getActiveProfileId?.() || null,
                isGroup: !!main.isGroup,
                groupId: main.groupId || null,
                lastActiveAt: Date.now(),
            });
        }

        for (const t of (ctrl?.getTabs?.() || [])) {
            session.push({ ...t, isGroup: false, groupId: null });
        }
        return session;
    }

    /**
     * Apply a session: promote tabs[0] to the live main chat, load the rest as
     * secondary tabs. Falls back to loading character entries as tabs if the
     * main switch fails.
     * @private @param {Array<Object>} tabs @returns {Promise<boolean>}
     */
    async _applySession(tabs) {
        const ctrl = this._tabsController();
        if (!ctrl) return false;

        const list = this._clone(tabs);
        if (list.length === 0) {
            ctrl.replaceOpenTabs([], MAIN_KEY);
            return true;
        }

        const first = list[0];
        const rest = list.slice(1).filter(t => !t.isGroup);

        const ok = await CoreAPI.openChat({
            avatar: first.avatar,
            file_name: first.fileName,
            groupId: first.groupId || null,
            is_group: !!first.isGroup,
        });

        if (!ok) {
            // Main switch failed — keep the character entries as secondary tabs.
            ctrl.replaceOpenTabs(list.filter(t => !t.isGroup), MAIN_KEY);
            CoreAPI.showToast('Could not switch the main chat — loaded the rest as tabs', 'warning');
            return false;
        }

        ctrl.replaceOpenTabs(rest, MAIN_KEY);
        return true;
    }

    /**
     * Stash the current session into the restore slot when it's non-empty and
     * not redundant with a saved workshop.
     * @private
     */
    _stashCurrent() {
        const session = this._currentSession();
        if (session.length === 0) return;
        if (this._matchesAnyWorkshop(session)) return;
        this.stateManager.set('restoreSession', { tabs: this._clone(session), stashedAt: Date.now() });
    }

    /** @private @param {Array<Object>} session @returns {boolean} */
    _matchesAnyWorkshop(session) {
        return this.list().some(w => this._sameSession(w.tabs, session));
    }

    /**
     * Session equality: same length, same main (tabs[0]) by chatKey, and the
     * remaining tabs equal as an (order-independent) key set.
     * @private
     */
    _sameSession(a, b) {
        const A = a || [], B = b || [];
        if (A.length !== B.length) return false;
        if (A.length === 0) return true;
        if (A[0]?.chatKey !== B[0]?.chatKey) return false;
        const ka = new Set(A.slice(1).map(t => t.chatKey));
        const kb = new Set(B.slice(1).map(t => t.chatKey));
        if (ka.size !== kb.size) return false;
        for (const k of ka) if (!kb.has(k)) return false;
        return true;
    }

    /** @private */
    _clone(x) {
        return JSON.parse(JSON.stringify(x ?? []));
    }

    /** @private */
    _saveWorkshops(workshops) {
        this.stateManager.set('workshops', workshops);
        CoreAPI.emit('workshops-changed');
    }
}
