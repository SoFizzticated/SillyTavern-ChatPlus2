/**
 * SearchFilter - Manages search/filter inputs for Recent and Folders tabs
 *
 * Responsibilities:
 * - Wire up search bar inputs with debounced handlers (300ms)
 * - Show/hide the clear (✕) button based on input state
 * - Emit 'search-filter-changed' events via CoreAPI for reactive modules
 * - Provide filterChats() and filterFolders() utility methods
 *
 * Integration:
 *   Modules that display chat lists subscribe to 'search-filter-changed'
 *   via CoreAPI.on() and call filterChats() (or their own logic) to
 *   re-render with the filtered result set.
 *
 * @module SearchFilter
 */

import * as CoreAPI from './core-api.js';

export class SearchFilter {
    static DEBOUNCE_MS = 300;

    constructor() {
        /** @type {{ recent: string, folders: string }} Active query per tab */
        this.queries = { recent: '', folders: '' };

        // Stored listener refs for proper cleanup in destroy()
        this._inputHandlers = new Map();
        this._clearHandlers = new Map();
    }

    // ─────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────

    /**
     * Wire up DOM search elements for both tabs.
     * Must be called after the ChatPlus HTML has been injected into the page.
     */
    init() {
        this._wireTab('recent', 'chatplus-recent-search', 'chatplus-recent-clear');
        this._wireTab('folders', 'chatplus-folders-search', 'chatplus-folders-clear');
        console.debug('[ChatPlus2] SearchFilter initialized');
    }

    // ─────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────

    /**
     * Get the current search query for a given tab.
     * @param {'recent'|'folders'} tab
     * @returns {string}
     */
    getQuery(tab) {
        return this.queries[tab] || '';
    }

    /**
     * Programmatically set a tab's query.
     * Updates the input field value and emits 'search-filter-changed'.
     * @param {'recent'|'folders'} tab
     * @param {string} query
     */
    setQuery(tab, query) {
        this.queries[tab] = query || '';
        const input = document.getElementById(`chatplus-${tab}-search`);
        if (input) input.value = this.queries[tab];
        this._updateClearButton(tab);
        this._emitChange(tab, this.queries[tab]);
    }

    /**
     * Clear the search filter for a tab.
     * @param {'recent'|'folders'} tab
     */
    clear(tab) {
        this.setQuery(tab, '');
    }

    /**
     * Filter an array of chat objects by a query string.
     *
     * Matches (case-insensitive) against:
     *   - chat.character_name
     *   - chat.file_name
     *   - chat.stats.lastMessage
     *
     * @param {Array}  chats - Chat array from ChatRepository
     * @param {string} query - Search string
     * @returns {Array} Filtered array (same object references, no copies)
     */
    filterChats(chats, query) {
        if (!query || !query.trim()) return chats;

        const q = query.trim().toLowerCase();
        return chats.filter(chat =>
            (chat.character_name || '').toLowerCase().includes(q) ||
            (chat.file_name || '').toLowerCase().includes(q) ||
            (chat.stats?.lastMessage || '').toLowerCase().includes(q)
        );
    }

    /**
     * Filter an array of folder objects by a query string.
     * Matches against folder.name (case-insensitive).
     *
     * @param {Array}  folders - Folder objects from FolderSystemManager
     * @param {string} query   - Search string
     * @returns {Array} Filtered array
     */
    filterFolders(folders, query) {
        if (!query || !query.trim()) return folders;

        const q = query.trim().toLowerCase();
        return folders.filter(f => (f.name || '').toLowerCase().includes(q));
    }

    /**
     * Remove all DOM event listeners attached by init().
     * Call when unloading or reloading the extension.
     */
    destroy() {
        for (const [tab, handler] of this._inputHandlers) {
            const input = document.getElementById(`chatplus-${tab}-search`);
            if (input) input.removeEventListener('input', handler);
        }
        for (const [tab, handler] of this._clearHandlers) {
            const btn = document.getElementById(`chatplus-${tab}-clear`);
            if (btn) btn.removeEventListener('click', handler);
        }
        this._inputHandlers.clear();
        this._clearHandlers.clear();
        console.debug('[ChatPlus2] SearchFilter destroyed');
    }

    // ─────────────────────────────────────────
    // PRIVATE
    // ─────────────────────────────────────────

    /**
     * Attach input and clear-button listeners for one tab.
     * @private
     * @param {'recent'|'folders'} tab
     * @param {string} inputId  - ID of the <input> element
     * @param {string} clearId  - ID of the clear (✕) <button> element
     */
    _wireTab(tab, inputId, clearId) {
        const input = document.getElementById(inputId);
        const clearBtn = document.getElementById(clearId);

        if (!input) {
            console.warn(`[ChatPlus2] SearchFilter: #${inputId} not found — skipping tab "${tab}"`);
            return;
        }

        // Build and store the debounced handler so it can be removed in destroy()
        const debouncedInput = CoreAPI.debounce((e) => {
            this.queries[tab] = e.target.value;
            this._updateClearButton(tab);
            this._emitChange(tab, this.queries[tab]);
        }, SearchFilter.DEBOUNCE_MS);

        input.addEventListener('input', debouncedInput);
        this._inputHandlers.set(tab, debouncedInput);

        if (clearBtn) {
            const clearHandler = () => this.clear(tab);
            clearBtn.addEventListener('click', clearHandler);
            this._clearHandlers.set(tab, clearHandler);
        }

        // Set initial visibility of the clear button
        this._updateClearButton(tab);
    }

    /**
     * Show or hide the clear button based on whether the query is non-empty.
     * @private
     * @param {'recent'|'folders'} tab
     */
    _updateClearButton(tab) {
        const clearBtn = document.getElementById(`chatplus-${tab}-clear`);
        if (clearBtn) {
            clearBtn.style.display = this.queries[tab] ? 'block' : 'none';
        }
    }

    /**
     * Emit the 'search-filter-changed' CoreAPI event.
     * @private
     */
    _emitChange(tab, query) {
        CoreAPI.emit('search-filter-changed', { tab, query });
        console.debug(`[ChatPlus2] SearchFilter: "${tab}" → "${query}"`);
    }
}

export default SearchFilter;
