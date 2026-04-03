/**
 * RecentChatsView - Paginated list of all chats sorted by recency
 *
 * Renders chats sorted by last message timestamp descending.
 * Groups with date separators (Today, Yesterday, weekday, or absolute date).
 * Supports 100-chat pages via a "Load More" button.
 *
 * @module RecentChatsView
 */

import * as CoreAPI from './core-api.js';
import * as ChatIdentifier from '../utils/chat-identifier.js';
import UIRenderer from './ui-renderer.js';

export class RecentChatsView {
    static PAGE_SIZE = 100;

    /**
     * @param {Object} chatRepository    - ChatRepository instance
     * @param {Object} pinnedChatsManager - PinnedChatsManager instance
     */
    constructor(chatRepository, pinnedChatsManager) {
        if (!chatRepository) throw new Error('[ChatPlus2] RecentChatsView requires ChatRepository');

        this.chatRepository = chatRepository;
        this.pinnedChatsManager = pinnedChatsManager;

        // Shared renderer — stateless DOM factory
        this.uiRenderer = new UIRenderer();

        // Full sorted list (never modified by filters) and the active view list
        this._allSortedChats = [];
        this.sortedChats = [];
        this.renderedCount = 0;
        this.isLoading = false;

        // Active filter query — empty string means no filter
        this._filterQuery = '';

        // DOM references (set during render)
        this.listContainer = null;
        this.loadMoreButton = null;

        // Track last-rendered date label for separator deduplication
        this._lastRenderedDateLabel = null;

        // Lazy rendering — first render is deferred until the Recent tab is activated
        this._rendered = false;
        this._tabActivatedHandler = ({ name }) => {
            if (name === 'recent' && !this._rendered) {
                this.render().catch(err =>
                    console.error('[ChatPlus2] RecentChatsView lazy render error:', err)
                );
            }
        };
        CoreAPI.on('tab-activated', this._tabActivatedHandler);

        // React to SearchFilter events
        this._searchFilterHandler = ({ tab, query }) => {
            if (tab === 'recent') {
                this.applyFilter(query).catch(err =>
                    console.error('[ChatPlus2] RecentChatsView filter error:', err)
                );
            }
        };
        CoreAPI.on('search-filter-changed', this._searchFilterHandler);
    }

    // ─────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────

    /**
     * Initial render: load stats, sort, render first page.
     * @returns {Promise<void>}
     */
    async render() {
        this.listContainer = document.getElementById('chatplus-recent-list');
        this.loadMoreButton = document.getElementById('chatplus-load-more');

        if (!this.listContainer) {
            console.warn('[ChatPlus2] RecentChatsView: #chatplus-recent-list not found');
            return;
        }

        this._rendered = true;
        this._setLoading(true);

        try {
            const allChats = await this.chatRepository.getAllChatsWithStats();
            this._allSortedChats = this._sortChats(allChats);
            this.sortedChats = this._filterQuery
                ? this._applyQueryToList(this._allSortedChats, this._filterQuery)
                : this._allSortedChats;
            this.renderedCount = 0;
            this._lastRenderedDateLabel = null;

            this.listContainer.innerHTML = '';

            if (this.sortedChats.length === 0) {
                const msg = this._filterQuery
                    ? `No chats match "${this._escapeHtml(this._filterQuery)}"`
                    : 'No chats found';
                this.listContainer.innerHTML =
                    `<div class="chatplus-empty-message">${msg}</div>`;
                this._hideLoadMore();
                return;
            }

            this._renderPinnedSection();
            this._renderPage();
            this._updateLoadMoreButton();

            console.debug(`[ChatPlus2] RecentChatsView rendered ${this.renderedCount} of ${this.sortedChats.length} chats`);
        } catch (error) {
            console.error('[ChatPlus2] RecentChatsView render error:', error);
            this.listContainer.innerHTML =
                '<div class="chatplus-empty-message">Failed to load chats</div>';
        } finally {
            this._setLoading(false);
        }
    }

    /**
     * Append the next page of chats (Load More).
     * @returns {Promise<void>}
     */
    async loadMore() {
        if (this.isLoading || this.renderedCount >= this.sortedChats.length) return;

        this._setLoading(true);

        try {
            this._renderPage();
            this._updateLoadMoreButton();
        } finally {
            this._setLoading(false);
        }
    }

