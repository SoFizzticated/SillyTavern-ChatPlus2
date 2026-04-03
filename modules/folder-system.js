/**
 * FolderSystemManager - Manage folder organization for chats
 * 
 * Handles nested folder structure with parent-child relationships.
 * Supports many-to-many mapping (chats can be in multiple folders).
 * Validates folder operations to prevent circular references.
 * 
 * @module FolderSystemManager
 */

import * as CoreAPI from './core-api.js';
import * as ChatIdentifier from '../utils/chat-identifier.js';

export class FolderSystemManager {
    /**
     * @param {Object} stateManager - StateManager instance
     */
    constructor(stateManager) {
        if (!stateManager) {
            throw new Error('[ChatPlus2] FolderSystemManager requires StateManager instance');
        }

        this.stateManager = stateManager;
    }

    /**
     * Generate a unique folder ID
     * @private
     * @returns {string} Unique folder ID
     */
    _generateFolderId() {
        return `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get all folders from state
     * @private
     * @returns {Array} Array of folder objects
     */
    _getFolders() {
        return this.stateManager.get('folders') || [];
    }

    /**
     * Get chat-folder mappings from state
     * @private
     * @returns {Object} Map of chatKey -> array of folderIds
     */
    _getChatFolders() {
        return this.stateManager.get('chatFolders') || {};
    }

    /**
     * Save folders to state
     * @private
     * @param {Array} folders - Folders array
     */
    _saveFolders(folders) {
        this.stateManager.set('folders', folders);
    }

    /**
     * Save chat-folder mappings to state
     * @private
     * @param {Object} chatFolders - Chat-folder mappings
     */
    _saveChatFolders(chatFolders) {
        this.stateManager.set('chatFolders', chatFolders);
    }

    /**
     * Create a new folder
     * 
     * @param {string} name - Folder name
     * @param {string|null} parentId - Parent folder ID (null for root level)
     * @returns {Object|null} Created folder object or null if failed
     */
    createFolder(name, parentId = null) {
        try {
            if (!name || typeof name !== 'string' || name.trim() === '') {
                CoreAPI.showToast('Folder name cannot be empty', 'error');
                return null;
            }

            const folders = this._getFolders();

            // Validate parent exists if specified
            if (parentId !== null) {
                const parent = folders.find(f => f.id === parentId);
                if (!parent) {
                    CoreAPI.showToast('Parent folder not found', 'error');
                    return null;
                }
            }

            // Check for duplicate names at the same level
            const siblings = folders.filter(f => f.parent === parentId);
            if (siblings.some(f => f.name === name.trim())) {
                CoreAPI.showToast('A folder with this name already exists at this level', 'error');
                return null;
            }

            const folder = {
                id: this._generateFolderId(),
                name: name.trim(),
                parent: parentId,
                children: [],
                created: Date.now(),
                modified: Date.now()
            };

            folders.push(folder);

            // Update parent's children array
            if (parentId) {
                const parent = folders.find(f => f.id === parentId);
                if (parent) {
                    parent.children.push(folder.id);
                    parent.modified = Date.now();
                }
            }

            this._saveFolders(folders);

            console.debug(`[ChatPlus2] Folder created: ${folder.name} (${folder.id})`);

            // Emit event
            CoreAPI.emit('folder-created', { folder });
            CoreAPI.emit('folders-changed');

            return folder;
        } catch (error) {
            console.error('[ChatPlus2] Error creating folder:', error);
            CoreAPI.showToast('Failed to create folder', 'error');
            return null;
        }
    }

    /**
     * Rename a folder
     * 
     * @param {string} folderId - Folder ID
     * @param {string} newName - New folder name
     * @returns {boolean} True if renamed successfully
     */
    renameFolder(folderId, newName) {
        try {
            if (!newName || typeof newName !== 'string' || newName.trim() === '') {
                CoreAPI.showToast('Folder name cannot be empty', 'error');
                return false;
            }

            const folders = this._getFolders();
            const folder = folders.find(f => f.id === folderId);

            if (!folder) {
                CoreAPI.showToast('Folder not found', 'error');
                return false;
            }

            // Check for duplicate names at the same level
            const siblings = folders.filter(f => f.parent === folder.parent && f.id !== folderId);
            if (siblings.some(f => f.name === newName.trim())) {
                CoreAPI.showToast('A folder with this name already exists at this level', 'error');
                return false;
            }

            const oldName = folder.name;
            folder.name = newName.trim();
            folder.modified = Date.now();

            this._saveFolders(folders);

            console.debug(`[ChatPlus2] Folder renamed: ${oldName} -> ${folder.name}`);

            // Emit event
            CoreAPI.emit('folder-renamed', { folderId, oldName, newName: folder.name });
            CoreAPI.emit('folders-changed');

            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error renaming folder:', error);
            CoreAPI.showToast('Failed to rename folder', 'error');
            return false;
        }
    }

    /**
     * Delete a folder
     * Optionally delete all child folders recursively
     * Removes all chat assignments for deleted folders
     * 
     * @param {string} folderId - Folder ID
     * @param {boolean} recursive - Delete child folders recursively
     * @returns {boolean} True if deleted successfully
     */
    deleteFolder(folderId, recursive = false) {
        try {
            const folders = this._getFolders();
            const folder = folders.find(f => f.id === folderId);

            if (!folder) {
                CoreAPI.showToast('Folder not found', 'error');
                return false;
            }

            // Check if folder has children
            if (folder.children.length > 0 && !recursive) {
                CoreAPI.showToast('Folder has subfolders. Delete them first or use recursive delete.', 'error');
                return false;
            }

            // Collect all folders to delete (including children if recursive)
            const foldersToDelete = [folderId];
            
            if (recursive) {
                const collectChildren = (id) => {
                    const f = folders.find(folder => folder.id === id);
                    if (f && f.children.length > 0) {
                        for (const childId of f.children) {
                            foldersToDelete.push(childId);
                            collectChildren(childId);
                        }
                    }
                };
                collectChildren(folderId);
            }

            // Remove folders
            const remainingFolders = folders.filter(f => !foldersToDelete.includes(f.id));

            // Update parent's children array
            if (folder.parent) {
                const parent = remainingFolders.find(f => f.id === folder.parent);
                if (parent) {
                    parent.children = parent.children.filter(id => id !== folderId);
                    parent.modified = Date.now();
                }
            }

            this._saveFolders(remainingFolders);

            // Remove chat assignments for deleted folders
            const chatFolders = this._getChatFolders();
            let assignmentsRemoved = 0;

            for (const chatKey in chatFolders) {
                const originalLength = chatFolders[chatKey].length;
                chatFolders[chatKey] = chatFolders[chatKey].filter(id => !foldersToDelete.includes(id));
                
                // Remove empty entries
                if (chatFolders[chatKey].length === 0) {
                    delete chatFolders[chatKey];
                }
                
                assignmentsRemoved += originalLength - (chatFolders[chatKey]?.length || 0);
            }

            this._saveChatFolders(chatFolders);

            console.debug(`[ChatPlus2] Deleted ${foldersToDelete.length} folders, removed ${assignmentsRemoved} chat assignments`);

            // Emit event
            CoreAPI.emit('folder-deleted', { folderId, foldersToDelete, assignmentsRemoved });
            CoreAPI.emit('folders-changed');

            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error deleting folder:', error);
            CoreAPI.showToast('Failed to delete folder', 'error');
            return false;
        }
    }

    /**
     * Move a folder to a new parent
     * Validates against circular references
     * 
     * @param {string} folderId - Folder ID to move
     * @param {string|null} newParentId - New parent ID (null for root)
     * @returns {boolean} True if moved successfully
     */
    moveFolder(folderId, newParentId) {
        try {
            const folders = this._getFolders();
            const folder = folders.find(f => f.id === folderId);

            if (!folder) {
                CoreAPI.showToast('Folder not found', 'error');
                return false;
            }

            // Can't move to itself
            if (folderId === newParentId) {
                CoreAPI.showToast('Cannot move folder into itself', 'error');
                return false;
            }

            // Validate new parent exists if specified
            if (newParentId !== null) {
                const newParent = folders.find(f => f.id === newParentId);
                if (!newParent) {
                    CoreAPI.showToast('Target parent folder not found', 'error');
                    return false;
                }

                // Check for circular reference (newParent is descendant of folder)
                if (this._isDescendant(folderId, newParentId, folders)) {
                    CoreAPI.showToast('Cannot move folder into its own descendant', 'error');
                    return false;
                }

                // Check for duplicate names at new level
                const siblings = folders.filter(f => f.parent === newParentId && f.id !== folderId);
                if (siblings.some(f => f.name === folder.name)) {
                    CoreAPI.showToast('A folder with this name already exists at the target level', 'error');
                    return false;
                }
            }

            // Remove from old parent's children
            if (folder.parent) {
                const oldParent = folders.find(f => f.id === folder.parent);
                if (oldParent) {
                    oldParent.children = oldParent.children.filter(id => id !== folderId);
                    oldParent.modified = Date.now();
                }
            }

            // Update folder's parent
            const oldParent = folder.parent;
            folder.parent = newParentId;
            folder.modified = Date.now();

            // Add to new parent's children
            if (newParentId) {
                const newParent = folders.find(f => f.id === newParentId);
                if (newParent) {
                    newParent.children.push(folderId);
                    newParent.modified = Date.now();
                }
            }

            this._saveFolders(folders);

            console.debug(`[ChatPlus2] Folder moved: ${folder.name} (${oldParent || 'root'} -> ${newParentId || 'root'})`);

            // Emit event
            CoreAPI.emit('folder-moved', { folderId, oldParent, newParent: newParentId });
            CoreAPI.emit('folders-changed');

            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error moving folder:', error);
            CoreAPI.showToast('Failed to move folder', 'error');
            return false;
        }
    }

    /**
     * Check if a folder is a descendant of another folder
     * @private
     * @param {string} ancestorId - Potential ancestor folder ID
     * @param {string} descendantId - Potential descendant folder ID
     * @param {Array} folders - Folders array
     * @returns {boolean} True if descendantId is a descendant of ancestorId
     */
    _isDescendant(ancestorId, descendantId, folders) {
        const descendant = folders.find(f => f.id === descendantId);
        if (!descendant) return false;

        let current = descendant;
        while (current.parent) {
            if (current.parent === ancestorId) {
                return true;
            }
            current = folders.find(f => f.id === current.parent);
            if (!current) break;
        }

        return false;
    }

    /**
     * Assign a chat to a folder
     * 
     * @param {string} chatKey - Chat key
     * @param {string} folderId - Folder ID
     * @returns {boolean} True if assigned successfully
     */
    assignChatToFolder(chatKey, folderId) {
        try {
            const folders = this._getFolders();
            const folder = folders.find(f => f.id === folderId);

            if (!folder) {
                CoreAPI.showToast('Folder not found', 'error');
                return false;
            }

            const chatFolders = this._getChatFolders();

            // Initialize array if doesn't exist
            if (!chatFolders[chatKey]) {
                chatFolders[chatKey] = [];
            }

            // Check if already assigned
            if (chatFolders[chatKey].includes(folderId)) {
                console.debug(`[ChatPlus2] Chat already in folder: ${chatKey} -> ${folderId}`);
                return true;
            }

            chatFolders[chatKey].push(folderId);
            this._saveChatFolders(chatFolders);

            console.debug(`[ChatPlus2] Chat assigned to folder: ${chatKey} -> ${folder.name}`);

            // Emit event
            CoreAPI.emit('chat-assigned-to-folder', { chatKey, folderId, folderName: folder.name });
            CoreAPI.emit('chat-folders-changed', { chatKey });

            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error assigning chat to folder:', error);
            CoreAPI.showToast('Failed to assign chat to folder', 'error');
            return false;
        }
    }

    /**
     * Remove a chat from a folder
     * 
     * @param {string} chatKey - Chat key
     * @param {string} folderId - Folder ID
     * @returns {boolean} True if removed successfully
     */
    removeChatFromFolder(chatKey, folderId) {
        try {
            const chatFolders = this._getChatFolders();

            if (!chatFolders[chatKey] || !chatFolders[chatKey].includes(folderId)) {
                console.debug(`[ChatPlus2] Chat not in folder: ${chatKey} -> ${folderId}`);
                return false;
            }

            chatFolders[chatKey] = chatFolders[chatKey].filter(id => id !== folderId);

            // Remove empty entries
            if (chatFolders[chatKey].length === 0) {
                delete chatFolders[chatKey];
            }

            this._saveChatFolders(chatFolders);

            console.debug(`[ChatPlus2] Chat removed from folder: ${chatKey} -> ${folderId}`);

            // Emit event
            CoreAPI.emit('chat-removed-from-folder', { chatKey, folderId });
            CoreAPI.emit('chat-folders-changed', { chatKey });

            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error removing chat from folder:', error);
            CoreAPI.showToast('Failed to remove chat from folder', 'error');
            return false;
        }
    }

    /**
     * Get all folders a chat is assigned to
     * 
     * @param {string} chatKey - Chat key
     * @returns {Array} Array of folder objects
     */
    getChatFolders(chatKey) {
        const chatFolders = this._getChatFolders();
        const folderIds = chatFolders[chatKey] || [];
        const folders = this._getFolders();

        return folderIds
            .map(id => folders.find(f => f.id === id))
            .filter(f => f != null);
    }

    /**
     * Get all chats in a folder
     * 
     * @param {string} folderId - Folder ID
     * @param {boolean} includeSubfolders - Include chats from subfolders
     * @returns {Array<string>} Array of chat keys
     */
    getFolderChats(folderId, includeSubfolders = false) {
        const chatFolders = this._getChatFolders();
        const chatKeys = [];

        // Collect folder IDs to check
        const folderIds = [folderId];
        
        if (includeSubfolders) {
            const folders = this._getFolders();
            const collectChildren = (id) => {
                const folder = folders.find(f => f.id === id);
                if (folder && folder.children.length > 0) {
                    for (const childId of folder.children) {
                        folderIds.push(childId);
                        collectChildren(childId);
                    }
                }
            };
            collectChildren(folderId);
        }

        // Find chats in these folders
        for (const chatKey in chatFolders) {
            if (chatFolders[chatKey].some(id => folderIds.includes(id))) {
                chatKeys.push(chatKey);
            }
        }

        return chatKeys;
    }

    /**
     * Get folder by ID
     * 
     * @param {string} folderId - Folder ID
     * @returns {Object|null} Folder object or null
     */
    getFolder(folderId) {
        const folders = this._getFolders();
        return folders.find(f => f.id === folderId) || null;
    }

    /**
     * Get all folders
     * 
     * @returns {Array} Array of all folder objects
     */
    getAllFolders() {
        return [...this._getFolders()];
    }

    /**
     * Get folder hierarchy as a tree structure
     * Returns root-level folders with nested children
     * 
     * @returns {Array} Array of root folder objects with nested children
     */
    getFolderHierarchy() {
        const folders = this._getFolders();
        const chatFolders = this._getChatFolders();

        // Build a map for quick lookup
        const folderMap = new Map();
        folders.forEach(f => {
            folderMap.set(f.id, {
                ...f,
                children: [],
                chatCount: 0 // Will be calculated
            });
        });

        // Calculate chat counts
        for (const chatKey in chatFolders) {
            for (const folderId of chatFolders[chatKey]) {
                const folder = folderMap.get(folderId);
                if (folder) {
                    folder.chatCount++;
                }
            }
        }

        // Build tree structure
        const roots = [];

        for (const folder of folderMap.values()) {
            if (folder.parent === null || folder.parent === undefined) {
                // Root level folder
                roots.push(folder);
            } else {
                // Child folder - add to parent's children
                const parent = folderMap.get(folder.parent);
                if (parent) {
                    parent.children.push(folder);
                } else {
                    // Parent doesn't exist, treat as root
                    console.warn(`[ChatPlus2] Orphaned folder: ${folder.name} (parent ${folder.parent} not found)`);
                    roots.push(folder);
                }
            }
        }

        // Sort folders alphabetically at each level
        const sortFolders = (folderArray) => {
            folderArray.sort((a, b) => a.name.localeCompare(b.name));
            folderArray.forEach(f => {
                if (f.children.length > 0) {
                    sortFolders(f.children);
                }
            });
        };

        sortFolders(roots);

        return roots;
    }

    /**
     * Get folder path (breadcrumb) from root to folder
     * 
     * @param {string} folderId - Folder ID
     * @returns {Array} Array of folder objects from root to target
     */
    getFolderPath(folderId) {
        const folders = this._getFolders();
        const path = [];
        
        let current = folders.find(f => f.id === folderId);
        
        while (current) {
            path.unshift(current);
            
            if (current.parent) {
                current = folders.find(f => f.id === current.parent);
            } else {
                break;
            }
        }

        return path;
    }

    /**
     * Search folders by name
     * 
     * @param {string} query - Search query
     * @param {boolean} caseSensitive - Case sensitive search
     * @returns {Array} Array of matching folders
     */
    searchFolders(query, caseSensitive = false) {
        if (!query || typeof query !== 'string') {
            return [];
        }

        const folders = this._getFolders();
        const searchTerm = caseSensitive ? query : query.toLowerCase();

        return folders.filter(folder => {
            const folderName = caseSensitive ? folder.name : folder.name.toLowerCase();
            return folderName.includes(searchTerm);
        });
    }

    /**
     * Get total folder count
     * 
     * @returns {number} Total number of folders
     */
    getFolderCount() {
        return this._getFolders().length;
    }

    /**
     * Clean orphaned chat-folder assignments
     * Removes assignments where folder no longer exists
     * 
     * @returns {number} Number of orphaned assignments removed
     */
    cleanOrphanedAssignments() {
        const folders = this._getFolders();
        const folderIds = new Set(folders.map(f => f.id));
        const chatFolders = this._getChatFolders();
        
        let removedCount = 0;

        for (const chatKey in chatFolders) {
            const originalLength = chatFolders[chatKey].length;
            chatFolders[chatKey] = chatFolders[chatKey].filter(id => folderIds.has(id));
            
            removedCount += originalLength - chatFolders[chatKey].length;
            
            // Remove empty entries
            if (chatFolders[chatKey].length === 0) {
                delete chatFolders[chatKey];
            }
        }

        if (removedCount > 0) {
            this._saveChatFolders(chatFolders);
            console.debug(`[ChatPlus2] Cleaned ${removedCount} orphaned folder assignments`);
        }

        return removedCount;
    }
}

export default FolderSystemManager;
