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

import { getGroupPastChats, getGroupAvatar, openGroupById } from '../../../../group-chats.js';
import { setActiveCharacter, setActiveGroup, user_avatar, default_user_avatar } from '../../../../../script.js';

// These ST helpers are NOT exposed on `SillyTavern.getContext()` but are
// required for correct entity switching (group UI sync via openGroupById)
// and active-entity persistence (setActiveCharacter / setActiveGroup make
// the choice survive page reload via RA_autoloadchat).
//
// If SillyTavern ever moves these exports, one of the static imports above
// will throw at module-load time — which is a loud, intentional failure.
// `openChat()` also re-validates their availability at call time and toasts
// a user-visible error with instructions to report the issue.

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

/**
 * Get the LostAndFound instance
 * @returns {Object|null} LostAndFound instance or null
 */
export function getLostAndFound() {
    return getModule('LostAndFound');
}

/**
 * Get the SnapshotStore instance
 * @returns {Object|null} SnapshotStore instance or null
 */
export function getSnapshotStore() {
    return getModule('SnapshotStore');
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
 *
 * Mirrors SillyTavern's own welcome-screen.js pattern exactly:
 *   - Character path: selectCharacterById → setActiveCharacter → openCharacterChat
 *   - Group path:     openGroupById      → setActiveGroup     → openGroupChat
 *
 * Why both steps? `openCharacterChat` and `openGroupChat` only swap the chat
 * file within an already-selected entity — they do NOT change which entity is
 * active and do NOT sync the right panel, top bar, or Characters tab. That's
 * `selectCharacterById` / `openGroupById`'s job. A short-circuit skips the
 * second call when the target chat is already the active one (this is what
 * ST's own past-chat UI does to avoid double-loads and UI flicker).
 *
 * Re-entrancy guard (step 43g): while one openChat call is in flight, any
 * further call is rejected with a subtle toast. This prevents misclicks on
 * other chats from queuing up partially-loaded states.
 *
 * @param {Object}  chat
 * @param {string}  [chat.file_name] - Chat filename without .jsonl (preferred)
 * @param {string}  [chat.chatFile]  - Alias for file_name (legacy callers)
 * @param {string}  [chat.avatar]    - Character avatar filename (used to select the right character)
 * @param {string}  [chat.groupId]   - Group ID (group chats only)
 * @param {boolean} [chat.is_group]  - Whether this is a group chat
 * @returns {Promise<boolean>} True if the chat was opened (or was already open); false on failure
 */
let _chatOpenInProgress = false;
export async function openChat(chat) {
    if (_chatOpenInProgress) {
        showToast('Please wait for the current chat to finish loading', 'info', 2000);
        return false;
    }
    _chatOpenInProgress = true;
    showLoadingOverlay('Opening chat…');
    try {
        return await _openChatInternal(chat);
    } finally {
        _chatOpenInProgress = false;
        hideLoadingOverlay();
    }
}

async function _openChatInternal(chat) {
    try {
        const context = getContext();
        if (!context) {
            console.error('[ChatPlus2] SillyTavern context not available');
            return false;
        }

        // Fail loud if ST's helper exports moved — silent half-broken
        // behaviour (the previous bug) is exactly what we're fixing.
        if (!openGroupById || !setActiveCharacter || !setActiveGroup) {
            showToast(
                'ChatPlus 2 cannot open chats on this SillyTavern version. '
                + 'Please report this on the SillyTavern Discord so we can ship a fix.',
                'error'
            );
            console.error('[ChatPlus2] ST helper imports missing; see module-load logs');
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
            return await _openGroupChatSwitch(context, String(chat.groupId), fileName);
        }

        // ── Character chat ───────────────────────────────────────────────────
        if (!chat.avatar) {
            console.error('[ChatPlus2] openChat: no avatar provided for character chat', chat);
            return false;
        }
        return await _openCharacterChatSwitch(context, chat.avatar, fileName);
    } catch (error) {
        console.error('[ChatPlus2] Error opening chat:', error);
        showToast('Failed to open chat — see console for details', 'error');
        return false;
    }
}

/**
 * Internal: switch into a character chat, mirroring openRecentCharacterChat
 * from welcome-screen.js.
 * @private
 */
async function _openCharacterChatSwitch(context, avatar, fileName) {
    const characters = context.characters || [];
    const idx = characters.findIndex(c => c.avatar === avatar);
    if (idx === -1) {
        console.warn('[ChatPlus2] openChat: character not found for avatar', avatar);
        showToast('Character not found for this chat', 'error');
        return false;
    }

    // Short-circuit: already on this exact character + chat
    if (!context.groupId
        && Number(context.characterId) === idx
        && context.getCurrentChatId?.() === fileName) {
        return true;
    }

    // Step 1: switch entity. Resets selected_group, fires CHAT_CHANGED,
    // loads the character card's default chat, syncs all UI.
    try {
        await context.selectCharacterById(idx);
    } catch (error) {
        console.error('[ChatPlus2] selectCharacterById failed:', error);
        showToast('Could not switch to that character', 'error');
        return false;
    }

    // Step 2: persist choice so RA_autoloadchat restores it after reload
    try {
        setActiveCharacter(avatar);
        context.saveSettingsDebounced?.();
    } catch (error) {
        // Non-fatal — user can still use the chat, just won't auto-reload it
        console.warn('[ChatPlus2] setActiveCharacter failed:', error);
    }

    // Step 3: if selectCharacterById already loaded the target chat (because
    // it's the character's default), we're done. Otherwise swap the file.
    if (context.getCurrentChatId?.() === fileName) {
        return true;
    }

    // openCharacterChat is a DESTRUCTIVE NO-MATCH on stale filenames: ST
    // treats a missing chat file as "create a new empty chat with that
    // name". Before calling it, verify the target chat actually exists on
    // disk by hitting the LIVE /api/characters/chats endpoint — the
    // ChatRepository cache (30 s TTL) may still be returning the old
    // filename after an external rename. If not present, invalidate the
    // avatar cache and hand off to Lost & Found (step 29, solo character
    // path — mirrors the group-chat hand-off below).
    const chatRepository = getModule('ChatRepository');
    const staleKey = `${avatar}:${fileName.replace(/\.jsonl$/, '')}`;

    let targetExists;
    try {
        const liveChats = await getCharacterChatsWithStats(avatar);
        const wanted = fileName.replace(/\.jsonl$/, '');
        targetExists = liveChats.some(c => c.file_name === wanted);
    } catch (error) {
        // Network/fetch error: fall back to cached check rather than
        // blocking the user outright.
        console.warn('[ChatPlus2] Live chat-list fetch failed; using cache', error);
        targetExists = chatRepository
            ? !!chatRepository.getChatByKey(staleKey)
            : true;
    }

    if (!targetExists) {
        // Rebuild the full ChatRepository cache against live data before handing off. `invalidateAvatar()` alone would wipe the avatar's index, leaving LostAndFound.findCandidates() with nothing to match against — the Recent-Chats resolver would then open with zero "Reconnect to" suggestions. A forced fetch repopulates getChatByKey (so resolveStaleKey's "is this live?" pre-check correctly identifies the old name as gone) AND getChatsByAvatar (so candidate matching finds the renamed file). The fetch also emits 'chat-index-rebuilt', which keeps pinned / folder views in sync on the next render.
        try {
            await chatRepository?.fetchAllChats(true);
        } catch (error) {
            console.warn('[ChatPlus2] Forced chat-repository refresh failed', error);
        }

        console.warn(
            '[ChatPlus2] Target chat not in ChatRepository — handing off to Lost & Found',
            { avatar, fileName }
        );

        const lf = getModule('LostAndFound');

        if (lf && typeof lf.resolveStaleKey === 'function') {
            let summary;
            try {
                summary = await lf.resolveStaleKey(staleKey);
            } catch (error) {
                console.error('[ChatPlus2] Lost & Found resolver errored:', error);
            }

            // If the user relinked, retry the open with the new filename.
            const relinkResult = summary?.results?.find(
                r => r.action === 'relink' && r.orphanKey === staleKey && r.success
            );
            if (relinkResult?.newKey) {
                // newKey format: "<avatar>:<fileName-without-jsonl>"; split
                // on the first colon since fileNames themselves can contain
                // colons in theory.
                const sepIdx = relinkResult.newKey.indexOf(':');
                const newFileName = sepIdx >= 0
                    ? relinkResult.newKey.slice(sepIdx + 1)
                    : '';

                if (newFileName) {
                    // Relink targets come from findCandidates() which sources
                    // live chats, so we trust the filename without re-checking
                    // the cache (we just invalidated it above).
                    try {
                        await context.openCharacterChat(newFileName);
                        return true;
                    } catch (error) {
                        console.error('[ChatPlus2] openCharacterChat retry after relink failed:', error);
                    }
                } else {
                    console.warn(
                        '[ChatPlus2] Relinked key produced no filename',
                        { newKey: relinkResult.newKey }
                    );
                }
            }
        }

        // Fallback: no resolver, user cancelled, or retry failed.
        showToast('This chat no longer exists for this character', 'warning');
        return false;
    }

    try {
        await context.openCharacterChat(fileName);
        return true;
    } catch (error) {
        console.error('[ChatPlus2] openCharacterChat failed:', error);
        showToast('Could not open that chat file', 'error');
        return false;
    }
}

/**
 * Internal: switch into a group chat, mirroring openRecentGroupChat from
 * welcome-screen.js.
 * @private
 */
async function _openGroupChatSwitch(context, groupId, fileName) {
    const groups = context.groups || [];
    const group = groups.find(g => String(g.id) === groupId);
    if (!group) {
        console.warn('[ChatPlus2] openChat: group not found', groupId);
        showToast('Group not found for this chat', 'error');
        return false;
    }

    // Short-circuit: already on this exact group + chat
    if (String(context.groupId) === groupId
        && context.getCurrentChatId?.() === fileName) {
        return true;
    }

    // Step 1: switch entity. openGroupById sets selected_group, calls
    // select_group_chats (right panel + top bar + groupSelected event),
    // resets this_chid, clears chat, loads the group's current chat.
    //
    // Guarded against isChatSaving (toasts + returns false),
    // is_send_press / is_group_generating (silent false).
    let switchResult;
    try {
        switchResult = await openGroupById(groupId);
    } catch (error) {
        console.error('[ChatPlus2] openGroupById failed:', error);
        showToast('Could not switch to that group', 'error');
        return false;
    }

    // Returns false when blocked by save/gen guards OR when the group was
    // already selected (in which case we still continue to step 3).
    if (switchResult === false && String(context.groupId) !== groupId) {
        // openGroupById's own toastr handles isChatSaving. Covers the
        // silent-false cases (is_send_press / is_group_generating).
        showToast(
            'Cannot switch chats while a generation is in progress',
            'warning'
        );
        return false;
    }

    // Step 2: persist
    try {
        setActiveGroup(groupId);
        context.saveSettingsDebounced?.();
    } catch (error) {
        console.warn('[ChatPlus2] setActiveGroup failed:', error);
    }

    // Step 3: if the group is now on the target chat already, done.
    if (context.getCurrentChatId?.() === fileName) {
        return true;
    }

    // openGroupChat is a SILENT NO-OP if fileName is not in group.chats[].
    // Instead of a dead-end toast, hand off to Lost & Found so the user
    // can relink against a surviving chat in the same group (step 29,
    // Bug C hand-off point from step 28).
    const groupChats = Array.isArray(group.chats) ? group.chats : [];
    if (!groupChats.includes(fileName)) {
        console.warn(
            '[ChatPlus2] Target chat not in group.chats[] — handing off to Lost & Found',
            { groupId, fileName, available: groupChats }
        );

        const staleKey = `${groupId}:${fileName.replace(/\.jsonl$/, '')}`;
        const lf = getModule('LostAndFound');

        if (lf && typeof lf.resolveStaleKey === 'function') {
            let summary;
            try {
                summary = await lf.resolveStaleKey(staleKey);
            } catch (error) {
                console.error('[ChatPlus2] Lost & Found resolver errored:', error);
            }

            // If the user relinked, retry the open with the new filename.
            const relinkResult = summary?.results?.find(
                r => r.action === 'relink' && r.orphanKey === staleKey && r.success
            );
            if (relinkResult?.newKey) {
                // newKey format: "<avatar>:<fileName-without-jsonl>"; split
                // on the first colon since fileNames themselves can contain
                // colons in theory.
                const sepIdx = relinkResult.newKey.indexOf(':');
                const newFileName = sepIdx >= 0
                    ? relinkResult.newKey.slice(sepIdx + 1)
                    : '';

                // Re-read the group — openGroupById may have refreshed state.
                const freshGroup = (context.groups || []).find(g => String(g.id) === groupId);
                const freshChats = Array.isArray(freshGroup?.chats) ? freshGroup.chats : [];

                if (newFileName && freshChats.includes(newFileName)) {
                    try {
                        await context.openGroupChat(groupId, newFileName);
                        return true;
                    } catch (error) {
                        console.error('[ChatPlus2] openGroupChat retry after relink failed:', error);
                    }
                } else {
                    console.warn(
                        '[ChatPlus2] Relinked key still not in fresh group.chats[]',
                        { newFileName, freshChats }
                    );
                }
            }
        }

        // Fallback: no resolver, user cancelled, or retry failed.
        showToast('This chat no longer exists in this group', 'warning');
        return false;
    }

    try {
        await context.openGroupChat(groupId, fileName);
        return true;
    } catch (error) {
        console.error('[ChatPlus2] openGroupChat failed:', error);
        showToast('Could not open that group chat file', 'error');
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
 * Rename a chat file.
 *
 * Server endpoint `/api/chats/rename` expects `original_file` / `renamed_file`
 * (NOT `old_file_name` / `new_file_name`) and uses the `is_group` flag to
 * decide between `groupChats/` and `chats/<avatar>/` directories.
 *
 * @param {string}  avatar       - Character avatar filename (unused when isGroup is true)
 * @param {string}  oldFileName  - Current chat filename (without .jsonl)
 * @param {string}  newFileName  - New chat filename (without .jsonl)
 * @param {boolean} [isGroup]    - True for group chats
 * @returns {Promise<boolean>} Success status
 */
export async function renameChat(avatar, oldFileName, newFileName, isGroup = false) {
    try {
        const context = getContext();
        const getRequestHeaders = context?.getRequestHeaders;

        if (!getRequestHeaders) {
            console.warn('[ChatPlus2] getRequestHeaders not available');
            return false;
        }

        const appendJsonl = (name) => {
            if (!name) return name;
            return name.endsWith('.jsonl') ? name : `${name}.jsonl`;
        };

        const body = {
            is_group: !!isGroup,
            original_file: appendJsonl(oldFileName),
            renamed_file: appendJsonl(newFileName),
        };
        if (!isGroup) {
            body.avatar_url = avatar;
        }

        const response = await fetch('/api/chats/rename', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body)
        });

        return response.ok;
    } catch (error) {
        console.error('[ChatPlus2] Error renaming chat:', error);
        return false;
    }
}

/**
 * Delete a chat file.
 *
 * Character chats use `/api/chats/delete` with `{ avatar_url, chatfile }`
 * (note: server reads `chatfile`, NOT `file_name`).
 * Group chats use a separate endpoint `/api/chats/group/delete` with `{ id }`.
 *
 * @param {string}  avatar    - Character avatar filename (ignored for group chats)
 * @param {string}  chatFile  - Chat filename (with or without .jsonl)
 * @param {boolean} [isGroup] - True for group chats
 * @returns {Promise<boolean>} Success status
 */
export async function deleteChat(avatar, chatFile, isGroup = false) {
    showLoadingOverlay('Deleting chat…');
    try {
        return await _deleteChatInternal(avatar, chatFile, isGroup);
    } finally {
        hideLoadingOverlay();
    }
}

async function _deleteChatInternal(avatar, chatFile, isGroup) {
    try {
        const context = getContext();
        const getRequestHeaders = context?.getRequestHeaders;

        if (!getRequestHeaders) {
            console.warn('[ChatPlus2] getRequestHeaders not available');
            return false;
        }

        // Group chats live under `{user}/group-chats/` and have their own endpoint.
        // Strip any .jsonl extension since the server appends it itself.
        if (isGroup) {
            const id = String(chatFile || '').replace(/\.jsonl$/, '');
            const response = await fetch('/api/chats/group/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id })
            });
            return response.ok;
        }

        // Character chats — note the field is `chatfile`, not `file_name`.
        const response = await fetch('/api/chats/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                avatar_url: avatar,
                chatfile: chatFile
            })
        });

        return response.ok;
    } catch (error) {
        console.error('[ChatPlus2] Error deleting chat:', error);
        return false;
    }
}