    /**
     * Re-fetch and re-render the full list (called after ST events).
     * @returns {Promise<void>}
     */
    async refresh() {
        await this.render();
    }

    /**
     * Apply a search filter and re-render the list.
     *
     * Called automatically when a 'search-filter-changed' event fires for the
     * 'recent' tab. Also safe to call programmatically.
     *
     * When a filter is active:
     *   - All matched results are shown at once (pagination is suppressed)
     *   - Date separators are hidden (flat list for clarity)
     *
     * @param {string} query - Search string (empty string clears the filter)
     * @returns {Promise<void>}
     */
    async applyFilter(query) {
        this._filterQuery = query || '';

        // If render() hasn't run yet, the filter will be applied automatically
        // when the tab is first activated — nothing more to do here.
        if (!this._rendered || !this.listContainer) return;

        this.sortedChats = this._filterQuery
            ? this._applyQueryToList(this._allSortedChats, this._filterQuery)
            : this._allSortedChats;

        this.renderedCount = 0;
        this._lastRenderedDateLabel = null;
        this.listContainer.innerHTML = '';

        if (this.sortedChats.length === 0) {
            const msg = this._filterQuery
                ? `No chats match "${this._escapeHtml(this._filterQuery)}"`
                : 'No chats found';
            this.listContainer.innerHTML =
                `<div class="chatplus-empty-message">${msg}</div>`;
            this._hideLoadMore();
            return;
        }

        // Show pinned section only when no filter is active
        if (!this._filterQuery) {
            this._renderPinnedSection();
        }
        this._renderPage();
        this._updateLoadMoreButton();
    }

    // ─────────────────────────────────────────
    // PRIVATE – RENDERING
    // ─────────────────────────────────────────

    /**
     * Render the next PAGE_SIZE chats into the list container.
     * Delegates DOM creation to UIRenderer.
     * @private
     */
    /**
     * Render (or re-render) the pinned-chats section at the top of the list.
     * Pinned chats also remain in the main chronological list below.
     * @private
     */
    _renderPinnedSection() {
        this._removeExistingPinnedSection();

        if (!this.pinnedChatsManager) return;

        const pinnedKeys = this.pinnedChatsManager.getPinnedKeys();
        if (pinnedKeys.length === 0) return;

        const section = document.createElement('div');
        section.className = 'chatplus-pinned-section';
        section.appendChild(this.uiRenderer.renderSectionHeader('\uD83D\uDCCC Pinned Chats', 'pinned'));

        const currentChat = CoreAPI.getCurrentChat();
        let anyRendered = false;

        for (const chatKey of pinnedKeys) {
            const chat = this._allSortedChats.find(
                c => ChatIdentifier.getChatKey(c) === chatKey
            );
            if (!chat) continue; // orphaned pin — skip

            const isActive = this._isActiveChat(chat, currentChat);
            const item = this.uiRenderer.renderChatItem(chat, {
                isPinned: true,
                isActive,
                onOpen: (c) => this._openChat(c),
                onPin: (c, key) => this._handlePinToggle(c, key),
                onRename: (c, key) => this._handleRename(c, key),
            });
            if (item) {
                section.appendChild(item);
                anyRendered = true;
            }
        }

        // Only insert the section if at least one pinned chat resolved
        if (anyRendered) {
            this.listContainer.prepend(section);
        }
    }

    /**
     * Remove an existing pinned section from the container if one is present.
     * @private
     */
    _removeExistingPinnedSection() {
        const existing = this.listContainer?.querySelector('.chatplus-pinned-section');
        if (existing) existing.remove();
    }

