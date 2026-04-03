/**
 * Core API - The single interface between modules and SillyTavern internals
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                           MODULE ARCHITECTURE RULE                        ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                           ║
 * ║  🚫 MODULES CANNOT:                                                       ║
 * ║     - Import from index.js or app/chatplus.js directly                    ║
 * ║     - Use SillyTavern.getContext() directly                               ║
 * ║     - Access window.SillyTavern internals directly                        ║
 * ║     - Call saveSettingsDebounced() or other ST functions directly         ║
 * ║                                                                           ║
 * ║  ✅ MODULES CAN ONLY:                                                     ║
 * ║     - Import from core-api.js (this file)                                 ║
 * ║     - Import from utils/ (ChatIdentifier, etc.)                           ║
 * ║     - Import other modules via CoreAPI.getModule()                        ║
 * ║     - Use standard browser APIs (fetch, document.*, etc.)                 ║
 * ║                                                                           ║
 * ║  WHY: This abstraction layer allows SillyTavern to be upgraded            ║
 * ║  without breaking modules. CoreAPI is the contract - if ST internals      ║
 * ║  change, update CoreAPI once, not every module.                           ║
 * ║                                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * @module CoreAPI
 * @version 1.0.0
 */

import { getGroupPastChats, getGroupAvatar } from '../../../../group-chats.js';

// ========================================
// MODULE REGISTRY
// ========================================

const modules = new Map();

/**
 * Register a module instance
 * Internal use only - called by main coordinator
 * @param {string} name - Module name
 * @param {Object} instance - Module instance
 */
export function registerModule(name, instance) {
    modules.set(name, instance);
    console.debug(`[ChatPlus2] Module registered: ${name}`);
}

/**
 * Get a registered module instance
 * @param {string} name - Module name
 * @returns {Object|null} Module instance or null
 */
export function getModule(name) {
    return modules.get(name) || null;
}

/**
 * Check if a module is registered
 * @param {string} name - Module name
 * @returns {boolean}
 */
export function hasModule(name) {
    return modules.has(name);
}

/**
 * Get the StateManager instance
 * @returns {Object|null} StateManager instance or null
 */
export function getStateManager() {
    return getModule('StateManager');
}

/**
 * Get the ChatRepository instance
 * @returns {Object|null} ChatRepository instance or null
 */
export function getChatRepository() {
    return getModule('ChatRepository');
}

/**
 * Get the PinnedChatsManager instance
 * @returns {Object|null} PinnedChatsManager instance or null
 */
export function getPinnedChatsManager() {
    return getModule('PinnedChatsManager');
}

/**
 * Get the FolderSystemManager instance
 * @returns {Object|null} FolderSystemManager instance or null
 */
export function getFolderSystemManager() {
    return getModule('FolderSystemManager');
}

/**
 * Get the TabController instance
 * @returns {Object|null} TabController instance or null
 */
export function getTabController() {
    return getModule('TabController');
}

// ========================================
// SILLYTAVERN CONTEXT ACCESS
// ========================================

/**
 * Get SillyTavern context
 * @returns {Object|null} SillyTavern context or null
 */
export function getContext() {
    return window.SillyTavern?.getContext?.() || null;
}

/**
 * Get extension settings object
 * @returns {Object|null} Extension settings or null
 */
export function getExtensionSettings() {
    return getContext()?.extensionSettings || null;
}

/**
 * Save extension settings
 * Calls SillyTavern's debounced save function
 * @returns {Promise<void>}
 */
export async function saveSettings() {
    const fn = getContext()?.saveSettingsDebounced;
    if (typeof fn === 'function') {
        await fn();
    } else {
        console.warn('[ChatPlus2] saveSettingsDebounced not available');
    }
}

/**
 * Get all characters from SillyTavern
 * @returns {Array} Array of character objects
 */
export function getAllCharacters() {
    const context = getContext();
    return context?.characters || [];
}

/**
 * Get all groups from SillyTavern
 * @returns {Array} Array of group objects
 */
export function getAllGroups() {
    const context = getContext();
    return context?.groups || [];
}

/**
 * Get character by avatar filename
 * @param {string} avatar - Avatar filename
 * @returns {Object|null} Character object or null
 */