/**
 * Delete one or more chats and reconcile all dependent state.
 *
 * Pipeline (run in this order — order is the correctness guarantee):
 *   1. Fire each `deleteChat` server call sequentially, count successes,
 *      track unique `(avatar, isGroup)` pairs.
 *   2. For each unique avatar, surgically `refetchAvatar()` so the
 *      `ChatRepository` cache reflects the deletion before any cleanup runs.
 *   3. `cleanOrphanedPins()` — now sees the fresh cache and drops
 *      pinned references to deleted chats (would be a no-op against
 *      stale cache, which was the 44c regression).
 *   4. `cleanOrphanedAssignments()` — same reasoning for folder assignments.
 *   5. Emit `'repository-mutated'` so subscribed views (RecentChatsView,
 *      FoldersView) re-render from scratch with their existing filter state.
 *
 * Loading overlay is the caller's responsibility — this function may run
 * from non-UI contexts (programmatic mutations, future bulk operations).
 *
 * Internal calls bypass the per-chat overlay (`_deleteChatInternal`) so a
 * caller-supplied single overlay span stays continuous across the loop.
 *
 * @param {Array<Object>} chats - Chat objects (must include `avatar`,
 *                                `file_name`, and `is_group`).
 * @returns {Promise<{ deleted: number, failed: number }>}
 */
