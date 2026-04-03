/**
 * PinnedChatsManager - Manage pinned chats
 *
 * Handles pinning/unpinning chats for quick access.
 * Stores pins as avatar-based chat keys (stable across renames).
 * Provides alphabetically sorted pin lists.
 *
 * @module PinnedChatsManager
 */

import * as CoreAPI from './core-api.js';
import * as ChatIdentifier from '../utils/chat-identifier.js';

export class PinnedChatsManager {
    /**
     * @param {Object} stateManager - StateManager instance
     */
    constructor(stateManager) {
        if (!stateManager) {
            throw new Error('[ChatPlus2] PinnedChatsManager requires StateManager instance');
        }

        this.stateManager = stateManager;
    }

    /**
     * Pin a chat for quick access
     *
     * @param {Object} chat - Chat object with avatar and file_name
     * @returns {boolean} True if chat was pinned, false if already pinned
     */
    pin(chat) {
        try {
            const chatKey = ChatIdentifier.getChatKey(chat);
            const pinnedChats = this.stateManager.get('pinnedChats') || [];

            // Check if already pinned
            if (pinnedChats.includes(chatKey)) {
                console.debug(`[ChatPlus2] Chat already pinned: ${chatKey}`);
                return false;
            }

            // Add to pinned list
            pinnedChats.push(chatKey);
            this.stateManager.set('pinnedChats', pinnedChats);

            console.debug(`[ChatPlus2] Chat pinned: ${chatKey}`);

            // Emit event for UI updates
            CoreAPI.emit('chat-pinned', { chatKey, chat });
            CoreAPI.emit('pins-changed');

            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error pinning chat:', error);
            CoreAPI.showToast('Failed to pin chat', 'error');
            return false;
        }
    }

    /**
     * Unpin a chat
     *
     * @param {Object|string} chatOrKey - Chat object or chat key string
     * @returns {boolean} True if chat was unpinned, false if not pinned
     */
    unpin(chatOrKey) {
        try {
            // Accept either chat object or chat key string
            const chatKey = typeof chatOrKey === 'string'
                ? chatOrKey
                : ChatIdentifier.getChatKey(chatOrKey);

            const pinnedChats = this.stateManager.get('pinnedChats') || [];
            const index = pinnedChats.indexOf(chatKey);

            if (index === -1) {
                console.debug(`[ChatPlus2] Chat not pinned: ${chatKey}`);
                return false;
            }

            // Remove from pinned list
            pinnedChats.splice(index, 1);
            this.stateManager.set('pinnedChats', pinnedChats);

            console.debug(`[ChatPlus2] Chat unpinned: ${chatKey}`);

            // Emit event for UI updates
            CoreAPI.emit('chat-unpinned', { chatKey });
            CoreAPI.emit('pins-changed');

            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error unpinning chat:', error);
            CoreAPI.showToast('Failed to unpin chat', 'error');
            return false;
        }
    }

    /**
     * Toggle pin status of a chat
     *
     * @param {Object} chat - Chat object
     * @returns {boolean} New pin status (true if now pinned, false if now unpinned)
     */
    togglePin(chat) {
        try {
            const chatKey = ChatIdentifier.getChatKey(chat);

            if (this.isPinned(chatKey)) {
                this.unpin(chatKey);
                return false;
            } else {
                this.pin(chat);
                return true;
            }
        } catch (error) {
            console.error('[ChatPlus2] Error toggling pin:', error);
            return false;
        }
    }

    /**
     * Check if a chat is pinned
     *
     * @param {Object|string} chatOrKey - Chat object or chat key string
     * @returns {boolean} True if chat is pinned
     */
    isPinned(chatOrKey) {
        try {
            // Accept either chat object or chat key string
            const chatKey = typeof chatOrKey === 'string'
                ? chatOrKey
                : ChatIdentifier.getChatKey(chatOrKey);

            const pinnedChats = this.stateManager.get('pinnedChats') || [];
            return pinnedChats.includes(chatKey);
        } catch (error) {
            console.error('[ChatPlus2] Error checking pin status:', error);
            return false;
        }
    }