    _renderPage() {
        const isFiltered = this._filterQuery !== '';

        // When a filter is active, render ALL matched items at once so the user
        // sees the complete result set without needing to paginate.
        const start = this.renderedCount;
        const end = isFiltered
            ? this.sortedChats.length
            : Math.min(start + RecentChatsView.PAGE_SIZE, this.sortedChats.length);

        const fragment = document.createDocumentFragment();
        const currentChat = CoreAPI.getCurrentChat();

        for (let i = start; i < end; i++) {
            const chat = this.sortedChats[i];

            // Date separators are suppressed while a filter is active (flat list)
            if (!isFiltered) {
                const dateLabel = this._getDateLabel(chat.stats?.lastMessageDate);
                if (dateLabel && dateLabel !== this._lastRenderedDateLabel) {
                    fragment.appendChild(this.uiRenderer.renderDateSeparator(dateLabel));
                    this._lastRenderedDateLabel = dateLabel;
                }
            }

            const chatKey = ChatIdentifier.getChatKey(chat);
            const isPinned = this.pinnedChatsManager?.isPinned(chatKey) ?? false;
            const isActive = this._isActiveChat(chat, currentChat);

            const item = this.uiRenderer.renderChatItem(chat, {
                isPinned,
                isActive,
                onOpen: (c) => this._openChat(c),
                onPin: (c, key) => this._handlePinToggle(c, key),
                onRename: (c, key) => this._handleRename(c, key),
            });
            if (item) fragment.appendChild(item);
        }

        this.listContainer.appendChild(fragment);
        this.renderedCount = end;
    }

    // ─────────────────────────────────────────
    // PRIVATE – INTERACTION HANDLERS
    // ─────────────────────────────────────────

    /**
     * Toggle pin state for a chat and optimistically update its DOM element.
     * @private
     */
    _handlePinToggle(chat, chatKey) {
        if (!this.pinnedChatsManager) return;

        this.pinnedChatsManager.togglePin(chat);
        const newPinned = this.pinnedChatsManager.isPinned(chatKey);

        // Optimistic DOM update on the item(s) in the main list
        this.listContainer?.querySelectorAll(
            `[data-chat-key="${CSS.escape(chatKey)}"]`
        ).forEach(item => {
            // Skip the copy inside the pinned section — it will be rebuilt below
            if (item.closest('.chatplus-pinned-section')) return;

            item.classList.toggle('chatplus-chat-item--pinned', newPinned);
            const pinBtn = item.querySelector('[data-pin-btn]');
            if (pinBtn) {
                const icon = pinBtn.querySelector('i');
                if (icon) icon.className = newPinned
                    ? 'fa-solid fa-thumbtack'
                    : 'fa-regular fa-thumbtack';
                pinBtn.classList.toggle('chatplus-action-btn--pinned', newPinned);
                const label = newPinned ? 'Unpin chat' : 'Pin chat';
                pinBtn.title = label;
                pinBtn.setAttribute('aria-label', label);
            }
        });

        // Rebuild pinned section in-memory (no network call needed)
        if (!this._filterQuery) {
            this._renderPinnedSection();
        }
    }

    /**
     * Prompt the user for a new name and rename the chat via the API.
     * @private
     */
    async _handleRename(chat, chatKey) {
        const currentName = chat.file_name || '';
        const newName = await CoreAPI.showInput(
            `Rename "${currentName}" to:`,
            currentName,
            'Rename Chat'
        );

        if (!newName || newName.trim() === currentName) return;

        const sanitized = CoreAPI.sanitizeFilename(newName.trim());
        if (!sanitized) {
            CoreAPI.showToast('Invalid chat name — please avoid special characters.', 'error');
            return;
        }

        const success = await CoreAPI.renameChat(chat.avatar, currentName, sanitized);
        if (success) {
            CoreAPI.showToast('Chat renamed', 'success');
            CoreAPI.getChatRepository()?.invalidateAvatar(chat.avatar);
            await this.refresh();
        } else {
            CoreAPI.showToast('Failed to rename chat', 'error');
        }
    }

    /**
     * Returns true if `chat` is the chat the user currently has open.
     * @private
     */
    _isActiveChat(chat, currentChat) {
        if (!currentChat) return false;
        if (chat.group_id) {
            return currentChat.isGroup
                && currentChat.groupId === chat.group_id
                && currentChat.chatId === chat.file_name;
        }
        return !currentChat.isGroup && currentChat.chatId === chat.file_name;
    }

    // ─────────────────────────────────────────
    // PRIVATE – SORTING & DATE HELPERS
    // ─────────────────────────────────────────

    /**
     * Sort chats by last message date descending.
     * Chats with no date are placed at the end.
     * @private
     */
    _sortChats(chats) {
        return [...chats].sort((a, b) => {
            const tA = this._toTimestamp(a.stats?.lastMessageDate);
            const tB = this._toTimestamp(b.stats?.lastMessageDate);
            if (tA === null && tB === null) return 0;
            if (tA === null) return 1;
            if (tB === null) return -1;
            return tB - tA; // newest first
        });
    }