export function getCharacterByAvatar(avatar) {
    return getAllCharacters().find(c => c.avatar === avatar) || null;
}

/**
 * Get group by ID
 * @param {string} groupId - Group ID
 * @returns {Object|null} Group object or null
 */
export function getGroupById(groupId) {
    return getAllGroups().find(g => g.id === groupId) || null;
}

/**
 * Get currently active chat
 * @returns {Object|null} Current chat info or null
 */
export function getCurrentChat() {
    const context = getContext();
    if (!context) return null;

    return {
        characterId: context.characterId,
        groupId: context.groupId,
        chatId: context.chatId,
        name: context.name1,
        isGroup: context.groupId !== undefined && context.groupId !== null
    };
}

/**
 * Check if currently in a chat
 * @returns {boolean}
 */
export function isInChat() {
    const current = getCurrentChat();
    return current && (current.characterId || current.groupId);
}

// ========================================
// CHAT OPERATIONS
// ========================================

/**
 * Get all chats for a character
 * @param {string} avatar - Character avatar filename
 * @returns {Promise<Array>} Array of chat filenames
 */
export async function getCharacterChats(avatar) {
    try {
        const context = getContext();
        const getRequestHeaders = context?.getRequestHeaders;

        if (!getRequestHeaders) {
            throw new Error('getRequestHeaders not available from SillyTavern context');
        }

        const response = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatar, simple: true })
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch chats: ${response.status}`);
        }

        const data = await response.json();

        // Extract file names from response
        if (!Array.isArray(data)) {
            console.warn('[ChatPlus2] Character chats data is not an array:', data);
            return [];
        }

        return data.map(x => String(x.file_name || x).replace('.jsonl', ''));
    } catch (error) {
        console.error('[ChatPlus2] Error fetching character chats:', error);
        return [];
    }
}

/**
 * Fetch the list of chats for a character along with lightweight stats.
 * Calls the same endpoint WITHOUT `simple: true` so the server returns
 * per-chat metadata (last_mes timestamp, last message text, chat_size).
 * This is the fast path — one request per character covers all their chats.
 *
 * Response shape per item:
 *   { file_name, last_mes, mes, chat_size, ... }
 *
 * @param {string} avatar - Character avatar filename
 * @returns {Promise<Array<{file_name: string, last_mes: string|null, mes: string|null, chat_size: number|null}>>}
 */
export async function getCharacterChatsWithStats(avatar) {
    try {
        const context = getContext();
        const getRequestHeaders = context?.getRequestHeaders;

        if (!getRequestHeaders) {
            throw new Error('getRequestHeaders not available from SillyTavern context');
        }

        const response = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatar })
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch chats with stats: ${response.status}`);
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            console.warn('[ChatPlus2] Character chats (with stats) data is not an array:', data);
            return [];
        }

        return data.map(x => ({
            file_name: String(x.file_name || x).replace('.jsonl', ''),
            last_mes: x.last_mes ?? null,
            mes: x.mes ?? null,
            chat_size: x.chat_size ?? null
        }));
    } catch (error) {
        console.error('[ChatPlus2] Error fetching character chats with stats:', error);
        return [];
    }
}

/**
 * Get all group chats
 * @returns {Promise<Array>} Array of group chat objects
 */