    /**
     * Get all pinned chat keys
     *
     * @returns {Array<string>} Array of pinned chat keys
     */
    getPinnedKeys() {
        return this.stateManager.get('pinnedChats') || [];
    }

    /**
     * Get all pinned chats with full chat objects
     * Retrieves actual chat data from ChatRepository
     * Returns sorted alphabetically by character name, then filename
     *
     * @returns {Promise<Array>} Array of pinned chat objects with stats
     */
    async getAllPinned() {
        try {
            const pinnedKeys = this.getPinnedKeys();

            if (pinnedKeys.length === 0) {
                return [];
            }

            const chatRepository = CoreAPI.getChatRepository();
            if (!chatRepository) {
                console.warn('[ChatPlus2] ChatRepository not available');
                return [];
            }

            // Fetch chat objects for all pinned keys
            const pinnedChats = [];

            for (const chatKey of pinnedKeys) {
                const chat = chatRepository.getChatByKey(chatKey);

                if (chat) {
                    // Get stats for the chat
                    const stats = await chatRepository.getChatStats(chat);

                    pinnedChats.push({
                        ...chat,
                        stats,
                        chatKey
                    });
                } else {
                    // Chat no longer exists (orphaned pin)
                    console.warn(`[ChatPlus2] Orphaned pin detected: ${chatKey}`);
                }
            }

            // Sort alphabetically by character name, then filename
            pinnedChats.sort((a, b) => {
                const nameCompare = (a.character_name || '').localeCompare(b.character_name || '');
                if (nameCompare !== 0) return nameCompare;

                return (a.file_name || '').localeCompare(b.file_name || '');
            });

            return pinnedChats;
        } catch (error) {
            console.error('[ChatPlus2] Error getting pinned chats:', error);
            return [];
        }
    }

    /**
     * Get count of pinned chats
     *
     * @returns {number} Number of pinned chats
     */
    getPinnedCount() {
        return this.getPinnedKeys().length;
    }

    /**
     * Remove orphaned pins (chats that no longer exist)
     * Returns list of removed orphaned keys
     *
     * @returns {Promise<Array<string>>} Array of removed orphaned chat keys
     */
    async cleanOrphanedPins() {
        try {
            const pinnedKeys = this.getPinnedKeys();
            const chatRepository = CoreAPI.getChatRepository();

            if (!chatRepository) {
                console.warn('[ChatPlus2] ChatRepository not available for cleanup');
                return [];
            }

            const orphanedKeys = [];

            // Check each pinned chat
            for (const chatKey of pinnedKeys) {
                const chat = chatRepository.getChatByKey(chatKey);

                if (!chat) {
                    orphanedKeys.push(chatKey);
                }
            }

            if (orphanedKeys.length > 0) {
                console.debug(`[ChatPlus2] Removing ${orphanedKeys.length} orphaned pins`);

                // Remove all orphaned keys
                const cleanedPins = pinnedKeys.filter(key => !orphanedKeys.includes(key));
                this.stateManager.set('pinnedChats', cleanedPins);

                // Emit event
                CoreAPI.emit('pins-cleaned', { removedKeys: orphanedKeys });
                CoreAPI.emit('pins-changed');
            }

            return orphanedKeys;
        } catch (error) {
            console.error('[ChatPlus2] Error cleaning orphaned pins:', error);
            return [];
        }
    }

