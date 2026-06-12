/**
 * ChatTabsView - Tab strip + per-tab panels for multi-profile chat tabs
 *
 * Renders a strip docked above #chat: a persistent "Main chat" chip followed by
 * the secondary tabs. Selecting Main shows ST's native #chat / #form_sheld;
 * selecting a secondary tab hides them (via a class on #sheld) and shows that
 * tab's own panel (transcript + composer) in normal flex flow. NO overlay —
 * a clean hide/show so nothing ever covers the native chat.
 *
 * DOM (never reparents ST DOM):
 *   #sheld
 *     #sheldheader
 *     #chatplus-tab-strip        ← inserted before #chat
 *     #chat                      (ST)  — hidden when a secondary tab is selected
 *     #chatplus-tab-panels       ← inserted after #chat; shown when secondary selected
 *     #form_sheld                (ST)  — hidden when a secondary tab is selected
 *
 * Per-tab panels are kept in the DOM once built, so draft text + scroll survive
 * tab switches.
 *
 * @module ChatTabsView
 */

import * as CoreAPI from './core-api.js';
import { MAIN_KEY } from './chat-tabs-controller.js';

export default class ChatTabsView {
    /**
     * @param {import('./chat-tabs-controller.js').default} controller
     */
    constructor(controller) {
        this.controller = controller;

        /** @type {HTMLElement|null} */
        this._sheld = null;
        /** @type {HTMLElement|null} */
        this._strip = null;
        /** @type {HTMLElement|null} */
        this._panels = null;

        /** @type {Map<string, {panel: HTMLElement, transcript: HTMLElement, input: HTMLTextAreaElement, sending: boolean, abort: AbortController|null}>} */
        this._panelByKey = new Map();
        /** @type {Array<Function>} */
        this._unsubs = [];
        /** @type {HTMLElement|null} Currently-open gear popover */
        this._popover = null;
        this._onDocClick = null;
        /** @type {(() => void)|null} Cleanup for the #chat style alias */
        this._styleAliasCleanup = null;
        /** @type {string|null} chatKey of the secondary tab being dragged */
        this._dragKey = null;
    }

    /** @private Whether to render native `.mes` nodes + the #chat style alias. */
    _useNativeStyling() {
        return CoreAPI.getStateManager()?.get('tabsNativeStyling') !== false;
    }

    // ─────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────

    mount() {
        const sheld = document.getElementById('sheld');
        const chat = document.getElementById('chat');
        if (!sheld || !chat) {
            console.error('[ChatPlus2] ChatTabsView: #sheld / #chat not found — cannot mount');
            return false;
        }
        this._sheld = sheld;

        if (!document.getElementById('chatplus-tab-strip')) {
            this._strip = document.createElement('div');
            this._strip.id = 'chatplus-tab-strip';
            this._strip.className = 'cp-tab-strip';
            sheld.insertBefore(this._strip, chat);

            this._panels = document.createElement('div');
            this._panels.id = 'chatplus-tab-panels';
            this._panels.className = 'cp-tab-panels';
            chat.insertAdjacentElement('afterend', this._panels);
        } else {
            this._strip = document.getElementById('chatplus-tab-strip');
            this._panels = document.getElementById('chatplus-tab-panels');
        }

        this._unsubs.push(CoreAPI.on('chat-tabs-changed', () => { this._prunePanels(); this._renderStrip(); this._applySelection(); }));
        this._unsubs.push(CoreAPI.on('chat-tab-selected', () => { this._renderStrip(); this._applySelection(); }));
        this._unsubs.push(CoreAPI.on('chat-tab-profile-changed', () => this._renderStrip()));

        // Mirror #chat-scoped theme CSS onto our panel (only in native mode).
        if (this._useNativeStyling()) {
            this._styleAliasCleanup = CoreAPI.installChatStyleAlias('#chatplus-tab-panels .cp-tab-transcript');
        }

        this._renderStrip();
        this._applySelection();
        return true;
    }

