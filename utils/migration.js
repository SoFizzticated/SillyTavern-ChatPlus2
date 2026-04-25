/**
 * MigrationHelper — Non-destructive migration from ChatPlus v1 to v2.
 *
 * V1 stores chat references using characterId-based keys (array index for
 * characters, group.id for groups).  V2 uses avatar-based keys
 * (`avatar:filename`).  This module converts v1 data structures to v2
 * format, merges them into existing v2 state without overwriting, and
 * routes any unresolvable references into the Lost & Found pipeline.
 *
 * Non-destructive guarantees:
 * - v1 settings (`extensionSettings.chatsPlus`) are never modified or deleted
 * - A timestamped backup is stored at `extensionSettings.chatsPlusV1Backup`
 * - Existing v2 data is merged (union), never overwritten
 *
 * @module MigrationHelper
 */

import * as CoreAPI from '../modules/core-api.js';

export default class MigrationHelper {
    /**
     * @param {import('../modules/state-manager.js').default} stateManager
     */
    constructor(stateManager) {
        this.stateManager = stateManager;
    }

    // ─────────────────────────────────────────
    // PUBLIC
    // ─────────────────────────────────────────

    /**
     * Run the full v1 → v2 migration pipeline.
     *
     * @returns {Promise<MigrationSummary>} Summary of what was migrated
     * @throws {Error} If v1 settings are not detected or backup fails
     *
     * @typedef {Object} MigrationSummary
     * @property {number}  totalPins           - v1 pins found
     * @property {number}  convertedPins       - Pins successfully converted to v2 keys
     * @property {number}  totalFolderKeys     - v1 chatFolder entries found
     * @property {number}  convertedFolderKeys - chatFolder entries converted
     * @property {number}  totalFolders        - v1 folders found
     * @property {number}  upgradedFolders     - Folders added to v2 (deduplicated)
     * @property {Array}   unmappedPins        - Pins that couldn't be resolved
     * @property {Array}   unmappedFolderKeys  - chatFolder entries that couldn't be resolved
     * @property {boolean} hasUnmapped         - True if any references couldn't be resolved
     */
    async migrate() {
        // ── Pre-checks ───────────────────────────
        if (!this.stateManager.detectV1Settings()) {
            throw new Error('No v1 settings detected or migration already completed');
        }

        // ── Backup ───────────────────────────────
        const backedUp = this.stateManager.backupV1Settings();
        if (!backedUp) {
            throw new Error('Failed to back up v1 settings — aborting migration');
        }
        console.debug('[ChatPlus2][Migration] v1 settings backed up');

        // ── Read v1 data ─────────────────────────
        const v1 = this.stateManager.getV1Settings();
        if (!v1) {
            throw new Error('Could not read v1 settings after backup');
        }

        const v1Pins = Array.isArray(v1.pinnedChats) ? v1.pinnedChats : [];
        const v1ChatFolders = (v1.chatFolders && typeof v1.chatFolders === 'object') ? v1.chatFolders : {};
        const v1Folders = Array.isArray(v1.folders) ? v1.folders : [];

        console.debug('[ChatPlus2][Migration] v1 data: %d pins, %d chatFolder keys, %d folders',
            v1Pins.length, Object.keys(v1ChatFolders).length, v1Folders.length);

        // ── Early exit if v1 is empty ────────────
        if (v1Pins.length === 0 && Object.keys(v1ChatFolders).length === 0 && v1Folders.length === 0) {
            this.stateManager.markMigrationCompleted(true);
            return {
                totalPins: 0, convertedPins: 0,
                totalFolderKeys: 0, convertedFolderKeys: 0,
                totalFolders: 0, upgradedFolders: 0,
                unmappedPins: [], unmappedFolderKeys: [],
                hasUnmapped: false,
            };
        }

        // ── Build lookup map ─────────────────────
        const idMap = this._buildCharacterIdToAvatarMap();
        console.debug('[ChatPlus2][Migration] ID→avatar map built: %d entries', idMap.size);

        // ── Convert each data type ───────────────
        const pinResult = this._convertPinnedChats(v1Pins, idMap);
        const folderResult = this._convertChatFolders(v1ChatFolders, idMap);
        const upgradedFolders = this._upgradeFolders(v1Folders);

        // ── Merge into v2 state (non-destructive) ──

        // 1. Pins — deduplicated union
        const existingPins = this.stateManager.get('pinnedChats') || [];
        const allConvertedPins = [...pinResult.converted];

        // Plant unmapped pins as synthetic keys so Lost & Found can detect them
        for (const um of pinResult.unmapped) {
            const syntheticKey = `${um.characterId}:${um.file_name}`;
            allConvertedPins.push(syntheticKey);
        }

        const mergedPins = [...new Set([...existingPins, ...allConvertedPins])];
        this.stateManager.set('pinnedChats', mergedPins, false);

        // 2. ChatFolders — merge converted + synthetic keys
        const existingChatFolders = this.stateManager.get('chatFolders') || {};
        const mergedChatFolders = { ...existingChatFolders };

        for (const [v2Key, folderIds] of Object.entries(folderResult.converted)) {
            if (mergedChatFolders[v2Key]) {
                // Union folder IDs
                const existingIds = mergedChatFolders[v2Key];
                mergedChatFolders[v2Key] = [...new Set([...existingIds, ...folderIds])];
            } else {
                mergedChatFolders[v2Key] = [...folderIds];
            }
        }

        // Plant unmapped chatFolder entries as synthetic keys
        for (const um of folderResult.unmapped) {
            const syntheticKey = `${um.characterId}:${um.file_name}`;
            if (mergedChatFolders[syntheticKey]) {
                mergedChatFolders[syntheticKey] = [...new Set([...mergedChatFolders[syntheticKey], ...um.folderIds])];
            } else {
                mergedChatFolders[syntheticKey] = [...um.folderIds];
            }
        }

        this.stateManager.set('chatFolders', mergedChatFolders, false);

        // 3. Folders — append ones that don't already exist by ID
        const existingFolders = this.stateManager.get('folders') || [];
        const existingFolderIds = new Set(existingFolders.map(f => f.id));
        let addedFolderCount = 0;

        for (const folder of upgradedFolders) {
            if (!existingFolderIds.has(folder.id)) {
                existingFolders.push(folder);
                existingFolderIds.add(folder.id);
                addedFolderCount++;
            }
        }

        this.stateManager.set('folders', existingFolders, false);

        // 4. Validate chatFolder references — strip folder IDs that don't exist
        //    (covers edge case where v1 folders were partially deleted)
        const allFolderIds = new Set(existingFolders.map(f => f.id));
        for (const [key, ids] of Object.entries(mergedChatFolders)) {
            const validIds = ids.filter(id => allFolderIds.has(id));
            if (validIds.length === 0) {
                delete mergedChatFolders[key];
            } else if (validIds.length !== ids.length) {
                mergedChatFolders[key] = validIds;
            }
        }
        // Re-set chatFolders after validation (overwrite the earlier set)
        this.stateManager.set('chatFolders', mergedChatFolders, false);

        // 5. Transfer defaultTab only if v2 is still at its default
        if (v1.defaultTab && this.stateManager.get('defaultTab') === 'recent') {
            this.stateManager.set('defaultTab', v1.defaultTab, false);
        }

        // ── Finalize ─────────────────────────────
        this.stateManager.markMigrationCompleted(true);
        await this.stateManager.save(true);

        const summary = {
            totalPins: v1Pins.length,
            convertedPins: pinResult.converted.length,
            totalFolderKeys: Object.keys(v1ChatFolders).length,
            convertedFolderKeys: Object.keys(folderResult.converted).length,
            totalFolders: v1Folders.length,
            upgradedFolders: addedFolderCount,
            unmappedPins: pinResult.unmapped,
            unmappedFolderKeys: folderResult.unmapped,
            hasUnmapped: pinResult.unmapped.length > 0 || folderResult.unmapped.length > 0,
        };

        console.debug('[ChatPlus2][Migration] Complete:', summary);
        return summary;
    }

