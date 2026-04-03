/**
 * TabController - Tab switching with state persistence and lazy rendering
 *
 * Manages the three-tab interface (Characters / Recent / Folders).
 * Persists the active tab to settings so it survives reloads.
 * Emits 'tab-activated' via CoreAPI so other modules can lazily render
 * their content only when their tab is first shown.
 *
 * @module TabController
 */

import * as CoreAPI from './core-api.js';

export default class TabController {
    /**
     * @param {import('./state-manager.js').default} stateManager
     */
    constructor(stateManager) {
        this.stateManager = stateManager;

        /** @type {string|null} */
        this.activeTab = null;

        /** @type {NodeListOf<Element>|null} */
        this._buttons = null;

        /** @type {NodeListOf<Element>|null} */
        this._panels = null;

        /** @type {Function|null} Unsubscribe callback for CHAT_CHANGED ST event */
        this._chatChangedUnsub = null;

        /** @type {Map<Element, Function>} Stored click handlers keyed by button element */
        this._clickHandlers = new Map();
    }

    // ─────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────

    /**
     * Wire up DOM event listeners and activate the default tab.
     * Must be called after the HTML template has been injected.
     *
     * @returns {boolean} True if the DOM elements were found and wired successfully.
     */
    init() {
        this._buttons = document.querySelectorAll('[data-chatplus-tab]');
        this._panels = document.querySelectorAll('.chatplus-tab-content');

        if (!this._buttons.length || !this._panels.length) {
            console.error('[TabController] Tab elements not found in DOM');
            return false;
        }

        // Wire click handlers
        this._buttons.forEach(button => {
            const handler = () => {
                const tabName = button.dataset.chatplusTab;

                // If the tab is already active, forward the click to the
                // appropriate native ST button instead of doing nothing.
                if (tabName === this.activeTab) {
                    this._handleReclick(tabName);
                    return;
                }

                this.activateTab(tabName);
            };
            this._clickHandlers.set(button, handler);
            button.addEventListener('click', handler);
        });

        // Subscribe to CHAT_CHANGED for current-chat display updates
        this._chatChangedUnsub = CoreAPI.onSTEvent('CHAT_CHANGED', (data) => {
            this._handleChatChanged(data);
        });

        // Activate persisted default tab (or 'characters' as fallback)
        const defaultTab = this.stateManager.get('defaultTab') || 'characters';
        this.activateTab(defaultTab);

        console.debug('[TabController] Initialized, default tab:', defaultTab);
        return true;
    }

    /**
     * Programmatically switch to a tab by name.
     * Updates DOM active states, saves to settings, and emits an event
     * so modules can lazily render their content.
     *
     * @param {string} name - Tab name matching `data-chatplus-tab` attributes.
     */
    activateTab(name) {
        if (!this._buttons) {
            console.warn('[TabController] activateTab called before init()');
            return;
        }

        // Toggle button active state
        this._buttons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.chatplusTab === name);
        });

        // Toggle panel active state
        this._panels.forEach(panel => {
            panel.classList.toggle('active', panel.dataset.chatplusTab === name);
        });

        this.activeTab = name;

        // Notify other modules (used for lazy rendering, search resets, etc.)
        CoreAPI.emit('tab-activated', { name });

        console.debug('[TabController] Activated tab:', name);
    }

    /**
     * @returns {string|null} The name of the currently active tab.
     */
    getActiveTab() {
        return this.activeTab;
    }

    // ─────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────

    /**
     * Handle CHAT_CHANGED from SillyTavern.
     * Re-emits via the internal bus so the UI layer can react
     * (e.g. highlight the open chat in the Recent list).
     * @private
     */
    _handleChatChanged(data) {
        CoreAPI.emit('chat-changed', data);
    }

    /**
     * Forward a re-click on an already-active tab to the appropriate
     * native SillyTavern button.
     *
     * Characters tab:
     *   - If #rm_ch_create_block is visible (display: block) → click
     *     the first .interactable inside #rm_button_characters
     *     (opens the full character list / character switcher)
     *   - Otherwise → click the first .interactable inside
     *     #rm_button_selected_ch
     *     (opens the selected character's detail view)
     *
     * @private
     * @param {string} tabName
     */
    _handleReclick(tabName) {
        if (tabName !== 'characters') return;

        const createBlock = document.getElementById('rm_ch_create_block');
        const createBlockVisible = createBlock &&
            getComputedStyle(createBlock).display !== 'none';

        const hostId = createBlockVisible
            ? 'rm_button_characters'
            : 'rm_button_selected_ch';

        const host = document.getElementById(hostId);
        if (!host) {
            console.warn(`[TabController] Re-click target #${hostId} not found`);
            return;
        }

        const target = host.classList.contains('interactable')
            ? host
            : host.querySelector('.interactable');

        if (!target) {
            console.warn(`[TabController] No .interactable found inside #${hostId}`);
            return;
        }

        console.debug(`[TabController] Re-click on '${tabName}' → forwarding to #${hostId} .interactable`);
        target.click();
    }

    /**
     * Remove all event subscriptions and DOM handlers.
     * Called by the coordinator when the extension is destroyed.
     */
    destroy() {
        this._chatChangedUnsub?.();
        this._chatChangedUnsub = null;
        this._clickHandlers.forEach((handler, button) => {
            button.removeEventListener('click', handler);
        });
        this._clickHandlers.clear();
        this._buttons = null;
        this._panels = null;
        console.debug('[ChatPlus2] TabController destroyed');
    }
}