    /**
     * Update a pinned chat key (for migration or reconciliation)
     * Replaces an old key with a new key while preserving pin order
     *
     * @param {string} oldKey - Old chat key
     * @param {string} newKey - New chat key
     * @returns {boolean} True if update was successful
     */
    updatePinnedKey(oldKey, newKey) {
        try {
            const pinnedChats = this.stateManager.get('pinnedChats') || [];
            const index = pinnedChats.indexOf(oldKey);

            if (index === -1) {
                console.debug(`[ChatPlus2] Old key not found in pins: ${oldKey}`);
                return false;
            }

            // Check if new key already exists
            if (pinnedChats.includes(newKey)) {
                console.debug(`[ChatPlus2] New key already pinned: ${newKey}`);
                // Remove the old key to avoid duplicate
                pinnedChats.splice(index, 1);
            } else {
                // Replace old key with new key at same position
                pinnedChats[index] = newKey;
            }

            this.stateManager.set('pinnedChats', pinnedChats);

            console.debug(`[ChatPlus2] Updated pin key: ${oldKey} -> ${newKey}`);

            // Emit event
            CoreAPI.emit('pin-key-updated', { oldKey, newKey });
            CoreAPI.emit('pins-changed');

            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error updating pin key:', error);
            return false;
        }
    }

    /**
     * Clear all pins
     *
     * @returns {number} Number of pins that were cleared
     */
    clearAllPins() {
        const count = this.getPinnedCount();

        if (count > 0) {
            this.stateManager.set('pinnedChats', []);

            console.debug(`[ChatPlus2] Cleared ${count} pins`);

            // Emit event
            CoreAPI.emit('pins-cleared', { count });
            CoreAPI.emit('pins-changed');
        }

        return count;
    }

    /**
     * Import pins from an array of chat keys
     * Merges with existing pins (no duplicates)
     *
     * @param {Array<string>} chatKeys - Array of chat keys to pin
     * @returns {number} Number of new pins added
     */
    importPins(chatKeys) {
        if (!Array.isArray(chatKeys)) {
            console.error('[ChatPlus2] importPins requires an array');
            return 0;
        }

        try {
            const existingPins = this.stateManager.get('pinnedChats') || [];
            const uniqueKeys = [...new Set([...existingPins, ...chatKeys])];
            const addedCount = uniqueKeys.length - existingPins.length;

            if (addedCount > 0) {
                this.stateManager.set('pinnedChats', uniqueKeys);

                console.debug(`[ChatPlus2] Imported ${addedCount} new pins`);

                // Emit event
                CoreAPI.emit('pins-imported', { count: addedCount });
                CoreAPI.emit('pins-changed');
            }

            return addedCount;
        } catch (error) {
            console.error('[ChatPlus2] Error importing pins:', error);
            return 0;
        }
    }

    /**
     * Export pins as an array of chat keys
     *
     * @returns {Array<string>} Array of pinned chat keys
     */
    exportPins() {
        return [...this.getPinnedKeys()];
    }

    /**
     * Reorder pins by moving a pin to a new position
     *
     * @param {string} chatKey - Chat key to move
     * @param {number} newIndex - New position index
     * @returns {boolean} True if reordering was successful
     */
    reorderPin(chatKey, newIndex) {
        try {
            const pinnedChats = this.stateManager.get('pinnedChats') || [];
            const currentIndex = pinnedChats.indexOf(chatKey);

            if (currentIndex === -1) {
                console.warn(`[ChatPlus2] Chat not pinned: ${chatKey}`);
                return false;
            }

            if (newIndex < 0 || newIndex >= pinnedChats.length) {
                console.warn(`[ChatPlus2] Invalid reorder index: ${newIndex}`);
                return false;
            }

            // Remove from current position
            pinnedChats.splice(currentIndex, 1);

            // Insert at new position
            pinnedChats.splice(newIndex, 0, chatKey);

            this.stateManager.set('pinnedChats', pinnedChats);

            console.debug(`[ChatPlus2] Pin reordered: ${chatKey} (${currentIndex} -> ${newIndex})`);

            // Emit event
            CoreAPI.emit('pin-reordered', { chatKey, oldIndex: currentIndex, newIndex });
            CoreAPI.emit('pins-changed');

            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error reordering pin:', error);
            return false;
        }
    }
}

export default PinnedChatsManager;
