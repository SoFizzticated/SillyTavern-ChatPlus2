/**
 * FoldersView - Renders and manages the Folders tab UI
 *
 * Lazy-renders when the 'folders' tab is first activated.
 * Re-renders whenever 'folders-changed' or 'chat-folders-changed' fires.
 * Non-empty folders start expanded; empty folders start collapsed.
 *
 * Structure per folder (from template):
 *   .chatplus-folder-header  — title row (chevron, icon, name, rename/subfolder/gear)
 *   .chatplus-folder-body    — hidden when collapsed
 *     .chatplus-folder-options-bar  — hidden by default; gear toggles
 *       [Add Chats] [Remove Chats] [Delete Folder]
 *     .chatplus-folder-content-wrapper
 *       .chatplus-folder-contents  — subfolders + assigned chats
 *       .chatplus-folder-add-panel — search + checklist (hidden; swapped in by "Add Chats")
 *     .chatplus-remove-footer      — sticky footer for remove mode
 *
 * @module FoldersView
 */

import * as CoreAPI from './core-api.js';
import * as ChatIdentifier from '../utils/chat-identifier.js';
import UIRenderer from './ui-renderer.js';

export class FoldersView {
    /**
     * @param {Object} folderSystemManager - FolderSystemManager instance
     * @param {Object} chatRepository      - ChatRepository instance
     */
    constructor(folderSystemManager, chatRepository) {
        if (!folderSystemManager) throw new Error('[ChatPlus2] FoldersView requires FolderSystemManager');

        this.folderSystemManager = folderSystemManager;
        this.chatRepository = chatRepository;

        this.uiRenderer = new UIRenderer();

        /** @type {HTMLElement|null} */
        this.listContainer = null;

        /** Whether the first render has run */
        this._rendered = false;

        /** Guards against wiring the New Folder button more than once */
        this._newFolderBtnWired = false;

        /** Stored bound handler references so they can be unsubscribed */
        this._tabActivatedHandler = ({ name }) => {
            if (name === 'folders' && !this._rendered) {
                this.render().catch(err =>
                    console.error('[ChatPlus2] FoldersView lazy render error:', err)
                );
            }
        };

        this._foldersChangedHandler = () => {
            if (this._rendered) {
                this.render().catch(err =>
                    console.error('[ChatPlus2] FoldersView re-render error:', err)
                );
            }
        };

        this._chatFoldersChangedHandler = this._foldersChangedHandler;

        // Refresh after Lost & Found relinks/removes anything, so stale placeholders are replaced by live items (or disappear) without requiring the user to switch tabs.
        this._lostFoundResolvedHandler = this._foldersChangedHandler;

        // Re-render after any ChatRepository mutation (e.g. deletions via
        // CoreAPI.deleteChats). Reuses the same idempotent render handler.
        this._repositoryMutatedHandler = this._foldersChangedHandler;

        CoreAPI.on('tab-activated', this._tabActivatedHandler);
        CoreAPI.on('folders-changed', this._foldersChangedHandler);
        CoreAPI.on('chat-folders-changed', this._chatFoldersChangedHandler);
        CoreAPI.on('lost-found-resolved', this._lostFoundResolvedHandler);
        CoreAPI.on('repository-mutated', this._repositoryMutatedHandler);
    }

    // ─────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────

    /**
     * Render (or re-render) the full folder tree.
     * @returns {Promise<void>}
     */
    async render() {
        this.listContainer = document.getElementById('chatplus-folders-list');

        if (!this.listContainer) {
            console.warn('[ChatPlus2] FoldersView: #chatplus-folders-list not found');
            return;
        }

        this._rendered = true;
        this._wireNewFolderButton();

        const roots = this.folderSystemManager.getFolderHierarchy();

        this.listContainer.innerHTML = '';

        if (roots.length === 0) {
            this.listContainer.appendChild(
                this.uiRenderer.renderEmptyMessage('No folders yet. Click "+ New Folder" to create one.')
            );
            return;
        }

        this._renderFolderTree(roots, this.listContainer, 0);

        console.debug(`[ChatPlus2] FoldersView rendered ${this.folderSystemManager.getFolderCount()} folders`);
    }