export async function getGroupChats() {
    try {
        const context = getContext();
        const getRequestHeaders = context?.getRequestHeaders;

        if (!getRequestHeaders) {
            throw new Error('getRequestHeaders not available from SillyTavern context');
        }

        const response = await fetch('/api/groups/all', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch group chats: ${response.status}`);
        }

        const groups = await response.json();
        // Extract chat information from groups
        return groups.map(group => ({
            id: group.id,
            name: group.name,
            chats: group.chats || [],
            avatar: group.avatar_url || null
        }));
    } catch (error) {
        console.error('[ChatPlus2] Error fetching group chats:', error);
        return [];
    }
}

/**
 * Get the native group avatar DOM element.
 * Uses SillyTavern's getGroupAvatar which produces a member-collage (up to 4 thumbnails)
 * for groups without a custom avatar, or a single <img> for those with one.
 *
 * @param {Object} group - Group object from context.groups
 * @returns {HTMLElement|null} DOM element ready to append, or null on failure
 */
export function getGroupAvatarElement(group) {
    try {
        const jqResult = getGroupAvatar(group);
        if (!jqResult || !jqResult.length) return null;

        const el = jqResult[0];
        // Override ST's own fixed sizing so the element fills its parent container
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.minWidth = 'unset';
        return el;
    } catch (error) {
        console.error('[ChatPlus2] Error rendering group avatar:', error);
        return null;
    }
}

/**
 * Fetch the list of chats for a group along with lightweight stats.
 * Uses SillyTavern's getGroupPastChats which loads each chat to extract
 * the last message, its date, and the message count.
 *
 * Response shape per item:
 *   { file_name: string, last_mes: string|number, mes: string, chat_size: number }
 *
 * @param {string} groupId - Group ID
 * @returns {Promise<Array<{file_name: string, last_mes: string|number|null, mes: string|null, chat_size: number|null}>>}
 */
export async function getGroupChatsWithStats(groupId) {
    try {
        const chats = await getGroupPastChats(groupId);
        if (!Array.isArray(chats)) return [];

        return chats.map(entry => ({
            file_name: String(entry.file_name || '').replace('.jsonl', ''),
            last_mes: entry.last_mes ?? null,
            mes: entry.mes ?? null,
            chat_size: entry.chat_items ?? null
        }));
    } catch (error) {
        console.error(`[ChatPlus2] Error fetching group chats with stats for ${groupId}:`, error);
        return [];
    }
}

/**
 * Open a specific chat.
 * Selects the owning character first (required when switching characters),
 * then opens the requested chat file.
 * @param {Object}  chat
 * @param {string}  [chat.file_name] - Chat filename without .jsonl (preferred)
 * @param {string}  [chat.chatFile]  - Alias for file_name (legacy callers)
 * @param {string}  [chat.avatar]    - Character avatar filename (used to select the right character)
 * @param {string}  [chat.groupId]   - Group ID (group chats only)
 * @param {boolean} [chat.is_group]  - Whether this is a group chat
 * @returns {Promise<boolean>} Success status
 */
export async function openChat(chat) {
    try {
        const context = getContext();
        if (!context) {
            console.error('[ChatPlus2] SillyTavern context not available');
            return false;
        }

        // Accept both spellings from callers
        const fileName = chat.file_name || chat.chatFile;
        if (!fileName) {
            console.error('[ChatPlus2] openChat: no file_name provided', chat);
            return false;
        }

        // ── Group chat ───────────────────────────────────────────────────────
        if (chat.is_group && chat.groupId) {
            if (typeof context.openGroupChat === 'function') {
                await context.openGroupChat(chat.groupId, fileName);
                console.debug('[ChatPlus2] Opened group chat:', fileName);
                return true;
            }
            console.error('[ChatPlus2] openGroupChat not available');
            return false;
        }

        // ── Character chat ───────────────────────────────────────────────────
        // openCharacterChat() only works for the currently selected character.
        // We must call selectCharacterById() first whenever we're switching characters.
        if (chat.avatar) {
            const characters = context.characters || [];
            const charIndex = characters.findIndex(c => c.avatar === chat.avatar);

            if (charIndex !== -1 && typeof context.selectCharacterById === 'function') {
                await context.selectCharacterById(charIndex);
                // Brief pause to let ST process the character switch
                await new Promise(r => setTimeout(r, 150));
            } else if (charIndex === -1) {
                console.warn('[ChatPlus2] openChat: character not found for avatar', chat.avatar);
            }
        }

        if (typeof context.openCharacterChat === 'function') {
            await context.openCharacterChat(fileName);
            console.debug('[ChatPlus2] Opened character chat:', fileName);
            return true;
        }

        console.error('[ChatPlus2] openCharacterChat not available');
        return false;
    } catch (error) {
        console.error('[ChatPlus2] Error opening chat:', error);
        return false;
    }
}

/**
 * Get metadata for a specific chat file
 * @param {string} avatar - Character avatar
 * @param {string} chatFile - Chat filename
 * @returns {Promise<Object|null>} Chat metadata or null
 */
export async function getChatMetadata(avatar, chatFile) {
    try {
        const context = getContext();
        const getRequestHeaders = context?.getRequestHeaders;

        if (!getRequestHeaders) {
            console.warn('[ChatPlus2] getRequestHeaders not available');
            return null;
        }

        const response = await fetch('/api/chats/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                avatar_url: avatar,
                file_name: chatFile
            })
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error('[ChatPlus2] Error fetching chat metadata:', error);
        return null;
    }
}

/**
 * Rename a chat file
 * @param {string} avatar - Character avatar
 * @param {string} oldFileName - Current filename
 * @param {string} newFileName - New filename
 * @returns {Promise<boolean>} Success status
 */
export async function renameChat(avatar, oldFileName, newFileName) {
    try {
        const context = getContext();
        const getRequestHeaders = context?.getRequestHeaders;

        if (!getRequestHeaders) {
            console.warn('[ChatPlus2] getRequestHeaders not available');
            return false;
        }

        const response = await fetch('/api/chats/rename', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                avatar_url: avatar,
                old_file_name: oldFileName,
                new_file_name: newFileName
            })
        });

        return response.ok;
    } catch (error) {
        console.error('[ChatPlus2] Error renaming chat:', error);
        return false;
    }
}

/**
 * Delete a chat file
 * @param {string} avatar - Character avatar
 * @param {string} chatFile - Chat filename
 * @returns {Promise<boolean>} Success status
 */
export async function deleteChat(avatar, chatFile) {
    try {
        const context = getContext();
        const getRequestHeaders = context?.getRequestHeaders;

        if (!getRequestHeaders) {
            console.warn('[ChatPlus2] getRequestHeaders not available');
            return false;
        }

        const response = await fetch('/api/chats/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                avatar_url: avatar,
                file_name: chatFile
            })
        });

        return response.ok;
    } catch (error) {
        console.error('[ChatPlus2] Error deleting chat:', error);
        return false;
    }
}

// ========================================
// UI OPERATIONS
// ========================================

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - Duration in ms (optional)
 */
export function showToast(message, type = 'info', duration = 3000) {
    if (window.toastr && typeof window.toastr[type] === 'function') {
        window.toastr[type](message, '', { timeOut: duration });
    } else {
        console.log(`[ChatPlus2] ${type.toUpperCase()}: ${message}`);
    }
}

/**
 * Trigger a UI refresh/update
 * Emits event to notify modules that UI should be updated
 */
export function updateUI() {
    emit('ui-update-requested');
}

/**
 * Show confirmation dialog
 * @param {string} message - Confirmation message
 * @param {string} title - Dialog title (optional)
 * @returns {Promise<boolean>} True if confirmed, false if cancelled
 */
export async function showConfirmation(message, title = 'Confirm') {
    // Use SillyTavern's Popup API if available
    if (window.SillyTavern?.Popup?.show) {
        return new Promise((resolve) => {
            window.SillyTavern.Popup.show({
                title: title,
                text: message,
                type: 'confirm',
                okButton: 'Confirm',
                cancelButton: 'Cancel',
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        });
    }

    // Fallback to native confirm
    return confirm(message);
}

/**
 * Show input dialog
 * @param {string} message - Prompt message
 * @param {string} defaultValue - Default input value
 * @param {string} title - Dialog title (optional)
 * @returns {Promise<string|null>} Input value or null if cancelled
 */
export async function showInput(message, defaultValue = '', title = 'Input') {
    // Use SillyTavern's Popup API if available
    if (window.SillyTavern?.Popup?.show) {
        return new Promise((resolve) => {
            window.SillyTavern.Popup.show({
                title: title,
                text: message,
                type: 'input',
                defaultValue: defaultValue,
                okButton: 'OK',
                cancelButton: 'Cancel',
                onConfirm: (value) => resolve(value),
                onCancel: () => resolve(null)
            });
        });
    }

    // Fallback to native prompt
    return prompt(message, defaultValue);
}

// ========================================
// EVENT SYSTEM
// ========================================

const eventListeners = new Map();

/**
 * Subscribe to an event
 * @param {string} event - Event name
 * @param {Function} callback - Event handler
 * @returns {Function} Unsubscribe function
 */
export function on(event, callback) {
    if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set());
    }

    eventListeners.get(event).add(callback);

    // Return unsubscribe function
    return () => off(event, callback);
}

/**
 * Unsubscribe from an event
 * @param {string} event - Event name
 * @param {Function} callback - Event handler to remove
 */
export function off(event, callback) {
    const listeners = eventListeners.get(event);
    if (listeners) {
        listeners.delete(callback);
    }
}

/**
 * Emit an event to all subscribers
 * @param {string} event - Event name
 * @param {*} data - Event data
 */
export function emit(event, data) {
    const listeners = eventListeners.get(event);
    if (!listeners) return;

    listeners.forEach(callback => {
        try {
            callback(data);
        } catch (error) {
            console.error(`[ChatPlus2] Error in event handler for '${event}':`, error);
        }
    });
}

/**
 * Subscribe to a SillyTavern core event
 * @param {string} event - ST event name
 * @param {Function} callback - Event handler
 * @returns {Function} Unsubscribe function
 */
export function onSTEvent(event, callback) {
    const eventSource = getContext()?.eventSource;
    if (!eventSource) {
        console.warn('[ChatPlus2] Event source not available');
        return () => { };
    }

    eventSource.on(event, callback);

    return () => {
        getContext()?.eventSource?.removeListener(event, callback);
    };
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
    if (window.DOMPurify?.sanitize) {
        return window.DOMPurify.sanitize(text);
    }

    // Fallback to manual escaping
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Sanitize a filename for safe use
 * Removes illegal characters for file systems
 * @param {string} name - Filename to sanitize
 * @returns {string} Sanitized filename
 */
export function sanitizeFilename(name) {
    return (name || '').replace(/[\\/:*?"<>|]/g, '').trim();
}

/**
 * Format a date using moment.js (if available)
 * @param {number|string|Date} date - Date to format
 * @param {string} format - Moment format string
 * @returns {string} Formatted date
 */
export function formatDate(date, format = 'YYYY-MM-DD HH:mm') {
    if (window.moment) {
        return window.moment(date).format(format);
    }

    // Fallback to native Date
    return new Date(date).toLocaleString();
}

/**
 * Get relative time string (e.g., "2 hours ago")
 * @param {number|string|Date} date - Date to format
 * @returns {string} Relative time string
 */
export function getRelativeTime(date) {
    if (window.moment) {
        return window.moment(date).fromNow();
    }

    // Fallback to simple implementation
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);

    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };

    for (const [name, secondsInInterval] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInInterval);
        if (interval >= 1) {
            return `${interval} ${name}${interval > 1 ? 's' : ''} ago`;
        }
    }

    return 'just now';
}

/**
 * Debounce a function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Wait for SillyTavern to be fully loaded
 * @returns {Promise<void>}
 */
export function waitForSTReady() {
    return new Promise((resolve) => {
        if (window.SillyTavern?.getContext()) {
            resolve();
            return;
        }

        // Listen for APP_READY event
        const checkReady = () => {
            if (window.SillyTavern?.getContext()) {
                resolve();
            } else {
                setTimeout(checkReady, 100);
            }
        };

        checkReady();
    });
}

// ========================================
// DEFAULT EXPORT - Convenience object
// ========================================

export default {
    // Module system
    registerModule,
    getModule,
    hasModule,
    getStateManager,
    getChatRepository,
    getPinnedChatsManager,
    getFolderSystemManager,
    getTabController,

    // Context
    getContext,
    getAllCharacters,
    getAllGroups,
    getCharacterByAvatar,
    getGroupById,
    getCurrentChat,
    isInChat,

    // Chat operations
    getCharacterChats,
    getCharacterChatsWithStats,
    getGroupChats,
    openChat,
    getChatMetadata,
    renameChat,
    deleteChat,

    // UI
    showToast,
    updateUI,
    showConfirmation,
    showInput,

    // Events
    on,
    off,
    emit,
    onSTEvent,

    // Utilities
    escapeHtml,
    sanitizeFilename,
    formatDate,
    getRelativeTime,
    debounce,
    waitForSTReady
};