export async function deleteChats(chats) {
    if (!Array.isArray(chats) || chats.length === 0) {
        return { deleted: 0, failed: 0 };
    }

    let deleted = 0;
    let failed = 0;
    const affectedAvatars = new Map(); // avatar -> isGroup

    for (const chat of chats) {
        if (!chat || !chat.file_name) {
            failed++;
            continue;
        }
        const isGroup = !!chat.is_group;
        try {
            const ok = await _deleteChatInternal(chat.avatar, chat.file_name, isGroup);
            if (ok) {
                deleted++;
                if (!affectedAvatars.has(chat.avatar)) {
                    affectedAvatars.set(chat.avatar, isGroup);
                }
            } else {
                failed++;
            }
        } catch (error) {
            console.error('[ChatPlus2] deleteChats: error deleting chat:', error);
            failed++;
        }
    }

    // 2. Surgical per-avatar refetch — runs BEFORE cleanup so cache is fresh.
    const repo = getChatRepository();
    if (repo) {
        for (const [avatar, isGroup] of affectedAvatars) {
            try {
                await repo.refetchAvatar(avatar, isGroup);
            } catch (error) {
                console.error(`[ChatPlus2] deleteChats: refetchAvatar(${avatar}) failed:`, error);
            }
        }
    }

    // 3 + 4. Orphan cleanup against fresh cache.
    try {
        await getPinnedChatsManager()?.cleanOrphanedPins?.();
    } catch (error) {
        console.error('[ChatPlus2] deleteChats: cleanOrphanedPins failed:', error);
    }
    try {
        getFolderSystemManager()?.cleanOrphanedAssignments?.();
    } catch (error) {
        console.error('[ChatPlus2] deleteChats: cleanOrphanedAssignments failed:', error);
    }

    // 5. Notify subscribers (views re-render from scratch).
    emit('repository-mutated', {
        reason: 'delete',
        deleted,
        failed,
        avatars: Array.from(affectedAvatars.keys()),
    });

    return { deleted, failed };
}

/**
 * Fetch the messages of a chat file from disk.
 *
 * Character chats → `POST /api/chats/get` with `{ avatar_url, file_name }`.
 * Group chats    → `POST /api/chats/group/get` with `{ id: <fileName without .jsonl> }`.
 *
 * The server returns an array whose first element is a chat-metadata object
 * (not a message). This wrapper strips that leading metadata entry and
 * returns only the message array. On any error it returns `[]` and logs —
 * callers (the Lost & Found preview panel) must degrade gracefully.
 *
 * @param {string}  avatar    - Character avatar filename (ignored for group chats)
 * @param {string}  fileName  - Chat filename (with or without .jsonl)
 * @param {boolean} [isGroup] - True for group chats
 * @returns {Promise<Array<Object>>} Array of message objects (may be empty)
 */
