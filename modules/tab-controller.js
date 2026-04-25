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

        /** @type {ResizeObserver|null} Watches tab bar width for compact mode */
        this._resizeObserver = null;

        /** @type {Element|null} The .chatplus-tab-buttons container */
        this._tabBar = null;

        /**
         * SillyTavern's own right-panel scroll container (`.scrollableInner`
         * inside `#right-nav-panel`). Cached at init() time. When the active
         * tab is not `characters` we add `.chatplus-native-hidden` to this
         * element to hide ST's character list / group / create panels
         * without moving any DOM.
         * @type {Element|null}
         */
        this._stNativeContainer = null;

        /**
         * SillyTavern's `#rm_PinAndTabs` bar (selected-char header + token
         * info). Sits between our injected ChatPlus root (which now lives
         * ABOVE it) and `.scrollableInner`. Hidden alongside the native
         * container on non-Characters tabs so our panel reaches the top.
         * @type {Element|null}
         */
        this._stPinAndTabs = null;

        /**
         * MutationObserver watching `#rm_ch_create_block`'s style attribute
         * so we can flip the Characters tab icon between `fa-user` (next
         * click → back to selected card) and `fa-users` (next click → list
         * view) whenever ST's native toggle fires outside our code paths.
         * @type {MutationObserver|null}
         */
        this._charactersIconObserver = null;

        /** @type {Element|null} Cached `<i>` inside the Characters tab icon */
        this._charactersIconEl = null;
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

        // Cache reference to SillyTavern's own scroll container so we can
        // toggle its visibility when switching tabs. If it's missing we
        // simply skip the toggle — ChatPlus panels still work.
        this._stNativeContainer = document.querySelector('#right-nav-panel .scrollableInner');
        if (!this._stNativeContainer) {
            console.warn('[TabController] #right-nav-panel .scrollableInner not found — native visibility toggle disabled');
        }

        // Cache the selected-character / token-info bar that sits between
        // our injected root and `.scrollableInner`. Toggled in lockstep
        // with `_stNativeContainer` so non-Characters tabs render flush
        // against our tab bar instead of leaving the bar visible.
        this._stPinAndTabs = document.getElementById('rm_PinAndTabs');

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

        // Set up ResizeObserver for compact (icon-only) mode
        this._tabBar = document.querySelector('.chatplus-tab-buttons');
        if (this._tabBar) {
            this._resizeObserver = new ResizeObserver(() => this._checkCompactMode());
            this._resizeObserver.observe(this._tabBar);
            // Run once now to set initial state
            this._checkCompactMode();
        }

        // Wire the Characters tab icon state swap (step 43d). The icon
        // reflects what clicking the already-active Characters tab WOULD
        // do: `fa-users` (list view next) when a single card is shown,
        // `fa-user` (card view next) when the list is shown.
        this._charactersIconEl = document.querySelector(
            '[data-chatplus-tab="characters"] .chatplus-tab-icon i'
        );
        this._updateCharactersIcon();
        const createBlock = document.getElementById('rm_ch_create_block');
        if (createBlock && 'MutationObserver' in window) {
            this._charactersIconObserver = new MutationObserver(() => this._updateCharactersIcon());
            this._charactersIconObserver.observe(createBlock, {
                attributes: true,
                attributeFilter: ['style', 'class'],
            });
        }

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

        // Toggle visibility of SillyTavern's own scroll container.
        // Characters tab → show native; any other tab → hide native so our
        // panel takes over the right-panel area. We do NOT touch the inline
        // `display` style of individual right_menu blocks — ST controls that.
        const hideNative = name !== 'characters';
        if (this._stNativeContainer) {
            this._stNativeContainer.classList.toggle('chatplus-native-hidden', hideNative);
        }
        // Hide the selected-character / token-info bar in lockstep so
        // Recent/Folders panels render flush against the ChatPlus tab bar.
        if (this._stPinAndTabs) {
            this._stPinAndTabs.classList.toggle('chatplus-native-hidden', hideNative);
        }

        this.activeTab = name;

        // Keep the Characters icon in sync — activating any tab may have
        // changed what a future Characters re-click would do.
        this._updateCharactersIcon();

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
        // Character selection may have changed; re-evaluate icon state.
        this._updateCharactersIcon();
    }

    /**
     * Check if tab button labels overflow the container and toggle
     * compact (icon-only) mode accordingly.
     * @private
     */
    _checkCompactMode() {
        if (!this._tabBar || !this._buttons) return;

        // Temporarily remove compact mode so we can measure full width
        this._tabBar.classList.remove('chatplus-tabs--compact');

        // Sum of all button natural widths vs available container width
        let totalButtonWidth = 0;
        this._buttons.forEach(btn => {
            totalButtonWidth += btn.scrollWidth;
        });
        // Account for gap between buttons
        const style = getComputedStyle(this._tabBar);
        const gap = parseFloat(style.columnGap) || parseFloat(style.gap) || 0;
        totalButtonWidth += gap * (this._buttons.length - 1);

        if (totalButtonWidth > this._tabBar.clientWidth) {
            this._tabBar.classList.add('chatplus-tabs--compact');
        }
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

        // The re-click flips ST between list and card — update our icon
        // on the next frame once ST has updated `#rm_ch_create_block`.
        requestAnimationFrame(() => this._updateCharactersIcon());
    }

    /**
     * Update the Characters tab icon based on what a future click on the
     * Characters tab would do:
     *   - list visible (#rm_ch_create_block shown) → next click goes to
     *     the selected character card, so show a single-user icon
     *   - card visible → next click goes back to the list, so show a
     *     multi-user icon
     *
     * Mirrors the detection logic in `_handleReclick()`.
     * @private
     */
    _updateCharactersIcon() {
        if (!this._charactersIconEl) return;
        const createBlock = document.getElementById('rm_ch_create_block');
        const listVisible = createBlock
            && getComputedStyle(createBlock).display !== 'none';

        // FA toggles on the `<i>` element's class list. Remove both first
        // so we never end up with both classes after rapid state changes.
        this._charactersIconEl.classList.remove('fa-user', 'fa-users');
        this._charactersIconEl.classList.add(listVisible ? 'fa-user' : 'fa-users');
    }

    /**
     * Remove all event subscriptions and DOM handlers.
     * Called by the coordinator when the extension is destroyed.
     */
    destroy() {
        this._chatChangedUnsub?.();
        this._chatChangedUnsub = null;
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._charactersIconObserver?.disconnect();
        this._charactersIconObserver = null;
        this._charactersIconEl = null;
        this._tabBar = null;
        this._clickHandlers.forEach((handler, button) => {
            button.removeEventListener('click', handler);
        });
        this._clickHandlers.clear();
        this._buttons = null;
        this._panels = null;
        console.debug('[ChatPlus2] TabController destroyed');
    }
}