    // ─────────────────────────────────────────
    // PRIVATE — Key conversion
    // ─────────────────────────────────────────

    /**
     * Build a lookup map from v1 characterId → { avatar, name, isGroup }.
     *
     * For characters: v1 used the array index (from Object.entries) as the key,
     * so the characterId is a numeric string like "0", "1", etc.
     *
     * For groups: v1 used group.id directly.
     *
     * @private
     * @returns {Map<string, { avatar: string, name: string, isGroup: boolean }>}
     */
    _buildCharacterIdToAvatarMap() {
        const context = CoreAPI.getContext();
        const map = new Map();

        // ── Characters ───────────────────────────
        const characters = context?.characters || [];
        if (Array.isArray(characters)) {
            for (const [index, char] of Object.entries(characters)) {
                if (char && char.avatar) {
                    map.set(String(index), {
                        avatar: char.avatar,
                        name: char.name || '',
                        isGroup: false,
                    });
                }
            }
        }

        // ── Groups ───────────────────────────────
        const groups = CoreAPI.getAllGroups() || [];
        for (const group of groups) {
            if (group && group.id) {
                const avatar = group.avatar_url || group.avatar || group.id;
                map.set(String(group.id), {
                    avatar: avatar,
                    name: group.name || '',
                    isGroup: true,
                });
            }
        }

        return map;
    }