export async function fetchChatMessages(avatar, fileName, isGroup = false) {
    try {
        const context = getContext();
        const getRequestHeaders = context?.getRequestHeaders;

        if (!getRequestHeaders) {
            console.warn('[ChatPlus2] fetchChatMessages: getRequestHeaders not available');
            return [];
        }

        let response;
        if (isGroup) {
            const id = String(fileName || '').replace(/\.jsonl$/, '');
            response = await fetch('/api/chats/group/get', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id })
            });
        } else {
            response = await fetch('/api/chats/get', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    avatar_url: avatar,
                    file_name: String(fileName || '').replace(/\.jsonl$/, '')
                })
            });
        }

        if (!response.ok) {
            console.warn(`[ChatPlus2] fetchChatMessages: HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        if (!Array.isArray(data)) return [];

        // First entry is chat metadata (user_name / character_name / create_date / chat_metadata),
        // not a message. Strip it if present. Group chats have the same convention.
        if (data.length > 0 && data[0] && !('is_user' in data[0]) && !('mes' in data[0])) {
            return data.slice(1);
        }
        return data;
    } catch (error) {
        console.error('[ChatPlus2] fetchChatMessages error:', error);
        return [];
    }
}

// ========================================
// CONNECTION PROFILES + HEADLESS MESSAGING
// ========================================
//
// These power the multi-profile chat tabs feature. A "headless" send generates
// a reply through a SECONDARY connection profile WITHOUT switching the active
// character/chat (no preset/lorebook/extension reload). The mechanism is ST's
// ConnectionManagerRequestService.sendRequest — the same one ST-Copilot uses.
// History persists straight to the target chat's real .jsonl so a later
// "Promote to full chat" (openChat) loads it natively with everything intact.

/**
 * List the connection profiles configured in the Connection Manager extension.
 * Prefers the service's filtered list; falls back to raw settings.
 * @returns {Array<Object>} Array of profile objects ({ id, name, api, model, ... })
 */
export function getConnectionProfiles() {
    const context = getContext();
    try {
        const service = context?.ConnectionManagerRequestService;
        if (service && typeof service.getSupportedProfiles === 'function') {
            const list = service.getSupportedProfiles();
            if (Array.isArray(list)) return list;
        }
    } catch (error) {
        console.warn('[ChatPlus2] getSupportedProfiles failed, using raw settings:', error);
    }
    const raw = context?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(raw) ? raw : [];
}

/**
 * Get the id of the globally-active connection profile (the one the main chat
 * uses), or null when none is selected.
 * @returns {string|null}
 */
export function getActiveProfileId() {
    return getContext()?.extensionSettings?.connectionManager?.selectedProfile || null;
}

/**
 * Find a connection profile by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function getProfileById(id) {
    if (!id) return null;
    return getConnectionProfiles().find(p => p.id === id) || null;
}

/**
 * Whether the Connection Manager request service is available. The headless
 * send path requires it; callers should degrade gracefully (e.g. fall back to
 * "Promote to full chat") when this returns false.
 * @returns {boolean}
 */
export function isHeadlessSendAvailable() {
    const service = getContext()?.ConnectionManagerRequestService;
    return !!(service && typeof service.sendRequest === 'function');
}

/**
 * Produce a SillyTavern-style message timestamp string. ST's own
 * getMessageTimeStamp is not exposed on the context, so fall back to an ISO
 * string (ST's addOneMessage tolerates any parseable date).
 * @returns {string}
 */
export function getMessageTimeStamp() {
    const fn = getContext()?.getMessageTimeStamp;
    if (typeof fn === 'function') {
        try { return fn(); } catch { /* fall through */ }
    }
    return new Date().toISOString();
}

/**
 * Render message text to SillyTavern's sanitized HTML (markdown, macros, regex
 * display) so overlay transcript bubbles match the native chat. Thin wrapper
 * over context.messageFormatting.
 * @param {string} mes - Raw message text
 * @param {string} charName - Name to attribute the message to
 * @param {boolean} isUser - Whether this is a user message
 * @param {number} [messageId=0] - Message index (used by some regex scripts)
 * @returns {string} Sanitized HTML
 */
export function formatMessageHtml(mes, charName, isUser, messageId = 0) {
    const fn = getContext()?.messageFormatting;
    if (typeof fn !== 'function') {
        return escapeHtml(String(mes ?? ''));
    }
    try {
        return fn(String(mes ?? ''), charName, false, !!isUser, messageId, {}, false);
    } catch (error) {
        console.warn('[ChatPlus2] messageFormatting failed, falling back to escaped text:', error);
        return escapeHtml(String(mes ?? ''));
    }
}

/**
 * Build a chat message DOM node that looks identical to a native main-chat
 * message, so user themes / custom CSS apply (ST's `.mes` styling is global,
 * not `#chat`-scoped). Clones ST's `#message_template .mes` and populates only
 * the DISPLAY fields, then strips every interactive/stateful control so no
 * global ST handler can fire on it and the live `chat[]` is never touched.
 *
 * Deliberately does NOT use ST's `updateMessageElement` (script.js:2559): that
 * derives non-user avatars from the ACTIVE character and calls updateSwipeCounter
 * which reads global chat[] — both wrong/unsafe for an off-screen secondary chat.
 *
 * @param {Object} mes - Message object ({ name, is_user, mes, send_date, extra })
 * @param {Object} opts
 * @param {string} opts.avatar - The chat's character avatar filename (for char messages)
 * @param {string} [opts.characterName] - Fallback display name for char messages
 * @returns {HTMLElement} A `.mes` element ready to append to a transcript
 */
export function buildChatMessageElement(mes, { avatar, characterName } = {}) {
    const context = getContext();
    const isUser = !!mes.is_user;
    const name = mes.name || characterName || (isUser ? (context?.name1 || 'You') : (characterName || 'Assistant'));

    // Clone ST's message template; fall back to a minimal node if absent.
    const tpl = document.querySelector('#message_template .mes');
    /** @type {HTMLElement} */
    let el;
    if (tpl) {
        el = /** @type {HTMLElement} */ (tpl.cloneNode(true));
    } else {
        el = document.createElement('div');
        el.className = 'mes';
        el.innerHTML = '<div class="mesAvatarWrapper"><div class="avatar"><img></div></div>'
            + '<div class="mes_block"><div class="ch_name"><span class="name_text"></span>'
            + '<small class="timestamp"></small></div><div class="mes_text"></div></div>';
    }

    // ── Avatar src ──
    const getThumb = context?.getThumbnailUrl;
    let avatarSrc;
    if (isUser) {
        avatarSrc = (getThumb ? getThumb('persona', user_avatar) : null) || default_user_avatar;
    } else {
        avatarSrc = (getThumb && avatar ? getThumb('avatar', avatar) : null) || '/img/ai4.png';
    }

    // ── Attributes used by theme selectors ──
    el.setAttribute('is_user', String(isUser));
    el.setAttribute('is_system', 'false');
    el.setAttribute('ch_name', name);
    el.removeAttribute('mesid'); // not a real chat index — keep empty

    const imgEl = el.querySelector('.avatar img');
    if (imgEl) {
        imgEl.setAttribute('src', avatarSrc);
        imgEl.addEventListener('error', () => {
            imgEl.style.display = 'none';
            const parent = imgEl.parentElement;
            if (parent) parent.innerHTML = '<div class="missing-avatar fa-solid fa-user-slash"></div>';
        });
    }

    const nameEl = el.querySelector('.ch_name .name_text');
    if (nameEl) nameEl.textContent = name;

    // ── Timestamp (best-effort) ──
    const tsEl = el.querySelector('.timestamp');
    if (tsEl) {
        let ts = '';
        try {
            const moment = context?.timestampToMoment?.(mes.send_date) || (window.moment ? window.moment(mes.send_date) : null);
            if (moment && moment.isValid?.()) ts = moment.format('LL LT');
        } catch { /* leave blank */ }
        tsEl.textContent = ts;
    }

    const textEl = el.querySelector('.mes_text');
    if (textEl) textEl.innerHTML = formatMessageHtml(mes.mes || '', name, isUser, 0);

    // ── Strip interactive / stateful chrome so no global handlers fire ──
    const STRIP = [
        '.mes_buttons', '.mes_edit_buttons', '.del_checkbox', '.for_checkbox',
        '.swipe_left', '.swipe_right', '.swipeRightBlock', '.mesIDDisplay',
        '.tokenCounterDisplay', '.mes_timer', '.mes_reasoning_details',
        '.mes_bias', '.mes_media_wrapper', '.mes_file_wrapper', '.mes_ghost',
    ];
    for (const sel of STRIP) el.querySelectorAll(sel).forEach(n => n.remove());

    return el;
}

// ─── #chat CSS theme parity (re-scoping) ──────────────────────────────────
// Some message styling is scoped to the unique `#chat` id (Document display
// mode, `#chat .mes.selected`, and arbitrary user-theme custom CSS). Those
// rules don't reach our off-screen panel. We mirror every `#chat …` rule onto
// our container by rewriting the `#chat` token to a chosen scope selector and
// injecting the result as a `<style>`. Pure CSS — never touches ST's DOM/JS or
// the `#chat` id, so the live chat is unaffected. Duplicating `id="chat"` would
// be unsafe (ST queries `#chat .mes[mesid=…]` / scrolls `$('#chat')`).

const CHAT_ALIAS_STYLE_ID = 'chatplus-chat-style-alias';
const _ALIAS_PAINT_PROPS = new Set([
    'background', 'background-color', 'background-image', 'background-position',
    'background-size', 'background-repeat', 'background-attachment', 'background-blend-mode',
    'backdrop-filter', '-webkit-backdrop-filter', 'box-shadow', 'text-shadow', 'color',
    'border', 'border-color', 'border-width', 'border-style', 'border-radius',
    'border-top', 'border-bottom', 'border-left', 'border-right', 'filter', 'opacity',
]);

/** Split a selector list on top-level commas (ignore commas inside ()/[]). @private */
function _splitSelectorList(sel) {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of sel) {
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
}

/** True if a descendant/combinator + token follows the `#chat` compound. @private */
function _hasDescendantAfterChat(sel) {
    // Match `#chat` plus any chained simple selectors (.class / :pseudo(...) /
    // [attr] / #id), then check whether a combinator + token still follows.
    const re = /#chat(?![\w-])(?:[.:#][\w-]+(?:\([^)]*\))?|\[[^\]]*\])*/;
    const m = re.exec(sel);
    if (!m) return false;
    return sel.slice(m.index + m[0].length).trim().length > 0;
}

/** Keep only paint-related declarations from a style decl (for container rules). @private */
function _filterPaintProps(style) {
    const out = [];
    for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        if (_ALIAS_PAINT_PROPS.has(prop)) {
            const pri = style.getPropertyPriority(prop);
            out.push(`${prop}: ${style.getPropertyValue(prop)}${pri ? ' !' + pri : ''};`);
        }
    }
    return out.join(' ');
}

/**
 * Resolve a (possibly nested) selector list against its parent selectors,
 * flattening native CSS nesting. `&` is substituted with each parent; a nested
 * selector without `&` (implicit nesting, e.g. `#chat .mes_block`) becomes a
 * descendant of the parent. Top-level rules (no parent) are returned as-is.
 * @private
 */
function _resolveSelectors(parentSelectors, selectorText) {
    const own = _splitSelectorList(selectorText);
    if (!parentSelectors || parentSelectors.length === 0) return own;
    const out = [];
    for (const p of parentSelectors) {
        for (const n of own) {
            out.push(n.includes('&') ? n.replace(/&/g, p) : `${p} ${n}`);
        }
    }
    return out;
}

/** Emit rescoped CSS for the resolved selectors that touch `#chat`. @private */
function _emitRescoped(selectors, style, scope) {
    const fullDecls = style?.cssText;
    if (!fullDecls) return '';
    const lines = [];
    for (const part of selectors) {
        if (!/#chat(?![\w-])/.test(part)) continue;
        const selector = part.replace(/#chat(?![\w-])/g, scope);
        if (_hasDescendantAfterChat(part)) {
            lines.push(`${selector} { ${fullDecls} }`);
        } else {
            // Container-level `#chat {…}` — only carry paint props so a themed
            // chat background transfers without breaking our flex layout.
            const paint = _filterPaintProps(style);
            if (paint) lines.push(`${selector} { ${paint} }`);
        }
    }
    return lines.join('\n');
}

/**
 * Recursively collect rescoped CSS from a CSSRuleList, flattening native CSS
 * nesting (resolving `&` / implicit descendants against `parentSelectors`).
 * @private
 */
function _collectAliasRules(rules, scope, parentSelectors = null) {
    const out = [];
    for (const rule of Array.from(rules)) {
        // Style rule (top-level OR nested) — identified by selectorText.
        if (typeof rule.selectorText === 'string') {
            const resolved = _resolveSelectors(parentSelectors, rule.selectorText);
            const css = _emitRescoped(resolved, rule.style, scope);
            if (css) out.push(css);
            if (rule.cssRules && rule.cssRules.length) {
                out.push(..._collectAliasRules(rule.cssRules, scope, resolved));
            }
            continue;
        }
        // Conditional group rule (@media / @supports) — recurse with the SAME
        // parent context, preserving the wrapper.
        if (rule.cssRules && (rule.media || rule.conditionText)) {
            const inner = _collectAliasRules(rule.cssRules, scope, parentSelectors);
            if (inner.length) {
                const cond = rule.media
                    ? `@media ${rule.media.mediaText}`
                    : `@supports ${rule.conditionText}`;
                out.push(`${cond} {\n${inner.join('\n')}\n}`);
            }
            continue;
        }
        // CSSNestedDeclarations — bare declarations that apply to the parent.
        if (rule.style && typeof rule.selectorText === 'undefined' && !rule.cssRules) {
            const css = _emitRescoped(parentSelectors || [], rule.style, scope);
            if (css) out.push(css);
        }
    }
    return out;
}

/** Build the full rescoped CSS text for the given scope selector. @private */
function _buildChatAliasCss(scope) {
    const out = [];
    for (const sheet of Array.from(document.styleSheets)) {
        if (sheet.ownerNode && sheet.ownerNode.id === CHAT_ALIAS_STYLE_ID) continue; // don't recurse on ourselves
        let rules;
        try { rules = sheet.cssRules; } catch { continue; } // cross-origin sheet
        if (!rules) continue;
        out.push(..._collectAliasRules(rules, scope));
    }
    return out.join('\n');
}

/**
 * Mirror every `#chat`-scoped CSS rule onto `scopeSelector` so themed/main-chat
 * styling applies to our secondary-chat panel. Rebuilds on SETTINGS_UPDATED
 * (theme / custom-CSS edits). Returns a cleanup fn that removes the style and
 * unsubscribes.
 *
 * @param {string} scopeSelector - e.g. '#chatplus-tab-panels .cp-tab-transcript'
 * @returns {() => void} cleanup
 */
export function installChatStyleAlias(scopeSelector) {
    let styleEl = document.getElementById(CHAT_ALIAS_STYLE_ID);
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = CHAT_ALIAS_STYLE_ID;
        document.head.appendChild(styleEl);
    }

    const rebuild = () => {
        try {
            styleEl.textContent = _buildChatAliasCss(scopeSelector);
        } catch (error) {
            console.warn('[ChatPlus2] installChatStyleAlias rebuild failed:', error);
        }
    };
    rebuild();

    // Resync whenever stylesheets change/load. Theme extensions (e.g. Moonlit
    // Echoes) inject their CSS via <link>/<style> at runtime — after our first
    // build, often async (link load) and via their OWN settings (not
    // SETTINGS_UPDATED) — so a one-time build misses them. Rebuild on:
    // SETTINGS_UPDATED, APP_READY, <head> mutations (added/removed/edited
    // <style>/<link>), stylesheet-link load events, and a few delayed ticks.
    let timer = null;
    const scheduleRebuild = () => { clearTimeout(timer); timer = setTimeout(rebuild, 200); };

    const context = getContext();
    const es = context?.eventSource;
    const evtSettings = context?.eventTypes?.SETTINGS_UPDATED || 'settings_updated';
    const evtReady = context?.eventTypes?.APP_READY || 'app_ready';
    if (es?.on) { es.on(evtSettings, scheduleRebuild); es.on(evtReady, scheduleRebuild); }

    // Rebuild when a stylesheet <link> finishes loading (async).
    const attachLinkLoad = (node) => {
        if (node && node.nodeType === 1 && node.tagName === 'LINK' && node.rel === 'stylesheet') {
            node.addEventListener('load', scheduleRebuild, { once: true });
        }
    };
    document.querySelectorAll('link[rel="stylesheet"]').forEach(attachLinkLoad);

    // Watch <head> for added/removed/edited <style>/<link> nodes.
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            // Ignore changes to our own alias <style> (prevents a rebuild loop).
            if (m.target === styleEl || styleEl.contains(m.target)) continue;
            const nodes = [...m.addedNodes, ...m.removedNodes];
            if (nodes.length === 1 && nodes[0] === styleEl) continue;
            const touchesStylesheet = m.type === 'characterData'
                || nodes.some(n => n.nodeType === 1 && (n.tagName === 'STYLE' || n.tagName === 'LINK'));
            if (touchesStylesheet) {
                nodes.forEach(attachLinkLoad);
                scheduleRebuild();
                break;
            }
        }
    });
    try {
        observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    } catch { /* best-effort */ }

    // Safety net for async theme injection during app startup.
    const safetyTimers = [300, 1200, 3000].map(ms => setTimeout(rebuild, ms));

    return () => {
        clearTimeout(timer);
        safetyTimers.forEach(clearTimeout);
        observer.disconnect();
        if (es?.removeListener) {
            try { es.removeListener(evtSettings, scheduleRebuild); } catch { /* best-effort */ }
            try { es.removeListener(evtReady, scheduleRebuild); } catch { /* best-effort */ }
        }
        document.getElementById(CHAT_ALIAS_STYLE_ID)?.remove();
    };
}