    /**
     * Convert a date value to a numeric timestamp.
     * Handles unix seconds, unix ms, and string dates.
     * @private
     * @returns {number|null}
     */
    _toTimestamp(value) {
        if (value == null) return null;

        if (typeof value === 'number') {
            // Unix seconds < year 3000 heuristic
            return value < 9999999999 ? value * 1000 : value;
        }

        if (typeof value === 'string') {
            const parsed = Date.parse(value);
            return isNaN(parsed) ? null : parsed;
        }

        return null;
    }

    /**
     * Get a human-readable day label for a date value.
     * Returns null if the date is invalid.
     * @private
     * @returns {string|null}
     */
    _getDateLabel(value) {
        const ts = this._toTimestamp(value);
        if (ts === null) return null;

        if (window.moment) {
            const d = window.moment(ts);
            const today = window.moment().startOf('day');
            const diff = today.diff(d.clone().startOf('day'), 'days');

            if (diff === 0) return 'Today';
            if (diff === 1) return 'Yesterday';
            if (diff < 7) return d.format('dddd');               // "Monday"
            if (d.isSame(window.moment(), 'year')) return d.format('MMMM D'); // "March 9"
            return d.format('MMMM D, YYYY');
        }

        // Fallback — no moment.js
        const msgDate = new Date(ts);
        msgDate.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.round((today - msgDate) / 86400000);

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        return new Date(ts).toLocaleDateString();
    }

    /**
     * Filter a sorted chat array by a query string.
     * Delegates to the registered SearchFilter module when available;
     * falls back to an inline implementation to avoid hard coupling.
     * @private
     */
    _applyQueryToList(chats, query) {
        const searchFilter = CoreAPI.getModule('SearchFilter');
        if (searchFilter) return searchFilter.filterChats(chats, query);

        // Inline fallback
        const q = query.trim().toLowerCase();
        return chats.filter(c =>
            (c.character_name || '').toLowerCase().includes(q) ||
            (c.file_name || '').toLowerCase().includes(q) ||
            (c.stats?.lastMessage || '').toLowerCase().includes(q)
        );
    }

    /**
     * Escape a string for safe insertion into innerHTML.
     * @private
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ─────────────────────────────────────────
    // PRIVATE – UI HELPERS
    // ─────────────────────────────────────────

    _updateLoadMoreButton() {
        if (!this.loadMoreButton) return;

        // Never show "Load More" while a filter is active — all results are rendered at once
        if (this._filterQuery) {
            this._hideLoadMore();
            return;
        }

        if (this.renderedCount < this.sortedChats.length) {
            this.loadMoreButton.style.display = '';
            this.loadMoreButton.textContent =
                `Load More (${this.sortedChats.length - this.renderedCount} remaining)`;

            // Attach handler once
            if (!this.loadMoreButton._chatplusHandler) {
                this.loadMoreButton._chatplusHandler = () => this.loadMore();
                this.loadMoreButton.addEventListener('click', this.loadMoreButton._chatplusHandler);
            }
        } else {
            this._hideLoadMore();
        }
    }

    _hideLoadMore() {
        if (this.loadMoreButton) this.loadMoreButton.style.display = 'none';
    }

    _setLoading(state) {
        this.isLoading = state;
        if (this.loadMoreButton) {
            this.loadMoreButton.disabled = state;
        }
    }

    _openChat(chat) {
        try {
            CoreAPI.openChat({
                file_name: chat.file_name,
                avatar: chat.avatar,
                groupId: chat.group_id || null,
                is_group: !!chat.group_id,
            });
        } catch (error) {
            console.error('[ChatPlus2] Error opening chat:', error);
            CoreAPI.showToast('Failed to open chat', 'error');
        }
    }

    /**
     * Remove all CoreAPI event subscriptions and DOM handlers.
     * Called by the coordinator when the extension is destroyed.
     */
    destroy() {
        CoreAPI.off('tab-activated', this._tabActivatedHandler);
        CoreAPI.off('search-filter-changed', this._searchFilterHandler);
        if (this.loadMoreButton?._chatplusHandler) {
            this.loadMoreButton.removeEventListener('click', this.loadMoreButton._chatplusHandler);
            delete this.loadMoreButton._chatplusHandler;
        }
        console.debug('[ChatPlus2] RecentChatsView destroyed');
    }
}

export default RecentChatsView;
