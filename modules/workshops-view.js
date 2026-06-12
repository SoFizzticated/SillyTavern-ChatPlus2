/**
 * WorkshopsView - Renders and manages the Workshops tab UI
 *
 * Lazy-renders when the 'workshops' tab is first activated; re-renders on
 * 'workshops-changed' (save/open/delete/restore) and 'chat-tabs-changed' (so
 * the "active workshop" highlight and the save-button hint stay accurate).
 *
 * @module WorkshopsView
 */

import * as CoreAPI from './core-api.js';

export default class WorkshopsView {
    /**
     * @param {import('./workshops-controller.js').default} controller
     */
    constructor(controller) {
        this.controller = controller;

        /** @type {HTMLElement|null} */
        this.listContainer = null;
        /** Whether the first render has run */
        this._rendered = false;
        /** Guards against wiring the Save button more than once */
        this._saveBtnWired = false;

        this._tabActivatedHandler = ({ name }) => {
            if (name === 'workshops' && !this._rendered) {
                this.render();
            }
        };
        this._changedHandler = () => { if (this._rendered) this.render(); };

        CoreAPI.on('tab-activated', this._tabActivatedHandler);
        CoreAPI.on('workshops-changed', this._changedHandler);
        CoreAPI.on('chat-tabs-changed', this._changedHandler);
    }

    // ─────────────────────────────────────────────────────────
    // Public
    // ─────────────────────────────────────────────────────────

    render() {
        this.listContainer = document.getElementById('chatplus-workshops-list');
        if (!this.listContainer) {
            console.warn('[ChatPlus2] WorkshopsView: #chatplus-workshops-list not found');
            return;
        }
        this._rendered = true;
        this._wireSaveButton();
        this._updateHint();

        this.listContainer.innerHTML = '';

        // Tabs disabled → nothing to do here.
        if (CoreAPI.getStateManager()?.get('tabsEnabled') === false) {
            this.listContainer.appendChild(this._emptyMessage('Chat tabs are disabled. Enable them in ChatPlus 2 settings to use workshops.'));
            return;
        }

        // ── Restore-session slot (read-only, top of the list) ──
        const session = this.controller.getRestoreSession();
        if (session) this.listContainer.appendChild(this._buildRestoreRow(session));

        // ── Saved workshops ──
        const workshops = this.controller.list()
            .sort((a, b) => a.name.localeCompare(b.name));

        if (workshops.length === 0 && !session) {
            this.listContainer.appendChild(this._emptyMessage('No workshops yet. Open some tabs, then click the save icon above.'));
            return;
        }

        for (const w of workshops) this.listContainer.appendChild(this._buildWorkshopRow(w));
    }

    destroy() {
        CoreAPI.off('tab-activated', this._tabActivatedHandler);
        CoreAPI.off('workshops-changed', this._changedHandler);
        CoreAPI.off('chat-tabs-changed', this._changedHandler);

        const btn = document.getElementById('chatplus-save-workshop');
        if (btn && btn._chatplusSaveHandler) {
            btn.removeEventListener('click', btn._chatplusSaveHandler);
            delete btn._chatplusSaveHandler;
        }
        this._saveBtnWired = false;
        this.listContainer = null;
        this._rendered = false;
    }

    // ─────────────────────────────────────────────────────────
    // Private — rendering
    // ─────────────────────────────────────────────────────────

    /** @private */
    _buildRestoreRow(session) {
        const row = document.createElement('div');
        row.className = 'chatplus-workshop-item chatplus-workshop-item--restore';

        const body = document.createElement('div');
        body.className = 'chatplus-workshop-body';

        const titleRow = document.createElement('div');
        titleRow.className = 'chatplus-workshop-titlerow';
        const name = document.createElement('span');
        name.className = 'chatplus-workshop-name';
        name.innerHTML = '<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Previous session';
        titleRow.appendChild(name);
        titleRow.appendChild(this._actionBtn('fa-xmark', 'Dismiss', () => this.controller.dismissRestoreSession()));
        body.appendChild(titleRow);

        body.appendChild(this._buildCountLine(session.tabs, false));
        body.appendChild(this._buildTabList(session.tabs));
        row.appendChild(body);

        // Full-height restore button on the right.
        row.appendChild(this._buildOpenButton('fa-rotate-left', 'Restore these tabs', () => this.controller.restore()));
        return row;
    }