// ─── Per-chat write serialization ─────────────────────────────────────────
// Read-latest → append → save must never interleave for the same chat file,
// or a concurrent writer could clobber freshly-appended messages. Serialize
// all file mutations per chatKey through a simple promise chain.
const _chatWriteLocks = new Map();

/**
 * Run `fn` with exclusive access to a chat file (keyed by chatKey). Calls for
 * the same key run strictly one after another; different keys run in parallel.
 * @template T
 * @param {string} chatKey
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withChatLock(chatKey, fn) {
    const prev = _chatWriteLocks.get(chatKey) || Promise.resolve();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    // Chain so the NEXT caller waits for us; swallow prior errors so one
    // failure doesn't poison the chain. The map holds at most one (chained)
    // promise per chatKey, overwritten each call — bounded by distinct keys.
    const chained = prev.then(() => next, () => next);
    _chatWriteLocks.set(chatKey, chained);
    await prev.catch(() => { });
    try {
        return await fn();
    } finally {
        release();
        // If no newer caller has chained on, drop the entry.
        if (_chatWriteLocks.get(chatKey) === chained) {
            _chatWriteLocks.delete(chatKey);
        }
    }
}

/**
 * Read a character chat file from disk, split into its header + messages.
 * Unlike fetchChatMessages (which discards the header), this preserves the
 * leading chat-header object so appendToChatFile can write it back unchanged.
 *
 * @param {string} avatar - Character avatar filename
 * @param {string} fileName - Chat filename (with or without .jsonl)
 * @returns {Promise<{ header: Object|null, messages: Array<Object> }>}
 */