    /**
     * Re-apply the styling mode after the "Match main-chat styling" toggle:
     * (un)install the #chat style alias and re-render all built panels.
     */
    refreshStyleMode() {
        const native = this._useNativeStyling();
        if (native && !this._styleAliasCleanup) {
            this._styleAliasCleanup = CoreAPI.installChatStyleAlias('#chatplus-tab-panels .cp-tab-transcript');
        } else if (!native && this._styleAliasCleanup) {
            this._styleAliasCleanup();
            this._styleAliasCleanup = null;
        }
        // Re-render every built panel's transcript from its persisted file.
        for (const [chatKey, entry] of this._panelByKey) {
            const tab = this.controller.getTab(chatKey);
            if (tab) this._loadTranscript(tab, entry);
        }
    }

    destroy() {
        this._closePopover();
        this._styleAliasCleanup?.();
        this._styleAliasCleanup = null;
        this._unsubs.forEach(fn => { try { fn(); } catch { /* best-effort */ } });
        this._unsubs = [];
        for (const entry of this._panelByKey.values()) entry.abort?.abort();
        this._panelByKey.clear();
        this._sheld?.classList.remove('cp-secondary-active');
        this._strip?.remove();
        this._panels?.remove();
        this._strip = null;
        this._panels = null;
        this._sheld = null;
    }

    // ─────────────────────────────────────────────────────────
    // Strip
    // ─────────────────────────────────────────────────────────

    /** @private */
    _renderStrip() {
        if (!this._strip) return;
        const selectedKey = this.controller.getSelectedKey();
        this._strip.textContent = '';

        // Hide the whole strip when there are no secondary tabs — the Main chip
        // alone is "only one open" and there's nothing to switch to, so native
        // #chat reclaims the space (item 1).
        this._strip.classList.toggle('cp-tab-strip--solo', this.controller.getTabs().length === 0);

        // ── Main chat chip ──
        const main = this.controller.getMainChatInfo();
        this._strip.appendChild(this._buildChip({
            key: MAIN_KEY,
            label: main.label,
            subtitle: main.fileName,
            isMain: true,
            selected: selectedKey === MAIN_KEY,
        }));

        // ── Secondary tabs ──
        for (const tab of this.controller.getTabs()) {
            this._strip.appendChild(this._buildChip({
                key: tab.chatKey,
                label: tab.characterName || tab.avatar || tab.fileName,
                subtitle: tab.fileName,
                tab,
                selected: selectedKey === tab.chatKey,
            }));
        }
    }

    /**
     * Truncate a string in the middle so both its start and end stay visible.
     * @private
     * @param {string} str
     * @param {number} max - Maximum length of the returned string (including the ellipsis).
     * @returns {string}
     */
    _middleEllipsis(str, max = 24) {
        const s = String(str || '');
        if (s.length <= max) return s;
        const keep = max - 1; // room for the ellipsis
        const head = Math.ceil(keep / 2);
        const tail = keep - head;
        return s.slice(0, head) + '…' + (tail > 0 ? s.slice(-tail) : '');
    }

    /** @private */
    _buildChip({ key, label, subtitle, isMain, tab, selected }) {
        const chip = document.createElement('div');
        chip.className = 'cp-tab'
            + (selected ? ' cp-tab--active' : '')
            + (isMain ? ' cp-tab--main' : '');
        chip.setAttribute('role', 'tab');
        chip.setAttribute('aria-selected', String(!!selected));
        chip.title = isMain
            ? `Main chat: ${label}${subtitle ? ` · ${subtitle}` : ''}`
            : `${label} · ${tab.fileName}`;

        // ── Head: the clickable selector (icon + stacked text) ──
        const head = document.createElement('div');
        head.className = 'cp-tab-head';

        if (isMain) {
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-user cp-tab-main-icon';
            head.appendChild(icon);
        }

        const text = document.createElement('div');
        text.className = 'cp-tab-text';

        const titleEl = document.createElement('span');
        titleEl.className = 'cp-tab-title';
        titleEl.textContent = label;
        text.appendChild(titleEl);

        if (subtitle) {
            const subEl = document.createElement('span');
            subEl.className = 'cp-tab-subtitle';
            subEl.textContent = this._middleEllipsis(subtitle);
            text.appendChild(subEl);
        }
        head.appendChild(text);
        chip.appendChild(head);
        head.addEventListener('click', () => this.controller.selectTab(key));

        // ── Action row: gear / promote / close, shown only under the active secondary tab (full tab width, both desktop and mobile — item 2). ──
        if (!isMain && selected) {
            const actions = document.createElement('div');
            actions.className = 'cp-tab-actions';

            // Gear → profile popover
            actions.appendChild(this._iconButton('fa-gear', 'Connection profile', (e) => {
                e.stopPropagation();
                this._openProfilePopover(tab, e.currentTarget);
            }));
            // Promote → heavy switch
            actions.appendChild(this._iconButton('fa-person-arrow-up-from-line', 'Promote to main chat', (e) => {
                e.stopPropagation();
                this.controller.promote(tab.chatKey);
            }));
            // Close
            actions.appendChild(this._iconButton('fa-xmark', 'Close tab', (e) => {
                e.stopPropagation();
                this.controller.closeTab(tab.chatKey);
            }, 'cp-tab-close'));

            chip.appendChild(actions);
        }

        // ── Drag-to-reorder (secondary tabs only) ──
        if (!isMain) this._wireDragReorder(chip, tab.chatKey);

        return chip;
    }