    /**
     * Remove event subscriptions and button listener.
     */
    destroy() {
        CoreAPI.off('tab-activated', this._tabActivatedHandler);
        CoreAPI.off('folders-changed', this._foldersChangedHandler);
        CoreAPI.off('chat-folders-changed', this._chatFoldersChangedHandler);
        CoreAPI.off('lost-found-resolved', this._lostFoundResolvedHandler);
        CoreAPI.off('repository-mutated', this._repositoryMutatedHandler);

        const btn = document.getElementById('chatplus-new-folder');
        if (btn && btn._chatplusFolderHandler) {
            btn.removeEventListener('click', btn._chatplusFolderHandler);
            delete btn._chatplusFolderHandler;
        }

        this._newFolderBtnWired = false;
        this.listContainer = null;
        this._rendered = false;

        console.debug('[ChatPlus2] FoldersView destroyed');
    }

    // ─────────────────────────────────────────
    // PRIVATE – RENDERING
    // ─────────────────────────────────────────

    /**
     * Recursively render an array of folder objects into a container.
     * Empty folders (no chats AND no sub-folders) render collapsed; others expanded.
     *
     * @param {Array}       folders   - Array of folder objects
     * @param {HTMLElement} container - DOM node to append into
     * @param {number}      level     - Nesting depth (0 = root)
     * @private
     */
    _renderFolderTree(folders, container, level) {
        const allFolders = this.folderSystemManager.getAllFolders();
        const expandedSet = this._getExpandedSet();
        const tabsEnabled = CoreAPI.getStateManager()?.get('tabsEnabled') !== false;

        for (const folder of folders) {
            const chatCount = this.folderSystemManager.getFolderChats(folder.id, false).length;
            const subFolderCount = allFolders.filter(f => f.parent === folder.id).length;
            const isEmpty = chatCount === 0 && subFolderCount === 0;

            // Use persisted state if available, otherwise default: non-empty = expanded
            const shouldExpand = expandedSet
                ? expandedSet.has(folder.id)
                : !isEmpty;

            const el = this.uiRenderer.renderFolder(folder, level, {
                expanded: shouldExpand,
                // "Open as tabs" only when the chat-tabs feature is on AND the
                // folder actually has chats to open.
                onOpenAsTabs: (tabsEnabled && chatCount > 0)
                    ? (f) => this._openFolderAsTabs(f.id)
                    : undefined,
                onExpand: (folderId, folderEl) =>
                    this._onExpand(folderId, folderEl, level + 1),
                onRename: (f) => this._onRename(f),
                onCreateSubfolder: (f) => this._onCreateSubfolder(f.id),
                onToggleOptions: (_f, gearBtn) =>
                    this._onToggleOptions(el, gearBtn),
                onToggleExpand: (folderId, isExpanded) =>
                    this._onToggleExpand(folderId, isExpanded),
            });

            container.appendChild(el);
        }
    }

    /**
     * Open every (resolvable, non-group) chat in a folder as a secondary tab.
     * Reuses ChatTabsController.openSecondaryTab, which de-dupes and focuses
     * already-open chats. Groups and orphaned keys are skipped.
     *
     * @param {string} folderId
     * @private
     */
    async _openFolderAsTabs(folderId) {
        const controller = CoreAPI.getModule('ChatTabsController');
        if (!controller) {
            CoreAPI.showToast('Chat tabs are not available', 'error');
            return;
        }

        const keys = this.folderSystemManager.getFolderChats(folderId, false);
        const chats = [];
        let skippedGroups = 0;
        let skippedOrphans = 0;

        for (const key of keys) {
            const chat = this.chatRepository?.getChatByKey(key);
            if (!chat) { skippedOrphans++; continue; }
            if (chat.group_id) { skippedGroups++; continue; }
            chats.push(chat);
        }

        if (chats.length === 0) {
            CoreAPI.showToast('No openable chats in this folder (groups and unresolved chats are skipped)', 'info');
            return;
        }

        // Opening a large folder spawns a lot of tabs — confirm first.
        if (chats.length > 10) {
            const ok = await CoreAPI.showConfirmation(
                `Open ${chats.length} chats as tabs?`,
                'Open folder as tabs'
            );
            if (!ok) return;
        }

        for (const chat of chats) controller.openSecondaryTab(chat);

        const extras = [];
        if (skippedGroups) extras.push(`${skippedGroups} group${skippedGroups !== 1 ? 's' : ''}`);
        if (skippedOrphans) extras.push(`${skippedOrphans} unresolved`);
        const suffix = extras.length ? ` (skipped ${extras.join(', ')})` : '';
        CoreAPI.showToast(`Opened ${chats.length} chat${chats.length !== 1 ? 's' : ''} as tabs${suffix}`, 'success');
    }

