/**
 * ChatPlus 2 - Chat Identifier Utility
 *
 * Provides stable chat identification using avatar-based keys.
 * This replaces v1's fragile characterId-based approach with a system
 * that survives character renames, duplicates, and reloads.
 *
 * Key Format: "avatar.png:chatname"
 * - avatar: Character/group avatar filename (stable across renames)
 * - chatname: Chat filename without .jsonl extension
 */

const MODULE_NAME = 'ChatPlus2';

/**
 * Generate a stable chat key from chat object
 * Uses avatar + filename (both stable across character renames)
 *
 * @param {Object} chat - Chat object with avatar and file_name properties
 * @param {string} chat.avatar - Avatar filename (e.g., "Seraphina.png")
 * @param {string} chat.file_name - Chat filename (with or without .jsonl)
 * @returns {string} Stable chat key like "Seraphina.png:casual_chat"
 * @throws {Error} If chat object is invalid
 *
 * @example
 * const key = getChatKey({ avatar: "Seraphina.png", file_name: "casual_chat.jsonl" });
 * // Returns: "Seraphina.png:casual_chat"
 */
export function getChatKey(chat) {
    if (!chat || typeof chat !== 'object') {
        throw new Error('[ChatPlus2] Chat object is required');
    }

    const avatar = chat.avatar || '';
    const fileName = (chat.file_name || '').replace('.jsonl', '');

    if (!avatar || !fileName) {
        console.warn(`[${MODULE_NAME}] Chat missing required fields:`, {
            avatar: !!avatar,
            file_name: !!fileName,
            chat
        });
        throw new Error('[ChatPlus2] Chat must have both avatar and file_name');
    }

    return `${avatar}:${fileName}`;
}

/**
 * Parse a chat key back into its components
 *
 * @param {string} key - Chat key like "Seraphina.png:casual_chat"
 * @returns {Object} Object with avatar and fileName properties
 * @returns {string} return.avatar - Avatar filename
 * @returns {string} return.fileName - Chat filename (without .jsonl)
 * @throws {Error} If key format is invalid
 *
 * @example
 * const { avatar, fileName } = parseChatKey("Seraphina.png:casual_chat");
 * // avatar: "Seraphina.png"
 * // fileName: "casual_chat"
 */
export function parseChatKey(key) {
    if (typeof key !== 'string' || !key) {
        throw new Error('[ChatPlus2] Chat key must be a non-empty string');
    }

    const colonIndex = key.indexOf(':');
    if (colonIndex === -1) {
        throw new Error(`[ChatPlus2] Invalid chat key format (missing colon): ${key}`);
    }

    const avatar = key.substring(0, colonIndex);
    const fileName = key.substring(colonIndex + 1);

    if (!avatar || !fileName) {
        throw new Error(`[ChatPlus2] Invalid chat key format (empty component): ${key}`);
    }

    return { avatar, fileName };
}

/**
 * Get character or group object by avatar filename
 * Searches both characters and groups arrays
 *
 * @param {string} avatar - Avatar filename (e.g., "Seraphina.png")
 * @returns {Promise<Object|null>} Character/group object with isGroup flag, or null if not found
 * @returns {boolean} return.isGroup - True if entity is a group, false if character
 *
 * @example
 * const entity = await getEntityByAvatar("Seraphina.png");
 * if (entity) {
 *     console.log(entity.isGroup ? "Group" : "Character", entity.name);
 * }
 */
export async function getEntityByAvatar(avatar) {
    if (!avatar || typeof avatar !== 'string') {
        return null;
    }

    const context = SillyTavern.getContext();
    if (!context) {
        console.error(`[${MODULE_NAME}] SillyTavern context not available`);
        return null;
    }

    const { characters, groups } = context;

    // Check characters first (more common)
    if (characters && Array.isArray(characters)) {
        const character = characters.find(c => c.avatar === avatar);
        if (character) {
            return { ...character, isGroup: false };
        }
    }

    // Check groups. The canonical key avatar for groups is `group.id` (stable
    // across avatar changes). Legacy keys may still use `avatar_url` or `avatar`,
    // so check all three forms for backward compatibility with pre-remap data.
    if (groups && Array.isArray(groups)) {
        const group = groups.find(g =>
            String(g.id) === avatar ||
            g.avatar_url === avatar ||
            g.avatar === avatar
        );
        if (group) {
            return { ...group, isGroup: true };
        }
    }

    return null;
}