export async function readChatFile(avatar, fileName) {
    const context = getContext();
    const getRequestHeaders = context?.getRequestHeaders;
    if (!getRequestHeaders) {
        throw new Error('[ChatPlus2] getRequestHeaders not available');
    }

    const response = await fetch('/api/chats/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        cache: 'no-cache',
        body: JSON.stringify({
            avatar_url: avatar,
            file_name: String(fileName || '').replace(/\.jsonl$/, ''),
        }),
    });

    if (!response.ok) {
        throw new Error(`[ChatPlus2] readChatFile: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
        return { header: null, messages: [] };
    }

    // Index 0 is the chat header (user_name / character_name / chat_metadata),
    // not a message — detect by absence of message fields.
    const first = data[0];
    const isHeader = first && typeof first === 'object' && !('is_user' in first) && !('mes' in first);
    return isHeader
        ? { header: first, messages: data.slice(1) }
        : { header: null, messages: data };
}

/**
 * Append one or more messages to a character chat file on disk (read-latest →
 * append → save), preserving the existing header. Serialized per chatKey.
 *
 * NEVER call this for the currently-loaded active chat — that would desync
 * ST's in-memory `chat[]`. Callers must branch on "is this the active chat"
 * first (see sendHeadlessMessage / ChatTabsController).
 *
 * @param {string} avatar - Character avatar filename
 * @param {string} fileName - Chat filename (without .jsonl)
 * @param {string} characterName - Character display name (ch_name for save)
 * @param {Array<Object>} newMessages - Message objects to append
 * @returns {Promise<boolean>} True on success
 */
export async function appendToChatFile(avatar, fileName, characterName, newMessages) {
    if (!Array.isArray(newMessages) || newMessages.length === 0) return true;
    const cleanName = String(fileName || '').replace(/\.jsonl$/, '');
    const chatKey = `${avatar}:${cleanName}`;

    return withChatLock(chatKey, async () => {
        const context = getContext();
        const getRequestHeaders = context?.getRequestHeaders;
        if (!getRequestHeaders) {
            console.warn('[ChatPlus2] appendToChatFile: getRequestHeaders not available');
            return false;
        }

        // Read the freshest copy right before writing so we never clobber
        // messages added since the tab last rendered.
        let header, messages;
        try {
            ({ header, messages } = await readChatFile(avatar, cleanName));
        } catch (error) {
            console.error('[ChatPlus2] appendToChatFile: read failed:', error);
            return false;
        }

        // Synthesize a minimal header if the file was empty/headerless.
        const chatHeader = header || {
            user_name: context?.name1 || 'You',
            character_name: characterName,
            create_date: getMessageTimeStamp(),
            chat_metadata: {},
        };

        const combined = [...messages, ...newMessages];

        try {
            // force:true — we just read-latest under the lock, so the integrity
            // check (which guards against blind overwrites) is satisfied.
            const response = await fetch('/api/chats/save', {
                method: 'POST',
                headers: getRequestHeaders(),
                cache: 'no-cache',
                body: JSON.stringify({
                    ch_name: characterName,
                    file_name: cleanName,
                    chat: [chatHeader, ...combined],
                    avatar_url: avatar,
                    force: true,
                }),
            });
            if (!response.ok) {
                console.error(`[ChatPlus2] appendToChatFile: save HTTP ${response.status}`);
                return false;
            }
            return true;
        } catch (error) {
            console.error('[ChatPlus2] appendToChatFile: save failed:', error);
            return false;
        }
    });
}

/**
 * Build a SillyTavern message object suitable for writing to a .jsonl.
 * @param {Object} opts
 * @param {string} opts.name - Author name
 * @param {boolean} opts.isUser - User vs character message
 * @param {string} opts.mes - Message text
 * @param {Object} [opts.extra] - Extra metadata (api/model for AI messages)
 * @param {string} [opts.genStarted] - ISO start time (AI messages)
 * @param {string} [opts.genFinished] - ISO finish time (AI messages)
 * @returns {Object} ST message object
 */
export function buildChatMessage({ name, isUser, mes, extra = {}, genStarted, genFinished }) {
    const msg = {
        name,
        is_user: !!isUser,
        is_system: false,
        send_date: getMessageTimeStamp(),
        mes: String(mes ?? ''),
        extra,
    };
    if (genStarted) msg.gen_started = genStarted;
    if (genFinished) msg.gen_finished = genFinished;
    return msg;
}

/**
 * Build a lightweight lorebook/world-info block for a character (fast path).
 *
 * This is a deliberately SIMPLIFIED scanner — not ST's full WI engine. It
 * reads the character's primary embedded book (char.data.extensions.world),
 * includes constant entries plus keyword-matched keyed entries against the
 * provided recent text, and joins their content. It does NOT do recursion,
 * budgets, timed effects, secondary-key logic, or extra (charLore) books.
 * Full fidelity is what "Promote to full chat" is for.
 *
 * @param {string} avatar - Character avatar filename
 * @param {string} recentText - Recent conversation text to scan keys against
 * @returns {Promise<string>} Lore block (may be empty string)
 */
export async function getCharacterLoreBlock(avatar, recentText) {
    try {
        const context = getContext();
        const loadWorldInfo = context?.loadWorldInfo;
        if (typeof loadWorldInfo !== 'function') return '';

        const char = getCharacterByAvatar(avatar);
        const bookName = char?.data?.extensions?.world;
        if (!bookName) return '';

        const data = await loadWorldInfo(bookName);
        const entriesObj = data?.entries;
        if (!entriesObj || typeof entriesObj !== 'object') return '';

        const haystack = String(recentText || '').toLowerCase();
        const activated = [];

        for (const entry of Object.values(entriesObj)) {
            if (!entry || entry.disable === true) continue;
            const content = String(entry.content || '').trim();
            if (!content) continue;

            if (entry.constant === true) {
                activated.push(entry);
                continue;
            }

            const keys = Array.isArray(entry.key) ? entry.key : [];
            const hit = keys.some(k => {
                const term = String(k || '').trim().toLowerCase();
                return term && haystack.includes(term);
            });
            if (hit) activated.push(entry);
        }

        if (activated.length === 0) return '';

        activated.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        return activated.map(e => String(e.content).trim()).join('\n\n');
    } catch (error) {
        console.warn('[ChatPlus2] getCharacterLoreBlock failed:', error);
        return '';
    }
}

/**
 * Assemble the chat-completion `messages` array for a headless send: a system
 * message (character card + lore) followed by recent history and the new user
 * turn. Card macros ({{char}}/{{user}}) are substituted with the TARGET
 * character's name and the active persona name (not the active character).
 *
 * @param {Object} opts
 * @param {string} opts.avatar - Target character avatar
 * @param {Array<Object>} opts.history - Prior messages from the chat file
 * @param {string} opts.userText - New user message
 * @param {number} [opts.historyDepth=20] - How many prior messages to include
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
export async function assembleHeadlessMessages({ avatar, history, userText, historyDepth = 20 }) {
    const context = getContext();
    const char = getCharacterByAvatar(avatar);
    const charName = char?.name || 'Assistant';
    const userName = context?.name1 || 'You';

    const subst = (text) => String(text || '')
        .replace(/\{\{char\}\}/gi, charName)
        .replace(/<BOT>/gi, charName)
        .replace(/\{\{user\}\}/gi, userName)
        .replace(/<USER>/gi, userName);

    // ── System prompt: character card fields ──
    const cardParts = [];
    if (char) {
        if (char.data?.system_prompt) cardParts.push(subst(char.data.system_prompt));
        if (char.description) cardParts.push(subst(char.description));
        if (char.personality) cardParts.push(`${charName}'s personality: ${subst(char.personality)}`);
        if (char.scenario) cardParts.push(`Scenario: ${subst(char.scenario)}`);
        if (char.mes_example) cardParts.push(`Example dialogue:\n${subst(char.mes_example)}`);
    }

    // ── Lore block (simplified scanner) ──
    const recentText = [
        ...(Array.isArray(history) ? history.slice(-historyDepth).map(m => m?.mes || '') : []),
        userText || '',
    ].join('\n');
    const loreBlock = await getCharacterLoreBlock(avatar, recentText);
    if (loreBlock) cardParts.push(`Relevant world info:\n${loreBlock}`);

    const messages = [];
    if (cardParts.length > 0) {
        messages.push({ role: 'system', content: cardParts.join('\n\n') });
    }

    // ── Recent history ──
    const recent = Array.isArray(history) ? history.slice(-historyDepth) : [];
    for (const m of recent) {
        if (!m || typeof m.mes !== 'string') continue;
        if (m.is_system) continue;
        messages.push({ role: m.is_user ? 'user' : 'assistant', content: m.mes });
    }

    // ── New user turn ──
    messages.push({ role: 'user', content: String(userText || '') });
    return messages;
}