    /**
     * Wire HTML5 drag-and-drop on a secondary chip so users can reorder tabs by
     * holding and dragging. The Main chip is never draggable nor a drop target.
     * @private
     */
    _wireDragReorder(chip, chatKey) {
        chip.draggable = true;
        chip.dataset.chatKey = chatKey;

        chip.addEventListener('dragstart', (e) => {
            this._dragKey = chatKey;
            chip.classList.add('cp-tab--dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', chatKey); } catch { /* some browsers */ }
            }
        });
        chip.addEventListener('dragend', () => {
            chip.classList.remove('cp-tab--dragging');
            this._dragKey = null;
            this._strip?.querySelectorAll('.cp-tab--dragover')
                .forEach(el => el.classList.remove('cp-tab--dragover'));
        });
        chip.addEventListener('dragover', (e) => {
            if (!this._dragKey || this._dragKey === chatKey) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            chip.classList.add('cp-tab--dragover');
        });
        chip.addEventListener('dragleave', () => chip.classList.remove('cp-tab--dragover'));
        chip.addEventListener('drop', (e) => {
            e.preventDefault();
            chip.classList.remove('cp-tab--dragover');
            const from = this._dragKey;
            this._dragKey = null;
            if (from && from !== chatKey) this._applyReorder(from, chatKey);
        });
    }

    /**
     * Move the dragged tab so it sits immediately before the drop-target tab.
     * @private
     */
    _applyReorder(fromKey, toKey) {
        const keys = this.controller.getTabs().map(t => t.chatKey);
        const fromIdx = keys.indexOf(fromKey);
        if (fromIdx !== -1) keys.splice(fromIdx, 1);
        const toIdx = keys.indexOf(toKey);
        if (toIdx === -1) return;
        keys.splice(toIdx, 0, fromKey);
        this.controller.reorderTabs(keys);
    }

    /** @private */
    _iconButton(faClass, title, onClick, extraClass = '') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cp-tab-icon-btn' + (extraClass ? ' ' + extraClass : '');
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.innerHTML = `<i class="fa-solid ${faClass}" aria-hidden="true"></i>`;
        btn.addEventListener('click', onClick);
        return btn;
    }

    // ─────────────────────────────────────────────────────────
    // Selection / clean hide-show
    // ─────────────────────────────────────────────────────────

    /** @private */
    _applySelection() {
        if (!this._sheld || !this._panels) return;
        const selectedKey = this.controller.getSelectedKey();
        const tab = this.controller.getTab(selectedKey);

        if (!tab) {
            // Main selected → show native chat, hide all panels.
            this._sheld.classList.remove('cp-secondary-active');
            for (const entry of this._panelByKey.values()) entry.panel.hidden = true;
            this._closePopover();
            return;
        }

        // Secondary selected → hide native chat, show this tab's panel only.
        this._sheld.classList.add('cp-secondary-active');
        const entry = this._ensurePanel(tab);
        for (const [k, e] of this._panelByKey) e.panel.hidden = (k !== tab.chatKey);
        // Refresh transcript lazily only the first time (kept thereafter).
        if (!entry.loaded) this._loadTranscript(tab, entry);
    }

    /**
     * Drop cached panels whose tab no longer exists (closed or promoted away).
     * Without this, a chat promoted to main and later re-opened as a tab would
     * show a stale cached transcript from before the promotion.
     * @private
     */
    _prunePanels() {
        const live = new Set(this.controller.getTabs().map(t => t.chatKey));
        for (const [chatKey, entry] of this._panelByKey) {
            if (live.has(chatKey)) continue;
            entry.abort?.abort();
            entry.panel.remove();
            this._panelByKey.delete(chatKey);
        }
    }

    /** @private */
    _ensurePanel(tab) {
        let entry = this._panelByKey.get(tab.chatKey);
        if (entry) return entry;

        const panel = document.createElement('div');
        panel.className = 'cp-tab-panel';
        panel.dataset.chatKey = tab.chatKey;
        panel.innerHTML = `
            <div class="cp-tab-transcript" aria-live="polite"></div>
            <div class="cp-tab-composer">
                <textarea class="cp-tab-input text_pole" rows="1" placeholder="Message this chat (secondary profile)…"></textarea>
                <button class="cp-tab-send menu_button" type="button" title="Send">
                    <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
                </button>
            </div>
        `;
        this._panels.appendChild(panel);

        const transcript = panel.querySelector('.cp-tab-transcript');
        const input = panel.querySelector('.cp-tab-input');
        const sendBtn = panel.querySelector('.cp-tab-send');

        entry = { panel, transcript, input, sending: false, abort: null, loaded: false };

        sendBtn.addEventListener('click', () => this._send(tab.chatKey));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._send(tab.chatKey);
            }
        });

        this._panelByKey.set(tab.chatKey, entry);
        return entry;
    }

    // ─────────────────────────────────────────────────────────
    // Transcript
    // ─────────────────────────────────────────────────────────

    /** @private */
    async _loadTranscript(tab, entry) {
        entry.loaded = true;
        entry.transcript.innerHTML = '<div class="cp-tab-loading"><i class="fa-solid fa-spinner fa-spin"></i></div>';
        let messages = [];
        try {
            messages = await CoreAPI.fetchChatMessages(tab.avatar, tab.fileName, false);
        } catch (error) {
            console.warn('[ChatPlus2] Failed to load transcript:', error);
        }
        this._renderMessages(tab, entry, messages);
    }

    /** @private */
    _renderMessages(tab, entry, messages) {
        entry.transcript.textContent = '';
        if (!messages.length) {
            const empty = document.createElement('div');
            empty.className = 'cp-tab-empty';
            empty.textContent = 'No messages yet. Say something to start.';
            entry.transcript.appendChild(empty);
        } else {
            messages.forEach((m) => entry.transcript.appendChild(this._renderMessage(m, tab)));
        }
        this._scrollToBottom(entry);
    }

    /**
     * Render a message. Native mode → a real ST `.mes` node so themes / custom
     * CSS apply. Fallback mode (toggle off) → a simple bubble.
     * @private
     */
    _renderMessage(m, tab) {
        if (this._useNativeStyling()) {
            return CoreAPI.buildChatMessageElement(m, {
                avatar: tab.avatar,
                characterName: tab.characterName,
            });
        }
        return this._renderFallbackMessage(m, tab);
    }

    /** Simple bubble used when "Match main-chat styling" is off. @private */
    _renderFallbackMessage(m, tab) {
        const isUser = !!m.is_user;
        const name = m.name || (isUser ? (CoreAPI.getContext()?.name1 || 'You') : (tab.characterName || tab.avatar));
        const el = document.createElement('div');
        el.className = 'cp-tab-msg' + (isUser ? ' cp-tab-msg--user' : ' cp-tab-msg--char');

        const header = document.createElement('div');
        header.className = 'cp-tab-msg-name';
        header.textContent = name;
        el.appendChild(header);

        const body = document.createElement('div');
        body.className = 'cp-tab-msg-text mes_text';
        body.innerHTML = CoreAPI.formatMessageHtml(m.mes || '', name, isUser, 0);
        el.appendChild(body);
        return el;
    }

    /** @private */
    _scrollToBottom(entry) {
        if (entry?.transcript) entry.transcript.scrollTop = entry.transcript.scrollHeight;
    }

    // ─────────────────────────────────────────────────────────
    // Send
    // ─────────────────────────────────────────────────────────

    /** @private */
    async _send(chatKey) {
        const tab = this.controller.getTab(chatKey);
        const entry = this._panelByKey.get(chatKey);
        if (!tab || !entry || entry.sending) return;

        const text = (entry.input.value || '').trim();
        if (!text) return;
        if (!CoreAPI.isHeadlessSendAvailable()) {
            CoreAPI.showToast('Connection Manager is unavailable — enable it to send.', 'warning');
            return;
        }
        if (!tab.profileId) {
            CoreAPI.showToast('Bind a connection profile (gear icon) to this tab first.', 'warning');
            return;
        }

        entry.sending = true;
        this._setBusy(entry, true);

        // Optimistic user message + a pending AI placeholder, both as native nodes.
        entry.transcript.querySelector('.cp-tab-empty')?.remove();
        entry.transcript.appendChild(this._renderMessage({ is_user: true, mes: text }, tab));
        const pending = this._renderMessage({ is_user: false, mes: '' }, tab);
        pending.classList.add('cp-tab-pending');
        const pendingText = pending.querySelector('.mes_text');
        if (pendingText) pendingText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        entry.transcript.appendChild(pending);
        entry.input.value = '';
        this._scrollToBottom(entry);

        entry.abort = new AbortController();
        try {
            await CoreAPI.sendHeadlessMessage({
                avatar: tab.avatar,
                fileName: tab.fileName,
                profileId: tab.profileId,
                text,
                stream: false,
                signal: entry.abort.signal,
            });
        } catch (error) {
            console.error('[ChatPlus2] Headless send failed:', error);
            CoreAPI.showToast(error?.message || 'Send failed — see console', 'error');
        } finally {
            entry.abort = null;
            entry.sending = false;
            this._setBusy(entry, false);
            // Re-render from the persisted file (drops the optimistic bubbles,
            // shows exactly what was saved). The user turn persists even on error.
            const messages = await CoreAPI.fetchChatMessages(tab.avatar, tab.fileName, false).catch(() => []);
            this._renderMessages(tab, entry, messages);
            entry.input.focus();
        }
    }

    /** @private */
    _setBusy(entry, busy) {
        const sendBtn = entry.panel.querySelector('.cp-tab-send');
        if (sendBtn) sendBtn.disabled = busy;
        entry.input.disabled = busy;
    }

    // ─────────────────────────────────────────────────────────
    // Profile popover (gear)
    // ─────────────────────────────────────────────────────────

    /** @private */
    _openProfilePopover(tab, anchor) {
        this._closePopover();

        const pop = document.createElement('div');
        pop.className = 'cp-tab-profile-popover';
        pop.innerHTML = '<div class="cp-tab-profile-popover-title">Connection profile</div>';

        const select = document.createElement('select');
        select.className = 'cp-tab-profile-select text_pole';

        const profiles = CoreAPI.getConnectionProfiles();
        const none = document.createElement('option');
        none.value = '';
        none.textContent = profiles.length ? '— none —' : '(no profiles configured)';
        select.appendChild(none);

        // Group by API to mirror the API-connection selector's look.
        const byApi = new Map();
        for (const p of profiles) {
            const api = p.api || 'other';
            if (!byApi.has(api)) byApi.set(api, []);
            byApi.get(api).push(p);
        }
        for (const [api, list] of [...byApi.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            const group = document.createElement('optgroup');
            group.label = api;
            list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            for (const p of list) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name || p.id;
                if (p.id === tab.profileId) opt.selected = true;
                group.appendChild(opt);
            }
            select.appendChild(group);
        }

        select.addEventListener('change', () => {
            this.controller.setTabProfile(tab.chatKey, select.value || null);
        });
        pop.appendChild(select);
        document.body.appendChild(pop);

        // Position under the gear icon.
        const rect = anchor.getBoundingClientRect();
        pop.style.top = `${Math.round(rect.bottom + 4)}px`;
        pop.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8))}px`;

        this._popover = pop;
        // Close on outside click (defer so this very click doesn't close it).
        this._onDocClick = (e) => {
            if (this._popover && !this._popover.contains(e.target)) this._closePopover();
        };
        setTimeout(() => document.addEventListener('mousedown', this._onDocClick), 0);
    }

    /** @private */
    _closePopover() {
        if (this._onDocClick) {
            document.removeEventListener('mousedown', this._onDocClick);
            this._onDocClick = null;
        }
        this._popover?.remove();
        this._popover = null;
    }
}
