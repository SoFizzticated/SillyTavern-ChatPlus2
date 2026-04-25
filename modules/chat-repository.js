/**
 * ChatRepository - Central repository for all chat data
 *
 * Manages chat fetching, caching, and indexing for both character and group chats.
 * Uses avatar-based chat keys for stable identification across renames.
 *
 * @module ChatRepository
 */

import * as CoreAPI from './core-api.js';
import * as ChatIdentifier from '../utils/chat-identifier.js';

export class ChatRepository {
    constructor() {
        // Cache: Map<chatKey, chatData>
        this.chatCache = new Map();

        // Additional indexes for faster lookups
        this.chatsByAvatar = new Map(); // Map<avatar, Set<chatKey>>

        // Loading state
        this.isLoading = false;
        this.lastFetchTime = null;

        // Stats cache
        this.statsCache = new Map(); // Map<chatKey, stats>
    }

    /**
     * Fetch all chats from all characters and groups
     * Uses parallel promises for optimal performance
     *
     * @param {boolean} forceRefresh - Force cache refresh
     * @returns {Promise<Array>} Array of all chat objects with metadata
     */
    async fetchAllChats(forceRefresh = false) {
        // Return cached data if available and not forcing refresh
        if (!forceRefresh && this.chatCache.size > 0 && this.lastFetchTime) {
            const cacheAge = Date.now() - this.lastFetchTime;
            if (cacheAge < 30000) { // 30 second cache
                return Array.from(this.chatCache.values());
            }
        }

        if (this.isLoading) {
            console.debug('[ChatPlus2] Chat fetch already in progress');
            return Array.from(this.chatCache.values());
        }

        this.isLoading = true;

        try {
            console.debug('[ChatPlus2] Fetching all chats...');

            // Fetch characters and groups in parallel
            const [characters, groups] = await Promise.all([
                CoreAPI.getAllCharacters(),
                CoreAPI.getAllGroups()
            ]);

            console.debug(`[ChatPlus2] Found ${characters.length} characters, ${groups.length} groups`);

            // Fetch chats for all entities in parallel
            const chatPromises = [];

            // Character chats
            for (const char of characters) {
                if (char.avatar) {
                    chatPromises.push(
                        this._fetchCharacterChats(char.avatar, char)
                    );
                }
            }

            // Group chats
            for (const group of groups) {
                if (group.id) {
                    chatPromises.push(
                        this._fetchGroupChats(group)
                    );
                }
            }

            // Wait for all chat fetches to complete
            const chatArrays = await Promise.all(chatPromises);

            // Flatten and rebuild cache
            this.chatCache.clear();
            this.chatsByAvatar.clear();
            this.statsCache.clear();

            let totalChats = 0;
            for (const chats of chatArrays) {
                for (const chat of chats) {
                    try {
                        const chatKey = ChatIdentifier.getChatKey(chat);
                        this.chatCache.set(chatKey, chat);

                        // Build avatar index
                        if (!this.chatsByAvatar.has(chat.avatar)) {
                            this.chatsByAvatar.set(chat.avatar, new Set());
                        }
                        this.chatsByAvatar.get(chat.avatar).add(chatKey);

                        totalChats++;
                    } catch (error) {
                        console.warn('[ChatPlus2] Skipping invalid chat:', error.message, chat);
                    }
                }
            }

            this.lastFetchTime = Date.now();
            console.debug(`[ChatPlus2] Cached ${totalChats} chats`);

            return Array.from(this.chatCache.values());
        } catch (error) {
            console.error('[ChatPlus2] Error fetching chats:', error);
            CoreAPI.showToast('Failed to load chats', 'error');
            return [];
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Fetch chats for a specific character
     * @private
     * @param {string} avatar - Character avatar filename
     * @param {Object} character - Character object
     * @returns {Promise<Array>} Array of chat objects
     */
    async _fetchCharacterChats(avatar, character) {
        try {
            // Fetch file list + lightweight stats in a single request (fast path).
            // This avoids the per-chat /api/chats/get calls that read full JSONL files.
            const chatEntries = await CoreAPI.getCharacterChatsWithStats(avatar);

            return chatEntries.map(entry => ({
                avatar: avatar,
                file_name: entry.file_name,
                character_name: character.name || 'Unknown',
                character_id: character.id || null,
                is_group: false,
                entity: character,
                // Pre-embedded stats — populated by the server's chat list summary.
                // getChatStats() will use these directly and skip the slow /api/chats/get.
                _stats: {
                    lastMessageDate: entry.last_mes ?? null,
                    lastMessage: entry.mes ?? null,
                    messageCount: entry.chat_size ?? null,
                    createDate: null
                }
            }));
        } catch (error) {
            console.error(`[ChatPlus2] Error fetching chats for ${avatar}:`, error);
            return [];
        }
    }

    /**
     * Fetch chats for a specific group
     * @private
     * @param {Object} group - Group object
     * @returns {Promise<Array>} Array of chat objects
     */
    async _fetchGroupChats(group) {
        try {
            // Key avatar = group.id (IMMUTABLE: timestamp string, fixed at creation).
            // Previously this fell back through avatar_url / avatar / id, but avatar_url
            // is mutable — users can change their group avatar, and every stored pin /
            // folder assignment key becomes orphaned. group.id never changes.
            // The mutable `avatar_url` / `avatar` are preserved separately as
            // `display_avatar` for rendering only (UIRenderer already uses chat.entity).
            const groupAvatar = String(group.id);
            const displayAvatar = group.avatar_url || group.avatar || null;

            const chatEntries = await CoreAPI.getGroupChatsWithStats(group.id);

            return chatEntries.map(entry => ({
                avatar: groupAvatar,
                display_avatar: displayAvatar,
                file_name: entry.file_name,
                character_name: group.name || 'Unknown Group',
                group_id: group.id,
                group_members: group.members || [],
                is_group: true,
                entity: group,
                // Pre-embedded stats — same fast-path structure as _fetchCharacterChats.
                // getChatStats() will use these directly and skip the slow fallback.
                _stats: {
                    lastMessageDate: entry.last_mes ?? null,
                    lastMessage: entry.mes ?? null,
                    messageCount: entry.chat_size ?? null,
                    createDate: null
                }
            }));
        } catch (error) {
            console.error(`[ChatPlus2] Error fetching group chats for ${group.id}:`, error);
            return [];
        }
    }

    /**
     * Get a chat by its key
     *
     * @param {string} chatKey - Chat key (avatar:filename format)
     * @returns {Object|null} Chat object or null if not found
     */
    getChatByKey(chatKey) {
        return this.chatCache.get(chatKey) || null;
    }

    /**
     * Get all chats for a specific avatar
     *
     * @param {string} avatar - Avatar filename
     * @returns {Array} Array of chat objects
     */
    getChatsByAvatar(avatar) {
        const chatKeys = this.chatsByAvatar.get(avatar);
        if (!chatKeys) return [];

        return Array.from(chatKeys)
            .map(key => this.chatCache.get(key))
            .filter(chat => chat != null);
    }

    /**
     * Get statistics for a chat (last message, timestamp, message count)
     *
     * @param {Object} chat - Chat object
     * @returns {Promise<Object>} Chat statistics
     */
    async getChatStats(chat) {
        if (!chat) return null;

        try {
            const chatKey = ChatIdentifier.getChatKey(chat);

            // 1. Return cached stats if available
            if (this.statsCache.has(chatKey)) {
                return this.statsCache.get(chatKey);
            }

            // 2. Use pre-embedded stats when present (fast path — no extra network call).
            //    _fetchCharacterChats() embeds stats from /api/characters/chats, which
            //    provides last_mes, mes, and chat_size for every chat in one request.
            if (chat._stats) {
                this.statsCache.set(chatKey, chat._stats);
                return chat._stats;
            }

            // 3. Slow path fallback: load the full chat file.
            //    Reached only for chats that were not fetched via _fetchCharacterChats
            //    (e.g. group chats, or chats added to the cache by other means).
            const metadata = await CoreAPI.getChatMetadata(chat.avatar, chat.file_name);

            if (!metadata) {
                return {
                    lastMessage: null,
                    lastMessageDate: null,
                    messageCount: 0,
                    createDate: null
                };
            }

            const messages = Array.isArray(metadata) ? metadata : [];
            const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

            const stats = {
                lastMessage: lastMessage?.mes || null,
                lastMessageDate: lastMessage?.send_date || lastMessage?.gen_started || null,
                messageCount: messages.length,
                createDate: messages.length > 0 ? messages[0]?.send_date : null
            };

            this.statsCache.set(chatKey, stats);
            return stats;
        } catch (error) {
            console.error('[ChatPlus2] Error getting chat stats:', error);
            return {
                lastMessage: null,
                lastMessageDate: null,
                messageCount: 0,
                createDate: null
            };
        }
    }

    /**
     * Get all cached chats
     *
     * @returns {Array} Array of all chat objects
     */
    getAllChats() {
        return Array.from(this.chatCache.values());
    }

    /**
     * Get all cached chats with stats
     * Loads stats in parallel for better performance
     *
     * @param {number} limit - Maximum number of chats to process (optional)
     * @returns {Promise<Array>} Array of chat objects with stats
     */
    async getAllChatsWithStats(limit = null) {
        const chats = this.getAllChats();
        const chatsToProcess = limit ? chats.slice(0, limit) : chats;

        // Load stats in parallel (batched to avoid overwhelming the server)
        const BATCH_SIZE = 10;
        const results = [];

        for (let i = 0; i < chatsToProcess.length; i += BATCH_SIZE) {
            const batch = chatsToProcess.slice(i, i + BATCH_SIZE);
            const statsPromises = batch.map(chat => this.getChatStats(chat));
            const batchStats = await Promise.all(statsPromises);

            for (let j = 0; j < batch.length; j++) {
                results.push({
                    ...batch[j],
                    stats: batchStats[j]
                });
            }
        }

        // Sort by most recent first (chats with dates come before chats without)
        results.sort((a, b) => {
            const dateA = a.stats?.lastMessageDate;
            const dateB = b.stats?.lastMessageDate;

            // Chats without dates go to the end
            if (!dateA && !dateB) return 0;
            if (!dateA) return 1;
            if (!dateB) return -1;

            // Parse dates and sort descending (most recent first)
            const timeA = new Date(dateA).getTime();
            const timeB = new Date(dateB).getTime();
            return timeB - timeA;
        });

        return results;
    }

    /**
     * Rebuild the chat index
     * Called when characters are renamed, deleted, or duplicated
     *
     * @returns {Promise<void>}
     */
    async rebuildIndex() {
        console.debug('[ChatPlus2] Rebuilding chat index...');

        // Clear stats cache as it may be stale
        this.statsCache.clear();

        // Force a fresh fetch
        await this.fetchAllChats(true);

        // Emit event to notify modules
        CoreAPI.emit('chat-index-rebuilt');
    }

    /**
     * Invalidate cache for a specific avatar
     * Useful when a character's chats have changed
     *
     * @param {string} avatar - Avatar filename
     */
    invalidateAvatar(avatar) {
        const chatKeys = this.chatsByAvatar.get(avatar);
        if (!chatKeys) return;

        // Remove from cache
        for (const key of chatKeys) {
            this.chatCache.delete(key);
            this.statsCache.delete(key);
        }

        // Remove from avatar index
        this.chatsByAvatar.delete(avatar);

        console.debug(`[ChatPlus2] Invalidated cache for avatar: ${avatar}`);
    }

    /**
     * Surgically refetch a single avatar's chats — clears that avatar's
     * cache entries, then re-runs the appropriate per-entity fetch and
     * repopulates `chatCache` + `chatsByAvatar` for that avatar only.
     *
     * Use this after deleting a chat (or any single-entity mutation) so
     * the rest of the avatar's chats remain visible. Calling
     * `invalidateAvatar()` alone leaves the avatar empty until the next
     * `fetchAllChats()`, which causes the deleted chat's siblings to
     * disappear from the Recent view (44c).
     *
     * @param {string} avatar - Avatar filename for characters, or
     *                          `String(group.id)` for groups.
     * @param {boolean} [isGroup=false] - True if `avatar` refers to a group.
     * @returns {Promise<void>}
     */
    async refetchAvatar(avatar, isGroup = false) {
        if (!avatar) return;

        // Drop existing cache for this avatar
        this.invalidateAvatar(avatar);

        try {
            let entity = null;
            let chats = [];

            if (isGroup) {
                const groups = await CoreAPI.getAllGroups();
                entity = groups.find(g => String(g.id) === String(avatar)) || null;
                if (!entity) {
                    // Group is gone (deleted); nothing to repopulate.
                    return;
                }
                chats = await this._fetchGroupChats(entity);
            } else {
                const characters = await CoreAPI.getAllCharacters();
                entity = characters.find(c => c.avatar === avatar) || null;
                if (!entity) {
                    return;
                }
                chats = await this._fetchCharacterChats(avatar, entity);
            }

            for (const chat of chats) {
                try {
                    const chatKey = ChatIdentifier.getChatKey(chat);
                    this.chatCache.set(chatKey, chat);
                    if (!this.chatsByAvatar.has(chat.avatar)) {
                        this.chatsByAvatar.set(chat.avatar, new Set());
                    }
                    this.chatsByAvatar.get(chat.avatar).add(chatKey);
                } catch (error) {
                    console.warn('[ChatPlus2] refetchAvatar: skipping invalid chat:', error.message);
                }
            }

            console.debug(`[ChatPlus2] Refetched ${chats.length} chats for avatar: ${avatar}`);
        } catch (error) {
            console.error(`[ChatPlus2] refetchAvatar error for ${avatar}:`, error);
        }
    }

    /**
     * One-shot remap of stale group chat keys.
     *
     * Before Phase 2 of step 27, group chat keys used `group.avatar_url` (or
     * `group.avatar`) as their avatar component. Those values are mutable —
     * when a user changes a group's avatar, every stored key became orphaned.
     * The canonical form now uses `group.id` (immutable timestamp string).
     *
     * This method scans the supplied StateManager's pinnedChats and chatFolders
     * for keys whose avatar portion matches a legacy form of a known group and
     * rewrites them in-place. Idempotent — safe to run on every init.
     *
     * @param {import('./state-manager.js').default} stateManager
     * @returns {{ pins: number, folderAssignments: number }} Remap counts
     */
    remapStaleGroupKeys(stateManager) {
        if (!stateManager || typeof stateManager.get !== 'function') {
            return { pins: 0, folderAssignments: 0 };
        }

        const groups = CoreAPI.getAllGroups() || [];
        if (groups.length === 0) {
            return { pins: 0, folderAssignments: 0 };
        }

        // Build lookup: legacy-avatar-string -> canonical group.id
        const legacyToId = new Map();
        for (const group of groups) {
            const id = String(group.id);
            for (const legacy of [group.avatar_url, group.avatar]) {
                if (legacy && String(legacy) !== id) {
                    legacyToId.set(String(legacy), id);
                }
            }
        }
        if (legacyToId.size === 0) {
            return { pins: 0, folderAssignments: 0 };
        }

        const remapKey = (key) => {
            if (typeof key !== 'string' || !key) return null;
            const colon = key.indexOf(':');
            if (colon === -1) return null;
            const avatar = key.substring(0, colon);
            const canonical = legacyToId.get(avatar);
            if (!canonical || canonical === avatar) return null;
            return `${canonical}:${key.substring(colon + 1)}`;
        };

        let pinsRemapped = 0;
        let assignmentsRemapped = 0;

        // --- Remap pinnedChats ---------------------------------------------
        const pins = stateManager.get('pinnedChats');
        if (Array.isArray(pins) && pins.length > 0) {
            const newPins = [];
            const seen = new Set();
            for (const key of pins) {
                const remapped = remapKey(key) ?? key;
                if (remapped !== key) pinsRemapped++;
                if (!seen.has(remapped)) {
                    seen.add(remapped);
                    newPins.push(remapped);
                }
            }
            if (pinsRemapped > 0) {
                stateManager.set('pinnedChats', newPins);
            }
        }

        // --- Remap chatFolders ---------------------------------------------
        const chatFolders = stateManager.get('chatFolders');
        if (chatFolders && typeof chatFolders === 'object') {
            const newChatFolders = {};
            let changed = false;
            for (const [key, folderIds] of Object.entries(chatFolders)) {
                const remapped = remapKey(key);
                const targetKey = remapped ?? key;
                if (remapped) {
                    assignmentsRemapped++;
                    changed = true;
                }
                const existing = newChatFolders[targetKey];
                if (existing) {
                    // Merge (union) folder id arrays if a key collision occurs
                    const merged = Array.from(new Set([...existing, ...(folderIds || [])]));
                    newChatFolders[targetKey] = merged;
                } else {
                    newChatFolders[targetKey] = Array.isArray(folderIds)
                        ? [...folderIds]
                        : folderIds;
                }
            }
            if (changed) {
                stateManager.set('chatFolders', newChatFolders);
            }
        }

        if (pinsRemapped > 0 || assignmentsRemapped > 0) {
            console.info(
                `[ChatPlus2] Remapped ${pinsRemapped} pin(s) and ${assignmentsRemapped}`,
                'folder assignment(s) from legacy group-avatar keys to group.id keys'
            );
        }

        return { pins: pinsRemapped, folderAssignments: assignmentsRemapped };
    }

    /**
     * Search chats by query string
     * Searches character name, chat filename, and last message
     *
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @param {boolean} options.caseSensitive - Case sensitive search
     * @param {number} options.limit - Maximum results to return
     * @returns {Promise<Array>} Array of matching chats with stats
     */
    async searchChats(query, options = {}) {
        if (!query || typeof query !== 'string') {
            return [];
        }

        const {
            caseSensitive = false,
            limit = 100
        } = options;

        const searchTerm = caseSensitive ? query : query.toLowerCase();
        const results = [];

        for (const chat of this.chatCache.values()) {
            const characterName = caseSensitive ? chat.character_name : (chat.character_name || '').toLowerCase();
            const fileName = caseSensitive ? chat.file_name : (chat.file_name || '').toLowerCase();

            // Search in character name and filename
            if (characterName.includes(searchTerm) || fileName.includes(searchTerm)) {
                const stats = await this.getChatStats(chat);
                results.push({
                    ...chat,
                    stats
                });

                if (results.length >= limit) {
                    break;
                }
                continue;
            }

            // Search in last message if we have stats cached
            const chatKey = ChatIdentifier.getChatKey(chat);
            if (this.statsCache.has(chatKey)) {
                const stats = this.statsCache.get(chatKey);
                const lastMessage = caseSensitive ? stats.lastMessage : (stats.lastMessage || '').toLowerCase();

                if (lastMessage && lastMessage.includes(searchTerm)) {
                    results.push({
                        ...chat,
                        stats
                    });

                    if (results.length >= limit) {
                        break;
                    }
                }
            }
        }

        return results;
    }

    /**
     * Get total number of cached chats
     *
     * @returns {number} Total chat count
     */
    getChatCount() {
        return this.chatCache.size;
    }

    /**
     * Check if a chat exists by its key
     *
     * @param {string} chatKey - Chat key
     * @returns {boolean} True if chat exists
     */
    hasChat(chatKey) {
        return this.chatCache.has(chatKey);
    }

    /**
     * Clear all caches
     * Useful for complete reset
     */
    clearCache() {
        this.chatCache.clear();
        this.chatsByAvatar.clear();
        this.statsCache.clear();
        this.lastFetchTime = null;
        console.debug('[ChatPlus2] Cache cleared');
    }
}

export default ChatRepository;