/**
 * Validate that a chat object has all required fields
 *
 * @param {Object} chat - Chat object to validate
 * @returns {boolean} True if chat has valid avatar and file_name
 *
 * @example
 * if (isValidChat(chat)) {
 *     const key = getChatKey(chat);
 * }
 */
export function isValidChat(chat) {
    return chat &&
        typeof chat === 'object' &&
        'avatar' in chat &&
        'file_name' in chat &&
        typeof chat.avatar === 'string' &&
        typeof chat.file_name === 'string' &&
        chat.avatar.length > 0 &&
        chat.file_name.length > 0;
}

/**
 * Normalize a filename by removing .jsonl extension if present
 *
 * @param {string} fileName - Filename to normalize
 * @returns {string} Filename without .jsonl extension
 *
 * @example
 * normalizeFileName("casual_chat.jsonl") // Returns: "casual_chat"
 * normalizeFileName("casual_chat") // Returns: "casual_chat"
 */
export function normalizeFileName(fileName) {
    if (typeof fileName !== 'string') {
        return '';
    }
    return fileName.replace('.jsonl', '');
}

/**
 * Build a chat object from avatar and filename
 * Useful for reconstructing chat objects from stored keys
 *
 * @param {string} avatar - Avatar filename
 * @param {string} fileName - Chat filename (with or without .jsonl)
 * @returns {Object} Chat object with avatar and file_name
 *
 * @example
 * const chat = buildChatObject("Seraphina.png", "casual_chat");
 * // Returns: { avatar: "Seraphina.png", file_name: "casual_chat" }
 */
export function buildChatObject(avatar, fileName) {
    return {
        avatar,
        file_name: normalizeFileName(fileName)
    };
}

/**
 * Compare two chat keys for equality
 * More efficient than parsing both keys
 *
 * @param {string} key1 - First chat key
 * @param {string} key2 - Second chat key
 * @returns {boolean} True if keys are equal
 *
 * @example
 * if (compareChatKeys(key1, key2)) {
 *     console.log("Same chat");
 * }
 */
export function compareChatKeys(key1, key2) {
    return key1 === key2;
}

/**
 * Check if a chat key matches a specific avatar
 * Useful for filtering chats by character/group
 *
 * @param {string} key - Chat key
 * @param {string} avatar - Avatar filename to match
 * @returns {boolean} True if key's avatar matches
 *
 * @example
 * if (chatKeyMatchesAvatar(key, "Seraphina.png")) {
 *     console.log("This chat belongs to Seraphina");
 * }
 */
export function chatKeyMatchesAvatar(key, avatar) {
    if (!key || !avatar) {
        return false;
    }
    return key.startsWith(avatar + ':');
}

/**
 * Extract avatar from chat key without full parsing
 * More efficient than parseChatKey when only avatar is needed
 *
 * @param {string} key - Chat key
 * @returns {string} Avatar filename, or empty string if invalid
 *
 * @example
 * const avatar = extractAvatarFromKey("Seraphina.png:casual_chat");
 * // Returns: "Seraphina.png"
 */
export function extractAvatarFromKey(key) {
    if (typeof key !== 'string') {
        return '';
    }
    const colonIndex = key.indexOf(':');
    return colonIndex === -1 ? '' : key.substring(0, colonIndex);
}

/**
 * Extract filename from chat key without full parsing
 * More efficient than parseChatKey when only filename is needed
 *
 * @param {string} key - Chat key
 * @returns {string} Chat filename, or empty string if invalid
 *
 * @example
 * const fileName = extractFileNameFromKey("Seraphina.png:casual_chat");
 * // Returns: "casual_chat"
 */
export function extractFileNameFromKey(key) {
    if (typeof key !== 'string') {
        return '';
    }
    const colonIndex = key.indexOf(':');
    return colonIndex === -1 ? '' : key.substring(colonIndex + 1);
}

// Export all functions as default object for convenience
export default {
    getChatKey,
    parseChatKey,
    getEntityByAvatar,
    isValidChat,
    normalizeFileName,
    buildChatObject,
    compareChatKeys,
    chatKeyMatchesAvatar,
    extractAvatarFromKey,
    extractFileNameFromKey
};