    /**
     * Get the set of expanded folder IDs from persisted settings.
     * Returns null on first-ever render (no persisted state yet) so the
     * caller can fall back to the default heuristic.
     *
     * @returns {Set<string>|null}
     * @private
     */
    _getExpandedSet() {
        const stateManager = CoreAPI.getStateManager();
        const arr = stateManager?.get('expandedFolders');
        if (!Array.isArray(arr)) return null;
        return new Set(arr);
    }

    /**
     * Persist a folder's expanded/collapsed state.
     *
     * @param {string}  folderId   - Folder ID
     * @param {boolean} isExpanded - Whether the folder is now expanded
     * @private
     */
    _onToggleExpand(folderId, isExpanded) {
        const stateManager = CoreAPI.getStateManager();
        if (!stateManager) return;

        const arr = stateManager.get('expandedFolders') || [];
        const set = new Set(arr);

        if (isExpanded) set.add(folderId);
        else set.delete(folderId);

        stateManager.set('expandedFolders', [...set]);
    }

    /**
     * Handle gear button click — toggle options bar visibility.
     * If the folder is collapsed, expand it first.
     *
     * @param {HTMLElement} folderEl - The .chatplus-folder-item element
     * @param {HTMLElement} gearBtn  - The gear action button
     * @private
     */
    _onToggleOptions(folderEl, gearBtn) {
        const body = folderEl.querySelector('.chatplus-folder-body');
        const optionsBar = folderEl.querySelector('.chatplus-folder-options-bar');
        if (!body || !optionsBar) return;

        const isExpanded = !body.hidden;

        if (!isExpanded) {
            // Folder is collapsed → expand it, then show options bar
            folderEl.querySelector('.chatplus-folder-header')?.click();
            // After expanding, show options bar
            optionsBar.classList.remove('chatplus-hidden');
            gearBtn.classList.add('chatplus-action-btn--cm-active');
            return;
        }

        // Folder is already expanded → toggle options bar
        const isHidden = optionsBar.classList.toggle('chatplus-hidden');
        gearBtn.classList.toggle('chatplus-action-btn--cm-active', !isHidden);

        // If closing options bar, exit any active mode
        if (isHidden) {
            this._exitAllModes(folderEl);
        }
    }

    /**
     * Populate a folder's content area when expanded for the first time.
     * Wires the options bar buttons, then renders sub-folders + assigned chats
     * into .chatplus-folder-contents.
     *
     * @param {string}      folderId  - ID of the expanded folder
     * @param {HTMLElement} folderEl  - The .chatplus-folder-item element
     * @param {number}      level     - Nesting depth for sub-folder rows
     * @private
     */
    _onExpand(folderId, folderEl, level) {
        // ── Wire options bar buttons ──
        this._wireOptionsBar(folderId, folderEl);

        // ── Populate contents ──
        this._renderFolderContents(folderId, folderEl, level);
    }

