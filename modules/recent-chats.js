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
    static PAGE_SIZE_DEFAULT = 100;

    /**
     * @returns {number} Configured page size from settings, or default.
     */
    get pageSize() {
        return CoreAPI.getStateManager()?.get('pageSize') || RecentChatsView.PAGE_SIZE_DEFAULT;
    }

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

        // ── Infinite-scroll plumbing ─────────────────────────────
        // Sentinel lives at the bottom of the rendered list; IntersectionObserver
        // fires `_renderNextPage()` when it enters the viewport (or the
        // preloading rootMargin zone). No visible "Load More" button.
        this._sentinel = null;
        this._observer = null;
        this._loadingMore = false;
        this._reloadBtn = null;

        // Track last-rendered date label / avatar for separator deduplication
        this._lastRenderedDateLabel = null;
        this._lastRenderedAvatar = null;

        // ── Edit / multi-select state ────────────────────────────
        this._editMode = false;
        this._selectedKeys = new Set();
        this._editToggleBtn = null;
        this._bulkToolbarEl = null;
        this._selectedHintEl = null;
        this._toolbarEl = null;

        // Lazy rendering — first render is deferred until the Recent tab is activated
        this._rendered = false;
        this._tabActivatedHandler = ({ name }) => {
            if (name === 'recent' && !this._rendered) {
                this.render().catch(err =>
                    console.error('[ChatPlus2] RecentChatsView lazy render error:', err)
                );
            }
            // Reset edit mode when switching away from Recent tab
            if (name !== 'recent' && this._editMode) {
                this._toggleEditMode(false);
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

        // Refresh after Lost & Found relinks/removes anything, so stale placeholders in the pinned section disappear and the main list reflects the rebuilt ChatRepository cache.
        this._lostFoundResolvedHandler = () => {
            if (!this._rendered) return;
            this.refresh().catch(err =>
                console.error('[ChatPlus2] RecentChatsView lost-found refresh error:', err)
            );
        };
        CoreAPI.on('lost-found-resolved', this._lostFoundResolvedHandler);

        // Re-render from scratch whenever the ChatRepository has been
        // mutated (deletions, future bulk operations, …). The orchestrator
        // (`CoreAPI.deleteChats`) emits this event after cache + state
        // reconciliation; the view's job is purely to repaint with its
        // active filter intact.
        this._repositoryMutatedHandler = () => {
            if (!this._rendered) return;
            this.refresh().catch(err =>
                console.error('[ChatPlus2] RecentChatsView repository-mutated refresh error:', err)
            );
        };
        CoreAPI.on('repository-mutated', this._repositoryMutatedHandler);
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

        if (!this.listContainer) {
            console.warn('[ChatPlus2] RecentChatsView: #chatplus-recent-list not found');
            return;
        }

        this._rendered = true;
        this._setLoading(true);

        // Locate and cache the toolbar wrapper + its primary row.
        // The bulk toolbar and selected-hint are appended to the
        // wrapper (outside the scroll area) so they stay visible
        // while the list scrolls in edit mode.
        if (!this._toolbarEl) {
            this._toolbarEl = this.listContainer.closest('[data-chatplus-tab="recent"]')
                ?.querySelector('.chatplus-recent-toolbar') || null;
        }

        // Inject edit toggle into the primary toolbar row (once)
        if (!this._editToggleBtn && this._toolbarEl) {
            const primaryRow = this._toolbarEl.querySelector('.chatplus-recent-toolbar-primary')
                || this._toolbarEl;
            this._editToggleBtn = this.uiRenderer.renderEditToggle(
                (active) => this._toggleEditMode(active)
            );
            this._editToggleBtn.id = 'chatplus-recent-edit-toggle';
            primaryRow.appendChild(this._editToggleBtn);
        }

        // Wire the reload button once
        this._wireReloadButton();

        try {
            const allChats = await this.chatRepository.getAllChatsWithStats();
            this._allSortedChats = this._sortChats(allChats);
            this.sortedChats = this._filterQuery
                ? this._applyQueryToList(this._allSortedChats, this._filterQuery)
                : this._allSortedChats;
            this.renderedCount = 0;
            this._lastRenderedDateLabel = null;
            this._lastRenderedAvatar = null;

            this._teardownObserver();
            this.listContainer.innerHTML = '';

            if (this.sortedChats.length === 0) {
                const msg = this._filterQuery
                    ? `No chats match "${this._escapeHtml(this._filterQuery)}"`
                    : 'No chats found';
                this.listContainer.innerHTML =
                    `<div class="chatplus-empty-message">${msg}</div>`;
                return;
            }

            // Pinned section is suppressed while a filter is active so a
            // post-mutation re-render (e.g. after delete) doesn't surface
            // pinned chats that don't match the active query — matches
            // applyFilter()'s gating.
            if (!this._filterQuery) {
                this._renderPinnedSection();
            }
            this._renderPage();
            this._updateSentinel();

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
     * Append the next page of chats. Called by the IntersectionObserver
     * when the bottom sentinel enters the viewport / rootMargin zone.
     * @private
     * @returns {Promise<void>}
     */
    async _renderNextPage() {
        if (this._loadingMore || this.isLoading) return;
        if (this.renderedCount >= this.sortedChats.length) return;

        this._loadingMore = true;
        try {
            this._renderPage();
            this._updateSentinel();
        } finally {
            this._loadingMore = false;
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
        this._lastRenderedAvatar = null;
        this._teardownObserver();
        this.listContainer.innerHTML = '';

        if (this.sortedChats.length === 0) {
            const msg = this._filterQuery
                ? `No chats match "${this._escapeHtml(this._filterQuery)}"`
                : 'No chats found';
            this.listContainer.innerHTML =
                `<div class="chatplus-empty-message">${msg}</div>`;
            return;
        }

        // Show pinned section only when no filter is active
        if (!this._filterQuery) {
            this._renderPinnedSection();
        }
        this._renderPage();
        this._updateSentinel();
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
        const orphanKeys = [];

        for (const chatKey of pinnedKeys) {
            const chat = this._allSortedChats.find(
                c => ChatIdentifier.getChatKey(c) === chatKey
            );
            if (!chat) {
                // Stale pin — render an in-place placeholder so the user
                // keeps the spatial layout of their pinned list, and also
                // collect the key for the aggregate notice below.
                orphanKeys.push(chatKey);
                const staleItem = this.uiRenderer.renderStaleChatItem(chatKey, {
                    sources: ['pin'],
                    onClick: (key) => {
                        const lf = CoreAPI.getLostAndFound?.();
                        if (lf && typeof lf.resolveStaleKey === 'function') {
                            lf.resolveStaleKey(key);
                        } else {
                            CoreAPI.showToast('Lost & Found is not available', 'error');
                        }
                    },
                });
                section.appendChild(staleItem);
                anyRendered = true;
                continue;
            }

            const isActive = this._isActiveChat(chat, currentChat);
            const item = this.uiRenderer.renderChatItem(chat, {
                isPinned: true,
                isActive,
                editMode: this._editMode,
                selected: this._selectedKeys.has(chatKey),
                onOpen: (c) => this._openChat(c),
                onPin: (c, key) => this._handlePinToggle(c, key),
                onRename: (c, key) => this._handleRename(c, key),
                onAddToFolder: (c, key, btn) => this._handleAddToFolder(c, key, btn),
                onDelete: (c, key) => this._handleDelete(c, key),
                onSelect: (key, checked) => this._handleSelect(key, checked),
            });
            if (item) {
                section.appendChild(item);
                anyRendered = true;
            }
        }

        // Aggregate "review in Lost & Found" notice at the bottom of the
        // section (clicking opens the resolver scoped to all orphan pins).
        if (orphanKeys.length > 0) {
            const notice = this.uiRenderer.renderUnavailableNotice(
                orphanKeys.length,
                () => {
                    const lf = CoreAPI.getLostAndFound?.();
                    if (lf && typeof lf.openResolverFor === 'function') {
                        lf.openResolverFor(orphanKeys);
                    } else {
                        CoreAPI.showToast('Lost & Found is not available', 'error');
                    }
                }
            );
            section.appendChild(notice);
            anyRendered = true;
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
        // User preference: when true, group Recent rows under per-character
        // separator rows (and render filename-only labels). Default is
        // false — each row shows the "CharName: filename" prefix and no
        // character separators are emitted.
        const groupByCharacter = !!CoreAPI.getStateManager()
            ?.get('recentListGroupByCharacter');

        // When a filter is active, render ALL matched items at once so the user
        // sees the complete result set without needing to paginate.
        const start = this.renderedCount;
        const end = isFiltered
            ? this.sortedChats.length
            : Math.min(start + this.pageSize, this.sortedChats.length);

        const fragment = document.createDocumentFragment();
        const currentChat = CoreAPI.getCurrentChat();

        for (let i = start; i < end; i++) {
            const chat = this.sortedChats[i];

            // Date + character separators are suppressed while a filter is
            // active — filtered views are a flat ranking of matches.
            if (!isFiltered) {
                const dateLabel = this._getDateLabel(chat.stats?.lastMessageDate);
                if (dateLabel && dateLabel !== this._lastRenderedDateLabel) {
                    fragment.appendChild(this.uiRenderer.renderDateSeparator(dateLabel));
                    this._lastRenderedDateLabel = dateLabel;
                    // Force a character separator at the top of each new date bucket
                    this._lastRenderedAvatar = null;
                }

                // Character separator — emitted only when the "Grouped by
                // character" layout preference is enabled.
                if (groupByCharacter) {
                    const currentAvatar = String(chat.avatar || chat.group_id || '');
                    if (currentAvatar && currentAvatar !== this._lastRenderedAvatar) {
                        fragment.appendChild(this.uiRenderer.renderCharacterSeparator(chat));
                        this._lastRenderedAvatar = currentAvatar;
                    }
                }
            }

            const chatKey = ChatIdentifier.getChatKey(chat);
            const isPinned = this.pinnedChatsManager?.isPinned(chatKey) ?? false;
            const isActive = this._isActiveChat(chat, currentChat);

            // In the grouped layout (unfiltered), the character separator
            // above the cluster already shows the entity avatar — hide
            // the per-row thumbnail to avoid the redundant column.
            const hideAvatar = groupByCharacter && !isFiltered;

            const item = this.uiRenderer.renderChatItem(chat, {
                isPinned,
                isActive,
                editMode: this._editMode,
                selected: this._selectedKeys.has(chatKey),
                // Main list rows show filename only when the grouped layout
                // is active (entity is named by the character separator
                // above). Flat layout + filtered views keep the prefix.
                includeEntityPrefix: isFiltered || !groupByCharacter,
                includeAvatar: !hideAvatar,
                onOpen: (c) => this._openChat(c),
                onPin: (c, key) => this._handlePinToggle(c, key),
                onRename: (c, key) => this._handleRename(c, key),
                onAddToFolder: (c, key, btn) => this._handleAddToFolder(c, key, btn),
                onDelete: (c, key) => this._handleDelete(c, key),
                onSelect: (key, checked) => this._handleSelect(key, checked),
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
     * Show folder picker popover and assign the selected chat to a folder.
     * @private
     */
    _handleAddToFolder(chat, chatKey, anchorBtn) {
        const folderSystem = CoreAPI.getFolderSystemManager();
        if (!folderSystem) return;

        const hierarchy = folderSystem.getFolderHierarchy();

        this.uiRenderer.renderFolderPicker(hierarchy, (folderId) => {
            const success = folderSystem.assignChatToFolder(chatKey, folderId);
            if (success) {
                const folder = folderSystem.getAllFolders().find(f => f.id === folderId);
                const folderName = folder?.name || 'folder';
                CoreAPI.showToast(`Added to "${folderName}"`, 'success');
            } else {
                CoreAPI.showToast('Chat is already in that folder', 'info');
            }
        }, anchorBtn);
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

        const success = await CoreAPI.renameChat(chat.avatar, currentName, sanitized, !!chat.is_group);
        if (success) {
            CoreAPI.showToast('Chat renamed', 'success');
            CoreAPI.getChatRepository()?.invalidateAvatar(chat.avatar);
            await this.refresh();
        } else {
            CoreAPI.showToast('Failed to rename chat', 'error');
        }
    }

    /**
     * Toggle edit/multi-select mode and re-render the list.
     * @private
     * @param {boolean} active
     */
    _toggleEditMode(active) {
        this._editMode = active;
        this._selectedKeys.clear();

        // Sync toggle button visual state
        if (this._editToggleBtn) {
            this._editToggleBtn.classList.toggle('chatplus-edit-toggle--active', active);
        }

        // Remove or add the selected-hint + bulk toolbar (inside the
        // sticky `.chatplus-recent-toolbar` wrapper, above the list).
        this._bulkToolbarEl?.remove();
        this._bulkToolbarEl = null;
        this._selectedHintEl?.remove();
        this._selectedHintEl = null;

        if (active && this._toolbarEl) {
            this._selectedHintEl = document.createElement('div');
            this._selectedHintEl.className = 'chatplus-recent-selected-hint';
            this._selectedHintEl.setAttribute('aria-live', 'polite');
            this._selectedHintEl.textContent = '0 selected';
            this._toolbarEl.appendChild(this._selectedHintEl);

            this._bulkToolbarEl = this._buildBulkToolbar();
            this._toolbarEl.appendChild(this._bulkToolbarEl);
        }

        // Re-render to show/hide checkboxes
        if (this._rendered && this.listContainer) {
            this.renderedCount = 0;
            this._lastRenderedDateLabel = null;
            this._lastRenderedAvatar = null;
            this._teardownObserver();
            this.listContainer.innerHTML = '';

            if (this.sortedChats.length === 0) return;

            if (!this._filterQuery) {
                this._renderPinnedSection();
            }
            this._renderPage();
            this._updateSentinel();
        }
    }

    /**
     * Handle checkbox toggle on a single chat item.
     * @private
     */
    _handleSelect(chatKey, checked) {
        if (checked) {
            this._selectedKeys.add(chatKey);
        } else {
            this._selectedKeys.delete(chatKey);
        }
        this._updateSelectedHint();
    }

    /**
     * Update the "N selected" hint text below the search bar.
     * @private
     */
    _updateSelectedHint() {
        if (!this._selectedHintEl) return;
        const n = this._selectedKeys.size;
        this._selectedHintEl.textContent = `${n} selected`;
    }

    /**
     * Build the bulk-action toolbar for the Recent tab edit mode.
     * Note: "Select all" was intentionally removed per UX revision; the
     * selected-count is shown separately as a small hint under the search bar.
     * @private
     * @returns {HTMLElement}
     */
    _buildBulkToolbar() {
        return this.uiRenderer.renderBulkToolbar(
            [
                { label: 'Add to folder', icon: 'fa-solid fa-folder-plus', action: 'add-to-folder' },
                { label: 'Pin', icon: 'fa-solid fa-thumbtack', action: 'pin' },
                { label: 'Delete', icon: 'fa-solid fa-trash', action: 'delete', danger: true },
            ],
            {
                onAction: (action) => this._handleBulkAction(action),
            }
        );
    }

    /**
     * Delete a single chat with confirmation.
     *
     * Delegates the full reconciliation pipeline (server delete →
     * cache refetch → orphan cleanup → view re-render) to
     * `CoreAPI.deleteChats()`. The view itself reacts to the
     * `'repository-mutated'` event and calls `refresh()`, which
     * preserves any active search filter.
     *
     * @private
     */
    async _handleDelete(chat, chatKey) {
        const chatName = chat.file_name || 'this chat';
        const confirmed = await CoreAPI.showConfirmation(
            `Are you sure you want to delete "${chatName}"?`,
            'Delete Chat'
        );
        if (!confirmed) return;

        CoreAPI.showLoadingOverlay('Deleting chat…');
        let result;
        try {
            result = await CoreAPI.deleteChats([chat]);
        } finally {
            CoreAPI.hideLoadingOverlay();
        }

        if (result.deleted > 0) {
            CoreAPI.showToast('Chat deleted', 'success');
        } else {
            CoreAPI.showToast('Failed to delete chat', 'error');
        }
    }

    /**
     * Handle a bulk action from the toolbar.
     * @private
     * @param {string} action
     */
    async _handleBulkAction(action) {
        if (this._selectedKeys.size === 0) {
            CoreAPI.showToast('No chats selected', 'info');
            return;
        }

        const selectedChats = this._allSortedChats.filter(
            c => this._selectedKeys.has(ChatIdentifier.getChatKey(c))
        );

        if (action === 'delete') {
            // Build a friendly confirm body that lists the chats being
            // deleted (44c) — escaping HTML so filenames with `<`/`>`
            // can't inject markup. Limit to 10 entries with a "…and N
            // more" tail to keep the dialog scannable.
            const previewLimit = 10;
            const items = selectedChats.slice(0, previewLimit).map(c => {
                const charName = this._escapeHtml(c.character_name || 'Unknown');
                const fileName = this._escapeHtml(c.file_name || '');
                return `<li><strong>${charName}</strong>: ${fileName}</li>`;
            }).join('');
            const overflow = selectedChats.length > previewLimit
                ? `<p style="opacity: 0.75; margin-top: 6px;">…and ${selectedChats.length - previewLimit} more.</p>`
                : '';
            const confirmHtml =
                `<p>Delete <strong>${selectedChats.length}</strong> chat(s)? This cannot be undone.</p>`
                + `<ul style="text-align: left; margin: 8px 0 0; padding-left: 20px; max-height: 240px; overflow-y: auto;">${items}</ul>`
                + overflow;

            const confirmed = await CoreAPI.showConfirmation(confirmHtml, 'Delete Chats');
            if (!confirmed) return;

            // Delegate the full delete + reconcile pipeline to CoreAPI.
            // Single overlay span across the whole batch (the orchestrator
            // does not show its own overlay — that's the caller's job).
            CoreAPI.showLoadingOverlay(`Deleting ${selectedChats.length} chats…`);
            let result;
            try {
                result = await CoreAPI.deleteChats(selectedChats);
            } finally {
                CoreAPI.hideLoadingOverlay();
            }

            if (result.failed > 0) {
                CoreAPI.showToast(
                    `Deleted ${result.deleted} chat(s); ${result.failed} failed`,
                    result.deleted > 0 ? 'warning' : 'error'
                );
            } else {
                CoreAPI.showToast(`Deleted ${result.deleted} chat(s)`, 'success');
            }
            this._toggleEditMode(false);
            // No explicit refresh() — the 'repository-mutated' event
            // subscription handles re-rendering with the active filter.
            return;
        }

        if (action === 'pin') {
            for (const chat of selectedChats) {
                const key = ChatIdentifier.getChatKey(chat);
                if (!this.pinnedChatsManager?.isPinned(key)) {
                    this.pinnedChatsManager?.togglePin(chat);
                }
            }
            CoreAPI.showToast(`Pinned ${selectedChats.length} chat(s)`, 'success');
            this._toggleEditMode(false);
            await this.refresh();
            return;
        }

        if (action === 'add-to-folder') {
            const folderSystem = CoreAPI.getFolderSystemManager();
            if (!folderSystem) return;

            const hierarchy = folderSystem.getFolderHierarchy();

            // Use the toolbar as anchor for the folder picker
            const anchor = this._bulkToolbarEl || this.listContainer;
            this.uiRenderer.renderFolderPicker(hierarchy, (folderId) => {
                let added = 0;
                for (const chat of selectedChats) {
                    const key = ChatIdentifier.getChatKey(chat);
                    if (folderSystem.assignChatToFolder(key, folderId)) added++;
                }
                const folder = folderSystem.getAllFolders().find(f => f.id === folderId);
                CoreAPI.showToast(`Added ${added} chat(s) to "${folder?.name || 'folder'}"`, 'success');
                this._toggleEditMode(false);
            }, anchor);
            return;
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
     * Sort chats for the Recent list.
     *
     * Two modes, selected by the `recentListGroupByCharacter` setting:
     *
     *  - **Flat (default)**: pure timestamp descending — the most recent
     *    chat first regardless of entity. Matches v1 behaviour.
     *  - **Grouped by character**: composite sort
     *       1. Day bucket descending (most recent days first)
     *       2. Avatar ascending (stable character grouping within a day)
     *       3. Timestamp descending within an avatar group
     *    This clusters all of an entity's same-day chats so the view can
     *    emit a character separator above each cluster — trading strict
     *    minute-level interleaving for clean visual sectioning.
     *
     * Chats with no date land at the end in both modes.
     * @private
     */
    _sortChats(chats) {
        const groupByCharacter = !!CoreAPI.getStateManager()
            ?.get('recentListGroupByCharacter');

        if (!groupByCharacter) {
            // Flat: timestamp desc only
            return [...chats].sort((a, b) => {
                const tA = this._toTimestamp(a.stats?.lastMessageDate);
                const tB = this._toTimestamp(b.stats?.lastMessageDate);
                if (tA === null && tB === null) return 0;
                if (tA === null) return 1;
                if (tB === null) return -1;
                return tB - tA;
            });
        }

        // Grouped: composite sort
        const dayBucket = (ts) => {
            if (ts === null) return null;
            const d = new Date(ts);
            d.setHours(0, 0, 0, 0);
            return d.getTime();
        };

        return [...chats].sort((a, b) => {
            const tA = this._toTimestamp(a.stats?.lastMessageDate);
            const tB = this._toTimestamp(b.stats?.lastMessageDate);

            // Undated chats sink to the bottom
            if (tA === null && tB === null) return 0;
            if (tA === null) return 1;
            if (tB === null) return -1;

            // 1. Day bucket — newest day first
            const dA = dayBucket(tA);
            const dB = dayBucket(tB);
            if (dA !== dB) return dB - dA;

            // 2. Avatar asc — groups of an entity cluster together.
            //    Groups use their stable group_id when avatar is missing.
            const avA = String(a.avatar || a.group_id || '');
            const avB = String(b.avatar || b.group_id || '');
            if (avA !== avB) return avA < avB ? -1 : 1;

            // 3. Timestamp desc within a single entity on a single day
            return tB - tA;
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

    /**
     * Append / reposition the bottom sentinel and (re)attach the
     * IntersectionObserver so that more pages auto-load when the user
     * scrolls near the bottom. No-op while a filter is active
     * (filtered views render all matches at once — no pagination).
     * @private
     */
    _updateSentinel() {
        if (!this.listContainer) return;

        // No sentinel when filter is active or when everything is rendered
        if (this._filterQuery || this.renderedCount >= this.sortedChats.length) {
            this._teardownObserver();
            return;
        }

        if (!this._sentinel) {
            this._sentinel = document.createElement('div');
            this._sentinel.className = 'chatplus-recent-sentinel';
            this._sentinel.setAttribute('aria-hidden', 'true');
        }

        // Always keep the sentinel at the tail of the list
        if (this._sentinel.parentElement !== this.listContainer ||
            this._sentinel !== this.listContainer.lastElementChild) {
            this.listContainer.appendChild(this._sentinel);
        }

        // Lazy-create the observer once the sentinel is attached
        if (!this._observer) {
            const root = this._findScrollAncestor(this.listContainer);
            this._observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        this._renderNextPage().catch(err =>
                            console.error('[ChatPlus2] RecentChatsView sentinel render error:', err)
                        );
                    }
                }
            }, { root, rootMargin: '200px 0px', threshold: 0 });
        }

        // Observe the (possibly re-positioned) sentinel
        this._observer.observe(this._sentinel);
    }

    /**
     * Disconnect the observer and detach the sentinel.
     * Called on render/applyFilter/destroy to avoid stale subscriptions.
     * @private
     */
    _teardownObserver() {
        if (this._observer) {
            this._observer.disconnect();
        }
        if (this._sentinel?.parentElement) {
            this._sentinel.remove();
        }
    }

    /**
     * Walk up from `el` to find the nearest scrollable ancestor.
     * Falls back to `null` (viewport) if none is found.
     * @private
     */
    _findScrollAncestor(el) {
        let node = el?.parentElement;
        while (node && node !== document.body && node !== document.documentElement) {
            const style = window.getComputedStyle(node);
            const overflowY = style.overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
                node.scrollHeight > node.clientHeight) {
                return node;
            }
            node = node.parentElement;
        }
        return null; // viewport
    }

    /**
     * Wire the toolbar reload button (once) to force a full chat-index
     * refresh and re-render the list. Shows a spinner while in-flight.
     * @private
     */
    _wireReloadButton() {
        if (this._reloadBtn) return;

        const btn = document.getElementById('chatplus-recent-reload');
        if (!btn) return;

        this._reloadBtn = btn;
        btn._chatplusHandler = async () => {
            if (btn.disabled) return;
            const icon = btn.querySelector('i');
            const originalClass = icon?.className;
            btn.disabled = true;
            if (icon) icon.className = 'fa-solid fa-rotate-right fa-spin';

            try {
                await this.chatRepository.rebuildIndex();
                await this.refresh();
                CoreAPI.showToast('Chat list refreshed', 'success');
            } catch (error) {
                console.error('[ChatPlus2] RecentChatsView reload error:', error);
                CoreAPI.showToast('Failed to refresh chat list', 'error');
            } finally {
                btn.disabled = false;
                if (icon && originalClass) icon.className = originalClass;
            }
        };
        btn.addEventListener('click', btn._chatplusHandler);
    }

    _setLoading(state) {
        this.isLoading = state;
    }

    async _openChat(chat) {
        try {
            const ok = await CoreAPI.openChat({
                file_name: chat.file_name,
                avatar: chat.avatar,
                groupId: chat.group_id || null,
                is_group: !!chat.group_id,
            });
            // CoreAPI.openChat shows its own toast on failure; nothing more to do.
            return ok;
        } catch (error) {
            console.error('[ChatPlus2] Error opening chat:', error);
            CoreAPI.showToast('Failed to open chat', 'error');
            return false;
        }
    }

    /**
     * Remove all CoreAPI event subscriptions and DOM handlers.
     * Called by the coordinator when the extension is destroyed.
     */
    destroy() {
        CoreAPI.off('tab-activated', this._tabActivatedHandler);
        CoreAPI.off('search-filter-changed', this._searchFilterHandler);
        CoreAPI.off('lost-found-resolved', this._lostFoundResolvedHandler);
        CoreAPI.off('repository-mutated', this._repositoryMutatedHandler);
        this._teardownObserver();
        this._observer = null;
        this._sentinel = null;
        if (this._reloadBtn?._chatplusHandler) {
            this._reloadBtn.removeEventListener('click', this._reloadBtn._chatplusHandler);
            delete this._reloadBtn._chatplusHandler;
        }
        this._reloadBtn = null;
        this._editToggleBtn?.remove();
        this._editToggleBtn = null;
        this._bulkToolbarEl?.remove();
        this._bulkToolbarEl = null;
        this._selectedHintEl?.remove();
        this._selectedHintEl = null;
        this._toolbarEl = null;
        this._selectedKeys.clear();
        console.debug('[ChatPlus2] RecentChatsView destroyed');
    }
}

export default RecentChatsView;