    /**
     * Convert v1 pinnedChats to v2 chat-key strings.
     *
     * @private
     * @param {Array<{ characterId: string|number, file_name: string }>} v1Pins
     * @param {Map<string, { avatar: string }>} idMap
     * @returns {{ converted: string[], unmapped: Array<{ characterId: string, file_name: string }> }}
     */
    _convertPinnedChats(v1Pins, idMap) {
        const converted = [];
        const unmapped = [];

        for (const pin of v1Pins) {
            if (!pin || pin.file_name == null) continue;

            const charId = String(pin.characterId);
            const fileName = String(pin.file_name).replace('.jsonl', '');
            const entry = idMap.get(charId);

            if (entry) {
                converted.push(`${entry.avatar}:${fileName}`);
            } else {
                unmapped.push({ characterId: charId, file_name: fileName });
                console.debug('[ChatPlus2][Migration] Unmapped pin: characterId=%s file=%s', charId, fileName);
            }
        }

        return { converted, unmapped };
    }

    /**
     * Convert v1 chatFolders mapping to v2 avatar-based keys.
     *
     * @private
     * @param {Object<string, string[]>} v1ChatFolders - { "characterId:filename": [folderIds] }
     * @param {Map<string, { avatar: string }>} idMap
     * @returns {{ converted: Object<string, string[]>, unmapped: Array<{ characterId: string, file_name: string, folderIds: string[] }> }}
     */
    _convertChatFolders(v1ChatFolders, idMap) {
        const converted = {};
        const unmapped = [];

        for (const [v1Key, folderIds] of Object.entries(v1ChatFolders)) {
            if (!Array.isArray(folderIds) || folderIds.length === 0) continue;

            // Split on first colon only — characterId may not contain colons,
            // but filenames theoretically could (though unlikely).
            const colonIdx = v1Key.indexOf(':');
            if (colonIdx === -1) {
                console.warn('[ChatPlus2][Migration] Malformed chatFolders key (no colon): %s', v1Key);
                continue;
            }

            const charId = v1Key.substring(0, colonIdx);
            const fileName = v1Key.substring(colonIdx + 1).replace('.jsonl', '');
            const entry = idMap.get(charId);

            if (entry) {
                const v2Key = `${entry.avatar}:${fileName}`;
                if (converted[v2Key]) {
                    // Union folder IDs if same chat appeared under multiple keys
                    converted[v2Key] = [...new Set([...converted[v2Key], ...folderIds])];
                } else {
                    converted[v2Key] = [...folderIds];
                }
            } else {
                unmapped.push({ characterId: charId, file_name: fileName, folderIds: [...folderIds] });
                console.debug('[ChatPlus2][Migration] Unmapped chatFolder: characterId=%s file=%s', charId, fileName);
            }
        }

        return { converted, unmapped };
    }

    // ─────────────────────────────────────────
    // PRIVATE — Folder schema upgrade
    // ─────────────────────────────────────────

    /**
     * Upgrade v1 folders to v2 schema (adds children[], created, modified).
     *
     * @private
     * @param {Array<{ id: string, name: string, parent: string|null }>} v1Folders
     * @returns {Array<{ id: string, name: string, parent: string|null, children: string[], created: number, modified: number }>}
     */
    _upgradeFolders(v1Folders) {
        const now = Date.now();

        // First pass: create upgraded folder objects
        const upgraded = v1Folders
            .filter(f => f && f.id && f.name)
            .map(f => ({
                id: f.id,
                name: f.name,
                parent: f.parent || null,
                children: [],         // Will be populated in second pass
                created: now,         // Original timestamp unknown
                modified: now,
            }));

        // Build ID set for parent validation
        const idSet = new Set(upgraded.map(f => f.id));

        // Second pass: populate children arrays from parent references
        for (const folder of upgraded) {
            if (folder.parent && !idSet.has(folder.parent)) {
                // Parent doesn't exist in the set — orphan it to root
                console.debug('[ChatPlus2][Migration] Folder "%s" has invalid parent %s, moving to root', folder.name, folder.parent);
                folder.parent = null;
            }
        }

        for (const folder of upgraded) {
            if (folder.parent) {
                const parent = upgraded.find(f => f.id === folder.parent);
                if (parent && !parent.children.includes(folder.id)) {
                    parent.children.push(folder.id);
                }
            }
        }

        return upgraded;
    }
}
