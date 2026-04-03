/**
 * FoldersView - Renders and manages the Folders tab UI
 *
 * Lazy-renders when the 'folders' tab is first activated.
 * Re-renders whenever 'folders-changed' fires (create / rename / delete).
 * Wires the "+ New Folder" button and delegates all state operations to
 * FolderSystemManager; delegates DOM creation to UIRenderer.
 *
 * @module FoldersView
 */

import * as CoreAPI from './core-api.js';
import * as ChatIdentifier from '../utils/chat-identifier.js';
import UIRenderer from './ui-renderer.js';

export class FoldersView {
    /**
     * @param {Object} folderSystemManager - FolderSystemManager instance
     * @param {Object} chatRepository      - ChatRepository instance (for chat items inside folders)
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

        CoreAPI.on('tab-activated', this._tabActivatedHandler);
        CoreAPI.on('folders-changed', this._foldersChangedHandler);
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
     * Recursively renders an array of folder objects into a container element.
     * @param {Array}       folders   - Array of folder objects (already sorted by FolderSystemManager)
     * @param {HTMLElement} container - DOM node to append into
     * @param {number}      level     - Nesting depth (0 = root)
     * @private
     */
    _renderFolderTree(folders, container, level) {
        for (const folder of folders) {
            const el = this.uiRenderer.renderFolder(folder, level, {
                onExpand: (folderId, childrenContainer) =>
                    this._onExpand(folderId, childrenContainer, level + 1),
                onRename: (f) => this._onRename(f),
                onDelete: (f) => this._onDelete(f),
            });
            container.appendChild(el);
        }
    }

    /**
     * Populate a folder's children container when first expanded.
     * Renders direct sub-folders first, then chats assigned to this folder.
     *
     * @param {string}      folderId         - ID of the expanded folder
     * @param {HTMLElement} childrenContainer - .chatplus-folder-children element
     * @param {number}      level             - Level for sub-folder rows
     * @private
     */
    _onExpand(folderId, childrenContainer, level) {
        // Direct sub-folders (FolderHierarchy already gives nested children objects,
        // but on expand we only need the already-resolved children from the flat store)
        const allFolders = this.folderSystemManager.getAllFolders();
        const subFolders = allFolders
            .filter(f => f.parent === folderId)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (subFolders.length > 0) {
            this._renderFolderTree(subFolders, childrenContainer, level);
        }

        // Chats assigned to this folder
        const chatKeys = this.folderSystemManager.getFolderChats(folderId, false);

        if (chatKeys.length === 0 && subFolders.length === 0) {
            childrenContainer.appendChild(
                this.uiRenderer.renderEmptyMessage('No chats in this folder.')
            );
            return;
        }

        const currentChat = CoreAPI.getCurrentChat();

        for (const chatKey of chatKeys) {
            const chat = this.chatRepository?.getChatByKey(chatKey);
            if (!chat) continue; // orphaned key

            const isPinned = CoreAPI.getPinnedChatsManager()?.isPinned(chatKey) ?? false;
            const isActive = this._isActiveChat(chat, currentChat);

            const item = this.uiRenderer.renderChatItem(chat, {
                isPinned,
                isActive,
                onOpen: (c) => this._openChat(c),
            });
            if (item) childrenContainer.appendChild(item);
        }
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
        // 'folders-changed' fires automatically → _foldersChangedHandler re-renders
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
        // 'folders-changed' fires → re-render
    }

    /**
     * Handle delete button click on a folder.
     * Warns if the folder contains sub-folders.
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
        // 'folders-changed' fires → re-render
    }

    // ─────────────────────────────────────────
    // PRIVATE – HELPERS
    // ─────────────────────────────────────────

    _openChat(chat) {
        try {
            CoreAPI.openChat({
                file_name: chat.file_name,
                avatar: chat.avatar,
                groupId: chat.group_id || null,
                is_group: !!chat.group_id,
            });
        } catch (error) {
            console.error('[ChatPlus2] FoldersView: error opening chat', error);
            CoreAPI.showToast('Failed to open chat', 'error');
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