    /** @private */
    _buildWorkshopRow(w) {
        const isActive = this.controller.isActive(w.id);

        const row = document.createElement('div');
        row.className = 'chatplus-workshop-item' + (isActive ? ' chatplus-workshop-item--active' : '');

        const body = document.createElement('div');
        body.className = 'chatplus-workshop-body';

        // ── Title row: name + rename (end of name row) + gear ──
        const titleRow = document.createElement('div');
        titleRow.className = 'chatplus-workshop-titlerow';
        const nameEl = document.createElement('span');
        nameEl.className = 'chatplus-workshop-name';
        nameEl.textContent = w.name;
        titleRow.appendChild(nameEl);
        titleRow.appendChild(this._actionBtn('fa-pencil', 'Rename', () => this._onRename(w)));

        const options = document.createElement('div');
        options.className = 'chatplus-workshop-options chatplus-hidden';

        const gear = this._actionBtn('fa-gear', 'More options', () => {
            const hidden = options.classList.toggle('chatplus-hidden');
            gear.classList.toggle('chatplus-workshop-action--active', !hidden);
        });
        titleRow.appendChild(gear);
        body.appendChild(titleRow);

        // ── Count + tab list ──
        body.appendChild(this._buildCountLine(w.tabs, isActive));
        body.appendChild(this._buildTabList(w.tabs));

        // ── Collapsible options: replace / delete ──
        options.appendChild(this._optionBtn('fa-file-import', 'Replace with current session', () => this.controller.update(w.id)));
        options.appendChild(this._optionBtn('fa-trash', 'Delete', () => this._onDelete(w), 'chatplus-workshop-option--danger'));
        body.appendChild(options);

        row.appendChild(body);

        // ── Full-height Open button on the right edge ──
        row.appendChild(this._buildOpenButton('fa-folder-open', isActive ? 'Re-open this workshop' : 'Open this workshop', () => this.controller.open(w.id)));
        return row;
    }

    /** @private Count line, e.g. "3 tabs · open". */
    _buildCountLine(tabs, isActive) {
        const count = tabs?.length || 0;
        const el = document.createElement('span');
        el.className = 'chatplus-workshop-count';
        el.textContent = `${count} tab${count !== 1 ? 's' : ''}${isActive ? ' · open' : ''}`;
        return el;
    }

    /** @private The Character — chat list; the first entry is the main chat. */
    _buildTabList(tabs) {
        const list = document.createElement('div');
        list.className = 'chatplus-workshop-tablist';
        (tabs || []).forEach((t, i) => {
            const line = document.createElement('div');
            line.className = 'chatplus-workshop-tab' + (i === 0 ? ' chatplus-workshop-tab--main' : '');
            const icon = i === 0 ? 'fa-comment' : 'fa-clone';
            const charName = t.characterName || t.avatar || t.fileName || 'Unknown';
            const file = t.fileName || '';
            line.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`
                + `<span class="chatplus-workshop-tab-char"></span>`
                + (file ? `<span class="chatplus-workshop-tab-sep">—</span><span class="chatplus-workshop-tab-file"></span>` : '');
            line.querySelector('.chatplus-workshop-tab-char').textContent = charName;
            if (file) line.querySelector('.chatplus-workshop-tab-file').textContent = file;
            line.title = `${charName}${file ? ` — ${file}` : ''}${i === 0 ? ' (main chat)' : ''}`;
            list.appendChild(line);
        });
        return list;
    }

    /** @private Small inline icon button (rename / gear / dismiss). */
    _actionBtn(faClass, title, onClick, extraClass = '') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chatplus-workshop-action' + (extraClass ? ' ' + extraClass : '');
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.innerHTML = `<i class="fa-solid ${faClass}" aria-hidden="true"></i>`;
        btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return btn;
    }

    /** @private Labeled button inside the collapsible options row. */
    _optionBtn(faClass, label, onClick, extraClass = '') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu_button chatplus-workshop-option' + (extraClass ? ' ' + extraClass : '');
        btn.innerHTML = `<i class="fa-solid ${faClass}" aria-hidden="true"></i> ${label}`;
        btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return btn;
    }

    /** @private Full-height action button on the right edge of a row. */
    _buildOpenButton(faClass, title, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chatplus-workshop-open';
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.innerHTML = `<i class="fa-solid ${faClass}" aria-hidden="true"></i>`;
        btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return btn;
    }

    /** @private */
    _emptyMessage(text) {
        const el = document.createElement('div');
        el.className = 'chatplus-empty-message';
        el.textContent = text;
        return el;
    }

    // ─────────────────────────────────────────────────────────
    // Private — actions
    // ─────────────────────────────────────────────────────────

    /** @private */
    _wireSaveButton() {
        if (this._saveBtnWired) return;
        const btn = document.getElementById('chatplus-save-workshop');
        if (!btn) return;
        const handler = () => this._onSave();
        btn._chatplusSaveHandler = handler;
        btn.addEventListener('click', handler);
        this._saveBtnWired = true;
    }

    /** Reflect whether the current session is worth saving in the header hint. @private */
    _updateHint() {
        const hint = document.getElementById('chatplus-workshops-hint');
        const saveBtn = document.getElementById('chatplus-save-workshop');
        const canSave = !!this.controller.canSave?.();
        if (saveBtn) saveBtn.disabled = !canSave;
        if (hint) {
            hint.textContent = canSave
                ? 'Save your current chat + tabs as a named workshop'
                : 'Open a chat first — then save your workspace here';
        }
    }

    /** @private */
    async _onSave() {
        const name = await CoreAPI.showInput('Name this workshop:', '', 'Save Workshop');
        if (!name || !name.trim()) return;
        this.controller.saveCurrent(name.trim());
    }

    /** @private */
    async _onRename(w) {
        const name = await CoreAPI.showInput(`Rename “${w.name}” to:`, w.name, 'Rename Workshop');
        if (!name || name.trim() === w.name) return;
        this.controller.rename(w.id, name.trim());
    }

    /** @private */
    async _onDelete(w) {
        const ok = await CoreAPI.showConfirmation(`Delete workshop “${w.name}”? Your chats are not affected.`, 'Delete Workshop');
        if (!ok) return;
        this.controller.delete(w.id);
    }
}