/**
 * Send a message into a (non-active) chat via a secondary connection profile,
 * WITHOUT switching the active character/chat. Persists both the user message
 * and the AI reply to the target chat's .jsonl.
 *
 * Sequence:
 *   1. Append the user message to the file immediately (persists even if gen fails).
 *   2. Assemble prompt (card + lore + recent history + user turn).
 *   3. ConnectionManagerRequestService.sendRequest with the bound profile.
 *   4. Append the AI reply to the file.
 *
 * @param {Object} opts
 * @param {string} opts.avatar - Target character avatar
 * @param {string} opts.fileName - Target chat filename (without .jsonl)
 * @param {string} opts.profileId - Connection profile id to generate with
 * @param {string} opts.text - User message text
 * @param {boolean} [opts.stream=false] - Stream the reply
 * @param {AbortSignal} [opts.signal] - Abort signal
 * @param {(partial: string) => void} [opts.onChunk] - Streaming progress callback
 * @param {number} [opts.maxTokens] - Max response tokens
 * @returns {Promise<{ userMessage: Object, aiMessage: Object }>}
 */
export async function sendHeadlessMessage({ avatar, fileName, profileId, text, stream = false, signal, onChunk, maxTokens = 1024 }) {
    const context = getContext();
    const service = context?.ConnectionManagerRequestService;
    if (!service || typeof service.sendRequest !== 'function') {
        throw new Error('Connection Manager is not available. Enable the Connection Manager extension to send through a profile.');
    }
    if (!profileId) {
        throw new Error('No connection profile is bound to this tab.');
    }

    const char = getCharacterByAvatar(avatar);
    const charName = char?.name || 'Assistant';
    const userName = context?.name1 || 'You';
    const cleanFile = String(fileName || '').replace(/\.jsonl$/, '');

    // 1. Read current history + persist the user turn up front.
    const { messages: history } = await readChatFile(avatar, cleanFile);
    const userMessage = buildChatMessage({ name: userName, isUser: true, mes: text });
    await appendToChatFile(avatar, cleanFile, charName, [userMessage]);

    // 2. Assemble the prompt from the freshly-read history (excludes the turn
    //    we just appended, which we add explicitly as userText).
    const promptMessages = await assembleHeadlessMessages({ avatar, history, userText: text });

    // 3. Generate via the bound profile.
    const genStarted = new Date().toISOString();
    const profile = getProfileById(profileId);
    let replyText = '';

    if (stream) {
        const factory = await service.sendRequest(profileId, promptMessages, maxTokens, {
            stream: true,
            signal,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
        });
        const generator = typeof factory === 'function' ? factory() : factory;
        for await (const value of generator) {
            if (signal?.aborted) break;
            // With extractData:true each value carries cumulative text.
            const t = (value && (value.text ?? value.content)) ?? '';
            if (typeof t === 'string' && t.length) {
                replyText = t;
                onChunk?.(replyText);
            }
        }
    } else {
        const result = await service.sendRequest(profileId, promptMessages, maxTokens, {
            stream: false,
            signal,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
        });
        replyText = (result && (result.content ?? result.text)) || '';
    }

    const genFinished = new Date().toISOString();

    // 4. Persist the AI reply.
    const aiMessage = buildChatMessage({
        name: charName,
        isUser: false,
        mes: replyText,
        extra: { api: profile?.api || '', model: profile?.model || '' },
        genStarted,
        genFinished,
    });
    await appendToChatFile(avatar, cleanFile, charName, [aiMessage]);

    return { userMessage, aiMessage };
}