    /**
     * Render sub-folders and assigned chats into .chatplus-folder-contents.
     *
     * @param {string}      folderId - Folder ID
     * @param {HTMLElement} folderEl - The .chatplus-folder-item element
     * @param {number}      [level]  - Nesting depth for sub-folders (auto-detected if omitted)
     * @private
     */
    _renderFolderContents(folderId, folderEl, level) {
        const contents = folderEl.querySelector('.chatplus-folder-contents');
        const subfoldersContainer = folderEl.querySelector('.chatplus-folder-subfolders');
        if (!contents) return;

        // Auto-detect nesting level from CSS variable if not provided
        if (level === undefined) {
            level = parseInt(folderEl.style.getPropertyValue('--chatplus-depth') || '0', 10) + 1;
        }

        contents.innerHTML = '';

        // ── Sub-folders (always-visible container at the bottom) ──
        const allFolders = this.folderSystemManager.getAllFolders();
        const subFolders = allFolders
            .filter(f => f.parent === folderId)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (subfoldersContainer) {
            subfoldersContainer.innerHTML = '';
            if (subFolders.length > 0) {
                this._renderFolderTree(subFolders, subfoldersContainer, level);
            }
        }

        // ── Assigned chats ──
        const chatKeys = this.folderSystemManager.getFolderChats(folderId, false);

        if (chatKeys.length === 0 && subFolders.length === 0) {
            contents.appendChild(this._buildEmptyFolderMessage(folderEl));
            return;
        }

        if (chatKeys.length === 0) {
            // Has subfolders but no chats — leave contents empty
            return;
        }

        const currentChat = CoreAPI.getCurrentChat();
        const orphanKeys = [];
        // Resolve chat objects up front so we can sort the live ones
        // alphabetically (character_name → file_name) before render.
        // Stale keys keep their original assignment-order placement at
        // the bottom — see 44b. The notice below still aggregates by
        // count regardless of position.
        const liveChats = [];
        for (const chatKey of chatKeys) {
            const chat = this.chatRepository?.getChatByKey(chatKey);
            if (!chat) {
                orphanKeys.push(chatKey);
                continue;
            }
            liveChats.push({ chatKey, chat });
        }

        liveChats.sort((a, b) => {
            const nameCmp = (a.chat.character_name || '')
                .localeCompare(b.chat.character_name || '');
            if (nameCmp !== 0) return nameCmp;
            return (a.chat.file_name || '').localeCompare(b.chat.file_name || '');
        });

        for (const { chatKey, chat } of liveChats) {
            const isPinned = CoreAPI.getPinnedChatsManager()?.isPinned(chatKey) ?? false;
            const isActive = this._isActiveChat(chat, currentChat);

            const item = this.uiRenderer.renderChatItem(chat, {
                isPinned,
                isActive,
                onOpen: (c) => this._openChat(c),
            });
            if (item) contents.appendChild(item);
        }

        // Render orphan placeholders after the sorted live chats so the
        // aggregate notice (below) reads naturally with the trailing rows.
        for (const chatKey of orphanKeys) {
            const staleItem = this.uiRenderer.renderStaleChatItem(chatKey, {
                sources: ['folder'],
                onClick: (key) => {
                    const lf = CoreAPI.getLostAndFound?.();
                    if (lf && typeof lf.resolveStaleKey === 'function') {
                        lf.resolveStaleKey(key);
                    } else {
                        CoreAPI.showToast('Lost & Found is not available', 'error');
                    }
                },
            });
            contents.appendChild(staleItem);
        }

        // Aggregate "review in Lost & Found" notice when any keys were stale.
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
            contents.appendChild(notice);
        }
    }

    /**
     * Build the empty-folder message from template.
     * "Add Chats" link triggers: show options bar + activate add mode.
     *
     * @param {HTMLElement} folderEl - The .chatplus-folder-item element
     * @returns {HTMLElement}
     * @private
     */
    _buildEmptyFolderMessage(folderEl) {
        const tpl = document.getElementById('chatplus-empty-folder-template');
        if (!tpl) {
            console.error('[ChatPlus2] FoldersView: chatplus-empty-folder-template not found');
            return this.uiRenderer.renderEmptyMessage('No chats in this folder.');
        }

        const msg = tpl.content.firstElementChild.cloneNode(true);

        const addLink = msg.querySelector('.chatplus-cm-link');
        if (addLink) {
            addLink.addEventListener('click', (e) => {
                e.preventDefault();
                // Show options bar
                const optionsBar = folderEl.querySelector('.chatplus-folder-options-bar');
                if (optionsBar) optionsBar.classList.remove('chatplus-hidden');
                if (folderEl._gearBtn) folderEl._gearBtn.classList.add('chatplus-action-btn--cm-active');
                // Activate add mode
                const addBtn = optionsBar?.querySelector('[data-option="add"]');
                if (addBtn) addBtn.click();
            });
        }

        return msg;
    }

    // ─────────────────────────────────────────
    // PRIVATE – OPTIONS BAR
    // ─────────────────────────────────────────

    /**
     * Wire the three buttons in .chatplus-folder-options-bar.
     *
     * @param {string}      folderId - Folder ID
     * @param {HTMLElement} folderEl - The .chatplus-folder-item element
     * @private
     */
    _wireOptionsBar(folderId, folderEl) {
        const optionsBar = folderEl.querySelector('.chatplus-folder-options-bar');
        if (!optionsBar || optionsBar._wired) return;
        optionsBar._wired = true;

        const addBtn = optionsBar.querySelector('[data-option="add"]');
        const removeBtn = optionsBar.querySelector('[data-option="remove"]');
        const deleteBtn = optionsBar.querySelector('[data-option="delete-folder"]');

        // ── Add Chats ──
        let addPanelBuilt = false;
        addBtn?.addEventListener('click', () => {
            const isActive = addBtn.classList.contains('active');
            this._exitAllModes(folderEl);

            if (!isActive) {
                addBtn.classList.add('active');
                // Swap: hide contents, show add panel
                const contents = folderEl.querySelector('.chatplus-folder-contents');
                const addPanel = folderEl.querySelector('.chatplus-folder-add-panel');
                if (contents) contents.classList.add('chatplus-hidden');
                if (addPanel) {
                    addPanel.classList.remove('chatplus-hidden');
                    if (!addPanelBuilt) {
                        addPanelBuilt = true;
                        this._buildAddPanel(folderId, folderEl);
                    }
                }
            }
        });

        // ── Remove Chats ──
        removeBtn?.addEventListener('click', () => {
            const isActive = removeBtn.classList.contains('active');
            this._exitAllModes(folderEl);

            if (!isActive) {
                removeBtn.classList.add('active');
                this._enterRemoveMode(folderId, folderEl);
            }
        });

        // ── Delete Folder ──
        deleteBtn?.addEventListener('click', () => {
            const folder = this.folderSystemManager.getAllFolders().find(f => f.id === folderId);
            if (folder) this._onDelete(folder);
        });
    }

    /**
     * Exit all active modes (add / remove) and return to normal contents view.
     *
     * @param {HTMLElement} folderEl - The .chatplus-folder-item element
     * @private
     */
    _exitAllModes(folderEl) {
        // Deactivate all option buttons
        folderEl.querySelectorAll('.chatplus-options-btn').forEach(btn => btn.classList.remove('active'));

        // Ensure normal contents visible, add panel hidden
        const contents = folderEl.querySelector('.chatplus-folder-contents');
        const addPanel = folderEl.querySelector('.chatplus-folder-add-panel');
        const removeFooter = folderEl.querySelector('.chatplus-remove-footer');

        if (contents) contents.classList.remove('chatplus-hidden');
        if (addPanel) addPanel.classList.add('chatplus-hidden');

        // Exit remove mode
        if (removeFooter && !removeFooter.classList.contains('chatplus-hidden')) {
            this._exitRemoveMode(folderEl);
        }
    }

    // ─────────────────────────────────────────
    // PRIVATE – ADD CHATS MODE
    // ─────────────────────────────────────────

    /**
     * Build the "Add Chats" panel with search, paginated list, checkboxes,
     * and "Add Selected" action. Cloned from template, built lazily on first use.
     *
     * @param {string}      folderId - Target folder ID
     * @param {HTMLElement} folderEl - The .chatplus-folder-item element
     * @private
     */
    async _buildAddPanel(folderId, folderEl) {
        const addPanel = folderEl.querySelector('.chatplus-folder-add-panel');
        if (!addPanel) return;

        addPanel.innerHTML = '';

        const tpl = document.getElementById('chatplus-folder-add-template');
        if (!tpl) {
            console.error('[ChatPlus2] FoldersView: chatplus-folder-add-template not found');
            addPanel.appendChild(this.uiRenderer.renderEmptyMessage('Template not found.'));
            return;
        }

        addPanel.appendChild(tpl.content.cloneNode(true));

        const searchInput = addPanel.querySelector('.chatplus-search-input');
        const clearBtn = addPanel.querySelector('.chatplus-search-clear');
        const listContainer = addPanel.querySelector('.chatplus-cm-add-list');
        const selectionInfo = addPanel.querySelector('.chatplus-cm-selection-info');
        const addSelectedBtn = addPanel.querySelector('.chatplus-cm-add-selected-btn');
        const loadMoreBtn = addPanel.querySelector('.chatplus-cm-load-more');

        // ── State ──
        const selectedKeys = new Set();
        let allAvailable = [];
        let filteredChats = [];
        let renderedCount = 0;
        let filterQuery = '';

        const pageSize = CoreAPI.getStateManager()?.get('pageSize') || 100;

        /** Update footer UI */
        const updateFooter = () => {
            selectionInfo.textContent = `${selectedKeys.size} selected`;
            addSelectedBtn.disabled = selectedKeys.size === 0;

            if (filterQuery || renderedCount >= filteredChats.length) {
                loadMoreBtn.style.display = 'none';
            } else {
                const remaining = filteredChats.length - renderedCount;
                loadMoreBtn.textContent = `Load More (${remaining} remaining)`;
                loadMoreBtn.style.display = '';
            }
        };

        /** Render a page of compact chat items */
        const renderPage = () => {
            const start = renderedCount;
            const end = filterQuery
                ? filteredChats.length
                : Math.min(start + pageSize, filteredChats.length);

            const fragment = document.createDocumentFragment();
            for (let i = start; i < end; i++) {
                const chat = filteredChats[i];
                const chatKey = ChatIdentifier.getChatKey(chat);
                const item = this.uiRenderer.renderChatItemCompact(chat, {
                    checked: selectedKeys.has(chatKey),
                    onToggle: (key, checked) => {
                        if (checked) selectedKeys.add(key);
                        else selectedKeys.delete(key);
                        updateFooter();
                    },
                });
                if (item) fragment.appendChild(item);
            }
            listContainer.appendChild(fragment);
            renderedCount = end;
            updateFooter();
        };

        /** Full re-render of the list after filter or data change */
        const renderAll = () => {
            listContainer.innerHTML = '';
            renderedCount = 0;

            if (filteredChats.length === 0) {
                listContainer.appendChild(
                    this.uiRenderer.renderEmptyMessage(
                        filterQuery ? 'No chats match your search.' : 'All chats are already in this folder.'
                    )
                );
                updateFooter();
                return;
            }
            renderPage();
        };

        /** Filter chats by query */
        const applyFilter = (query) => {
            filterQuery = query.toLowerCase().trim();
            if (!filterQuery) {
                filteredChats = [...allAvailable];
            } else {
                filteredChats = allAvailable.filter(chat => {
                    const name = (chat.character_name || '').toLowerCase();
                    const fname = (chat.file_name || '').toLowerCase();
                    const msg = (chat.stats?.lastMessage || '').toLowerCase();
                    return name.includes(filterQuery) || fname.includes(filterQuery) || msg.includes(filterQuery);
                });
            }
            renderAll();
        };

        // ── Load data ──
        listContainer.appendChild(this.uiRenderer.renderLoadingSpinner());

        try {
            const allChats = await this.chatRepository.getAllChatsWithStats();
            const assignedKeys = new Set(this.folderSystemManager.getFolderChats(folderId, false));

            allAvailable = allChats.filter(chat => {
                const key = ChatIdentifier.getChatKey(chat);
                return !assignedKeys.has(key);
            });
            filteredChats = [...allAvailable];

            listContainer.innerHTML = '';
            renderAll();
        } catch (error) {
            console.error('[ChatPlus2] FoldersView: error loading chats for Add panel', error);
            listContainer.innerHTML = '';
            listContainer.appendChild(this.uiRenderer.renderEmptyMessage('Failed to load chats.'));
        }

        // ── Wire search ──
        let searchTimeout = null;
        searchInput.addEventListener('input', () => {
            clearBtn.style.display = searchInput.value ? '' : 'none';
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => applyFilter(searchInput.value), 300);
        });
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.style.display = 'none';
            applyFilter('');
            searchInput.focus();
        });

        // ── Wire Load More ──
        loadMoreBtn.addEventListener('click', () => renderPage());

        // ── Wire Add Selected ──
        addSelectedBtn.addEventListener('click', () => {
            if (selectedKeys.size === 0) return;

            for (const chatKey of selectedKeys) {
                this.folderSystemManager.assignChatToFolder(chatKey, folderId);
            }

            CoreAPI.showToast(`Added ${selectedKeys.size} chat${selectedKeys.size !== 1 ? 's' : ''} to folder`, 'success');

            // Remove newly assigned from available list
            allAvailable = allAvailable.filter(chat => !selectedKeys.has(ChatIdentifier.getChatKey(chat)));
            selectedKeys.clear();
            applyFilter(searchInput.value);

            // Switch back to normal mode and refresh contents
            this._exitAllModes(folderEl);
            this._renderFolderContents(folderId, folderEl);
        });
    }

    // ─────────────────────────────────────────
    // PRIVATE – REMOVE CHATS MODE
    // ─────────────────────────────────────────

    /**
     * Enter remove mode: add checkboxes to each chat item in the folder contents
     * and show the remove footer.
     *
     * @param {string}      folderId - Folder ID
     * @param {HTMLElement} folderEl - The .chatplus-folder-item element
     * @private
     */
    _enterRemoveMode(folderId, folderEl) {
        const contents = folderEl.querySelector('.chatplus-folder-contents');
        const removeFooter = folderEl.querySelector('.chatplus-remove-footer');
        if (!contents || !removeFooter) return;

        const selectedKeys = new Set();

        // Store state on the element for _exitRemoveMode
        folderEl._removeState = { selectedKeys };

        const countEl = removeFooter.querySelector('.chatplus-remove-count');
        const removeBtn = removeFooter.querySelector('.chatplus-remove-selected-btn');

        const updateFooter = () => {
            countEl.textContent = `${selectedKeys.size} selected`;
            removeBtn.disabled = selectedKeys.size === 0;
        };

        // Add checkboxes to each chat item (not sub-folder items)
        contents.querySelectorAll('.chatplus-chat-item').forEach(item => {
            const chatKey = item.dataset.chatKey;
            if (!chatKey) return;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'chatplus-edit-checkbox';
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                if (checkbox.checked) selectedKeys.add(chatKey);
                else selectedKeys.delete(chatKey);
                updateFooter();
            });
            // Click on the item row toggles checkbox (unless clicking the checkbox itself)
            const rowHandler = (e) => {
                if (e.target.closest('.chatplus-edit-checkbox')) return;
                if (e.target.closest('.chatplus-chat-actions')) return;
                checkbox.checked = !checkbox.checked;
                if (checkbox.checked) selectedKeys.add(chatKey);
                else selectedKeys.delete(chatKey);
                updateFooter();
            };
            item._removeRowHandler = rowHandler;
            item.addEventListener('click', rowHandler);
            item.prepend(checkbox);
            item.classList.add('chatplus-chat-item--edit-mode');
        });

        // Show footer
        removeFooter.classList.remove('chatplus-hidden');
        updateFooter();

        // Wire remove button
        const handler = () => {
            if (selectedKeys.size === 0) return;

            for (const chatKey of selectedKeys) {
                this.folderSystemManager.removeChatFromFolder(chatKey, folderId);
            }

            CoreAPI.showToast(`Removed ${selectedKeys.size} chat${selectedKeys.size !== 1 ? 's' : ''} from folder`, 'success');

            this._exitAllModes(folderEl);
            this._renderFolderContents(folderId, folderEl);
        };
        removeBtn._removeHandler = handler;
        removeBtn.addEventListener('click', handler);
    }

    /**
     * Exit remove mode: remove checkboxes, hide footer, clean up handlers.
     *
     * @param {HTMLElement} folderEl - The .chatplus-folder-item element
     * @private
     */
    _exitRemoveMode(folderEl) {
        const contents = folderEl.querySelector('.chatplus-folder-contents');
        const removeFooter = folderEl.querySelector('.chatplus-remove-footer');

        // Remove checkboxes and row handlers
        contents?.querySelectorAll('.chatplus-chat-item').forEach(item => {
            const cb = item.querySelector('.chatplus-edit-checkbox');
            if (cb) cb.remove();
            if (item._removeRowHandler) {
                item.removeEventListener('click', item._removeRowHandler);
                delete item._removeRowHandler;
            }
            item.classList.remove('chatplus-chat-item--edit-mode');
        });

        // Hide footer and clean up handler
        if (removeFooter) {
            removeFooter.classList.add('chatplus-hidden');
            const removeBtn = removeFooter.querySelector('.chatplus-remove-selected-btn');
            if (removeBtn?._removeHandler) {
                removeBtn.removeEventListener('click', removeBtn._removeHandler);
                delete removeBtn._removeHandler;
            }
        }

        delete folderEl._removeState;
    }

    // ─────────────────────────────────────────
    // PRIVATE – BUTTON HANDLERS
    // ─────────────────────────────────────────

    /**
     * Wire the "+ New Folder" button exactly once.
     * @private
     */
    _wireNewFolderButton() {
        if (this._newFolderBtnWired) return;

        const btn = document.getElementById('chatplus-new-folder');
        if (!btn) {
            console.warn('[ChatPlus2] FoldersView: #chatplus-new-folder not found');
            return;
        }

        const handler = () => this._onNewFolder();
        btn._chatplusFolderHandler = handler;
        btn.addEventListener('click', handler);
        this._newFolderBtnWired = true;
    }

    /**
     * Handle "+ New Folder" click: prompt for name, then create.
     * @private
     */
    async _onNewFolder() {
        const name = await CoreAPI.showInput('Enter a name for the new folder:', '', 'New Folder');
        if (!name || !name.trim()) return;

        const folder = this.folderSystemManager.createFolder(name.trim());
        if (folder) {
            CoreAPI.showToast(`Folder "${folder.name}" created`, 'success');
        }
    }

    /**
     * Handle "+ Subfolder" click.
     * @param {string} parentFolderId
     * @private
     */
    async _onCreateSubfolder(parentFolderId) {
        const name = await CoreAPI.showInput('Enter a name for the subfolder:', '', 'New Subfolder');
        if (!name || !name.trim()) return;

        const folder = this.folderSystemManager.createFolder(name.trim(), parentFolderId);
        if (folder) {
            CoreAPI.showToast(`Subfolder "${folder.name}" created`, 'success');
        }
    }

    /**
     * Handle rename button click on a folder.
     * @param {Object} folder
     * @private
     */
    async _onRename(folder) {
        const newName = await CoreAPI.showInput(
            `Rename "${folder.name}" to:`,
            folder.name,
            'Rename Folder'
        );

        if (!newName || newName.trim() === folder.name) return;

        this.folderSystemManager.renameFolder(folder.id, newName.trim());
    }

    /**
     * Handle delete folder: confirm dialog then delete.
     * @param {Object} folder
     * @private
     */
    _onDelete(folder) {
        const hasChildren = (folder.children?.length ?? 0) > 0;

        const message = hasChildren
            ? `Delete folder "${folder.name}" and all its sub-folders? This cannot be undone.`
            : `Delete folder "${folder.name}"? Chats will not be deleted.`;

        if (!window.confirm(message)) return;

        this.folderSystemManager.deleteFolder(folder.id, /* recursive */ hasChildren);
    }

    // ─────────────────────────────────────────
    // PRIVATE – HELPERS
    // ─────────────────────────────────────────

    async _openChat(chat) {
        // Tabs-aware routing: if the chat is already open (as a secondary tab
        // or as the live main chat), focus it instead of a heavy switch.
        if (CoreAPI.getStateManager()?.get('tabsEnabled') !== false
            && CoreAPI.getModule('ChatTabsController')?.focusIfOpen?.(chat)) {
            return true;
        }
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
            console.error('[ChatPlus2] FoldersView: error opening chat', error);
            CoreAPI.showToast('Failed to open chat', 'error');
            return false;
        }
    }

    _isActiveChat(chat, currentChat) {
        if (!currentChat) return false;
        if (chat.group_id) {
            return currentChat.isGroup
                && currentChat.groupId === chat.group_id
                && currentChat.chatId === chat.file_name;
        }
        return !currentChat.isGroup && currentChat.chatId === chat.file_name;
    }
}

export default FoldersView;