// ========================================
// UI OPERATIONS
// ========================================

// ─── Loading overlay (step 43g) ───────────────────────────────────────────
// Scoped to `#chatplus-loading-overlay` inside `.chatplus-tab-panels`. The
// overlay covers only the Recent/Folders tab content area — never ST's
// native DOM (which is the point: users can still use the Characters list,
// top bar, chat area, etc. while one of our long operations is in flight).
//
// Reference-counted so nested / overlapping callers don't race: each
// show() increments, each hide() decrements, and the overlay only
// becomes visible once (after a 150 ms delay) and only disappears when
// the counter hits zero.
const LOADING_OVERLAY_DELAY_MS = 150;
let _overlayRefcount = 0;
let _overlayShowTimer = null;
let _overlayVisible = false;

function _getOverlayEl() {
    return document.getElementById('chatplus-loading-overlay');
}

/**
 * Show the ChatPlus loading overlay (delayed by 150 ms so fast operations
 * don't flash). Idempotent / reference-counted — each call must be
 * balanced by a matching `hideLoadingOverlay()`.
 *
 * @param {string} [label='Loading…']
 */
export function showLoadingOverlay(label = 'Loading…') {
    _overlayRefcount++;
    const overlay = _getOverlayEl();
    if (!overlay) return;

    // Always reflect the latest label, even if the overlay is already up.
    const labelEl = overlay.querySelector('.chatplus-loading-overlay-label');
    if (labelEl) labelEl.textContent = label;

    if (_overlayVisible || _overlayShowTimer) return;

    _overlayShowTimer = setTimeout(() => {
        _overlayShowTimer = null;
        if (_overlayRefcount <= 0) return;
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        _overlayVisible = true;
    }, LOADING_OVERLAY_DELAY_MS);
}

/**
 * Decrement the overlay refcount. Hides the overlay and cancels any
 * pending show timer when the counter reaches zero.
 */
export function hideLoadingOverlay() {
    _overlayRefcount = Math.max(0, _overlayRefcount - 1);
    if (_overlayRefcount > 0) return;

    if (_overlayShowTimer) {
        clearTimeout(_overlayShowTimer);
        _overlayShowTimer = null;
    }
    const overlay = _getOverlayEl();
    if (overlay) {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
    }
    _overlayVisible = false;
}

/**
 * Run an async operation with the loading overlay visible for its
 * duration. Ensures the overlay is always hidden on the return path,
 * even when the operation throws.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string}           [label]
 * @returns {Promise<T>}
 */
export async function withLoadingOverlay(fn, label = 'Loading…') {
    showLoadingOverlay(label);
    try {
        return await fn();
    } finally {
        hideLoadingOverlay();
    }
}

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
 *
 * Uses ST's `Popup.show.confirm(header, text, options)` helper, which renders
 * the `text` argument as HTML (it's assigned via `innerHTML` inside the popup
 * implementation). Callers passing rich content **must** escape any
 * user-controlled substrings with `escapeHtml()` first to prevent injection.
 *
 * @param {string} message - Confirmation message (HTML allowed)
 * @param {string} title - Dialog title (optional)
 * @returns {Promise<boolean>} True if confirmed, false if cancelled
 */
export async function showConfirmation(message, title = 'Confirm') {
    const Popup = getContext()?.Popup;
    if (Popup?.show?.confirm) {
        try {
            const result = await Popup.show.confirm(title, message);
            // POPUP_RESULT.AFFIRMATIVE === 1; cancel/null/0 means "no"
            return result === 1 || result === true;
        } catch (err) {
            console.error('[ChatPlus2] showConfirmation popup failed, falling back to native confirm:', err);
        }
    }

    // Fallback to native confirm — strips HTML so the dialog stays readable
    const stripped = String(message).replace(/<[^>]+>/g, '');
    return confirm(stripped);
}

/**
 * Show input dialog
 *
 * Uses ST's `Popup.show.input(header, text, defaultValue, options)` helper.
 * `text` is rendered as HTML; escape user-controlled substrings via
 * `escapeHtml()` before passing.
 *
 * @param {string} message - Prompt message (HTML allowed)
 * @param {string} defaultValue - Default input value
 * @param {string} title - Dialog title (optional)
 * @returns {Promise<string|null>} Input value or null if cancelled
 */
export async function showInput(message, defaultValue = '', title = 'Input') {
    const Popup = getContext()?.Popup;
    if (Popup?.show?.input) {
        try {
            const result = await Popup.show.input(title, message, defaultValue);
            // Helper returns string on confirm (including ''), null on cancel.
            return result === undefined ? null : result;
        } catch (err) {
            console.error('[ChatPlus2] showInput popup failed, falling back to native prompt:', err);
        }
    }

    // Fallback to native prompt
    const stripped = String(message).replace(/<[^>]+>/g, '');
    return prompt(stripped, defaultValue);
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
    getLostAndFound,

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
    fetchChatMessages,
    renameChat,
    deleteChat,
    deleteChats,

    // Connection profiles + headless messaging
    getConnectionProfiles,
    getActiveProfileId,
    getProfileById,
    isHeadlessSendAvailable,
    getMessageTimeStamp,
    formatMessageHtml,
    buildChatMessageElement,
    installChatStyleAlias,
    withChatLock,
    readChatFile,
    appendToChatFile,
    buildChatMessage,
    getCharacterLoreBlock,
    assembleHeadlessMessages,
    sendHeadlessMessage,

    // UI
    showToast,
    updateUI,
    showConfirmation,
    showInput,
    showLoadingOverlay,
    hideLoadingOverlay,
    withLoadingOverlay,

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
