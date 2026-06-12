/**
 * StateManager - Central state management for ChatPlus2
 *
 * Manages all extension settings and state persistence.
 * Handles loading, saving, and migration from v1 settings.
 *
 * @module StateManager
 */

import * as CoreAPI from './core-api.js';

export class StateManager {
    /**
     * Default settings schema for ChatPlus2
     * @type {Object}
     */
    static DEFAULT_SETTINGS = {
        pinnedChats: [],           // Array of chat keys (avatar:filename format)
        folders: [],               // Array of folder objects: {id, name, parent, children}
        chatFolders: {},           // Map of chatKey -> array of folderIds
        defaultTab: 'recent',      // Default active tab: 'characters', 'recent', or 'folders'
        enabled: true,             // Extension enabled/disabled state
        pageSize: 100,             // Number of chats per page (25, 50, 100, or 200)
        recentListGroupByCharacter: false, // Recent tab: group rows under per-character separators (hides the "CharName: " prefix on each row)
        expandedFolders: [],       // Array of folder IDs that are currently expanded
        lastMigrationCheck: null,  // Timestamp of last v1 migration check
        migrationCompleted: false, // Whether v1 migration has been completed
        _lastRanVersion: null,     // Last extension version that ran onInstall/onUpdate (set by lifecycle hooks in index.js)

        // Multi-profile chat tabs (see chat-tabs-controller.js).
        //   open: ordered array of SECONDARY (headless) tab objects
        //     { chatKey, avatar, fileName, characterName, profileId, lastActiveAt }
        //   selectedKey: '__main__' (the live ST chat) or a secondary chatKey
        chatTabs: { open: [], selectedKey: '__main__' },

        // Workshops — named snapshots of the secondary-tab set (see workshops-controller.js).
        //   workshops: [{ id, name, tabs: [tabObj…], createdAt, updatedAt }]
        //   restoreSession: single auto-stash slot for the tab set replaced by the
        //     last workshop open/close — { tabs: [tabObj…], stashedAt } or null.
        workshops: [],
        restoreSession: null,

        // Chat-tabs feature toggles (Extensions → ChatPlus 2 settings).
        tabsEnabled: true,         // master on/off for the whole chat-tabs feature
        tabsNativeStyling: true    // clone native .mes + #chat style alias (off = simple bubbles)
    };

    constructor() {
        this.settings = null;
        this.saveTimeout = null;
        this.SAVE_DEBOUNCE_MS = 500; // Debounce save operations
    }

    /**
     * Load settings from SillyTavern's extension settings
     * Initializes with defaults if no settings exist
     *
     * @returns {Object} The loaded settings
     */
    load() {
        try {
            // Access SillyTavern's extension settings via CoreAPI
            const extensionSettings = CoreAPI.getExtensionSettings();

            if (!extensionSettings) {
                console.warn('[ChatPlus2] Extension settings not available, using defaults');
                this.settings = { ...StateManager.DEFAULT_SETTINGS };
                return this.settings;
            }

            // Initialize chatPlus2 settings if they don't exist
            if (!extensionSettings.chatPlus2) {
                extensionSettings.chatPlus2 = { ...StateManager.DEFAULT_SETTINGS };
            }

            // Merge with defaults to ensure all keys exist (for version upgrades)
            this.settings = {
                ...StateManager.DEFAULT_SETTINGS,
                ...extensionSettings.chatPlus2
            };

            // Validate settings structure
            if (!Array.isArray(this.settings.pinnedChats)) {
                console.warn('[ChatPlus2] Invalid pinnedChats, resetting to empty array');
                this.settings.pinnedChats = [];
            }
            if (!Array.isArray(this.settings.folders)) {
                console.warn('[ChatPlus2] Invalid folders, resetting to empty array');
                this.settings.folders = [];
            }
            if (typeof this.settings.chatFolders !== 'object' || this.settings.chatFolders === null) {
                console.warn('[ChatPlus2] Invalid chatFolders, resetting to empty object');
                this.settings.chatFolders = {};
            }
            // chatTabs may be missing (pre-feature settings) or malformed.
            if (typeof this.settings.chatTabs !== 'object' || this.settings.chatTabs === null) {
                this.settings.chatTabs = { open: [], selectedKey: '__main__' };
            }
            if (!Array.isArray(this.settings.chatTabs.open)) {
                console.warn('[ChatPlus2] Invalid chatTabs.open, resetting to empty array');
                this.settings.chatTabs.open = [];
            }
            if (typeof this.settings.chatTabs.selectedKey !== 'string') {
                this.settings.chatTabs.selectedKey = '__main__';
            }
            // Workshops may be missing (pre-feature settings) or malformed.
            if (!Array.isArray(this.settings.workshops)) {
                this.settings.workshops = [];
            } else {
                this.settings.workshops = this.settings.workshops.filter(
                    w => w && typeof w === 'object' && typeof w.id === 'string' && Array.isArray(w.tabs)
                );
            }
            if (this.settings.restoreSession !== null
                && (typeof this.settings.restoreSession !== 'object'
                    || !Array.isArray(this.settings.restoreSession?.tabs))) {
                this.settings.restoreSession = null;
            }

            // Store reference back to extension settings for saving
            this.extensionSettings = extensionSettings;

            console.debug('[ChatPlus2] Settings loaded:', this.settings);
            return this.settings;
        } catch (error) {
            console.error('[ChatPlus2] Error loading settings:', error);
            this.settings = { ...StateManager.DEFAULT_SETTINGS };
            return this.settings;
        }
    }

    /**
     * Save settings to SillyTavern's extension settings
     * Uses debouncing to prevent excessive writes
     *
     * @param {boolean} immediate - If true, save immediately without debouncing
     * @returns {Promise<void>}
     */
    async save(immediate = false) {
        if (!this.settings) {
            console.warn('[ChatPlus2] Cannot save: settings not initialized');
            return;
        }

        // Clear existing timeout if debouncing
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }

        const performSave = async () => {
            try {
                // Update the extension settings object
                if (this.extensionSettings) {
                    this.extensionSettings.chatPlus2 = { ...this.settings };
                }

                // Call SillyTavern's save function via CoreAPI
                await CoreAPI.saveSettings();
                console.debug('[ChatPlus2] Settings saved');
            } catch (error) {
                console.error('[ChatPlus2] Error saving settings:', error);
            }
        };

        if (immediate) {
            await performSave();
        } else {
            // Debounce the save operation
            this.saveTimeout = setTimeout(performSave, this.SAVE_DEBOUNCE_MS);
        }
    }

    /**
     * Get a setting value by key
     *
     * @param {string} key - The setting key
     * @returns {*} The setting value, or undefined if not found
     */
    get(key) {
        if (!this.settings) {
            console.warn('[ChatPlus2] Settings not loaded, call load() first');
            return undefined;
        }
        return this.settings[key];
    }

    /**
     * Set a setting value by key and trigger save
     *
     * @param {string} key - The setting key
     * @param {*} value - The value to set
     * @param {boolean} immediate - If true, save immediately
     * @returns {void}
     */
    set(key, value, immediate = false) {
        if (!this.settings) {
            console.warn('[ChatPlus2] Settings not loaded, call load() first');
            return;
        }

        this.settings[key] = value;
        this.save(immediate);
    }

    /**
     * Get all settings
     *
     * @returns {Object} Complete settings object
     */
    getAll() {
        return this.settings ? { ...this.settings } : null;
    }

    /**
     * Reset settings to defaults
     *
     * @param {boolean} immediate - If true, save immediately
     * @returns {void}
     */
    reset(immediate = true) {
        this.settings = { ...StateManager.DEFAULT_SETTINGS };
        this.save(immediate);
        console.debug('[ChatPlus2] Settings reset to defaults');
    }

    /**
     * Registered data migrations, ordered oldest → newest.
     * Each entry: { from: string, to: string, run: async (settings) => boolean | void }
     * The `run` callback mutates `settings` in place and returns a truthy value
     * if anything changed (so the caller can count how many actually mutated state).
     *
     * Empty by default — populate as the settings schema evolves between versions.
     *
     * @type {Array<{from: string, to: string, run: (settings: Object) => (Promise<boolean|void>|boolean|void)}>}
     */
    static MIGRATIONS = [
        // Example (keep commented until a real migration is needed):
        // {
        //     from: '2.0.0',
        //     to: '2.1.0',
        //     run: async (settings) => {
        //         if (!('newField' in settings)) {
        //             settings.newField = 'default';
        //             return true;
        //         }
        //         return false;
        //     }
        // }
    ];

    /**
     * Run any registered data migrations whose `from` version matches
     * `fromVersion` (chained — the output `to` feeds into the next entry's `from`).
     * Called by `onUpdate()` in index.js after a successful extension update.
     *
     * Idempotent: safe to re-run. If `fromVersion` doesn't match any entry,
     * returns `null` (no work to do).
     *
     * @param {string|null} fromVersion - The version stamped on previous run
     * @param {string} toVersion - The current extension version
     * @returns {Promise<{migrationsRun: number, notes: string[]}|null>}
     */
    async runMigrations(fromVersion, toVersion) {
        if (!this.settings) {
            console.warn('[ChatPlus2] runMigrations: settings not loaded, skipping');
            return null;
        }
        if (!StateManager.MIGRATIONS || StateManager.MIGRATIONS.length === 0) {
            console.debug(`[ChatPlus2] runMigrations(${fromVersion} → ${toVersion}) — nothing registered`);
            return null;
        }

        const notes = [];
        let migrationsRun = 0;
        let cursor = fromVersion;

        // Chain through matching entries. Stops when no entry starts at `cursor` or we reach `toVersion`.
        let safetyCounter = 0;
        while (cursor !== toVersion && safetyCounter++ < StateManager.MIGRATIONS.length + 1) {
            const entry = StateManager.MIGRATIONS.find(m => m.from === cursor);
            if (!entry) break;
            try {
                const changed = await entry.run(this.settings);
                if (changed) {
                    migrationsRun++;
                    notes.push(`${entry.from} → ${entry.to}`);
                } else {
                    notes.push(`${entry.from} → ${entry.to} (no-op)`);
                }
                cursor = entry.to;
            } catch (err) {
                console.error(`[ChatPlus2] Migration ${entry.from} → ${entry.to} failed:`, err);
                notes.push(`${entry.from} → ${entry.to} (error: ${err.message})`);
                break;
            }
        }

        if (migrationsRun > 0) {
            await this.save(true);
            console.log(`[ChatPlus2] runMigrations: ${migrationsRun} migration(s) applied`, notes);
        } else {
            console.debug(`[ChatPlus2] runMigrations: no applicable migrations for ${fromVersion} → ${toVersion}`);
        }

        return { migrationsRun, notes };
    }

    /**
     * Check if v1 settings exist and need migration
     *
     * @returns {boolean} True if v1 settings exist and migration hasn't been completed
     */
    detectV1Settings() {
        try {
            const extensionSettings = window.SillyTavern?.getContext()?.extensionSettings;

            if (!extensionSettings) {
                return false;
            }

            // Check if v1 settings exist
            const hasV1Settings = extensionSettings.chatsPlus !== undefined;

            // Check if migration already completed
            const migrationCompleted = this.get('migrationCompleted') === true;

            return hasV1Settings && !migrationCompleted;
        } catch (error) {
            console.error('[ChatPlus2] Error detecting v1 settings:', error);
            return false;
        }
    }

    /**
     * Get v1 settings for migration
     *
     * @returns {Object|null} v1 settings object or null if not found
     */
    getV1Settings() {
        try {
            const extensionSettings = window.SillyTavern?.getContext()?.extensionSettings;
            return extensionSettings?.chatsPlus || null;
        } catch (error) {
            console.error('[ChatPlus2] Error getting v1 settings:', error);
            return null;
        }
    }

    /**
     * Mark migration as completed
     *
     * @param {boolean} immediate - If true, save immediately
     * @returns {void}
     */
    markMigrationCompleted(immediate = true) {
        this.set('migrationCompleted', true, immediate);
        this.set('lastMigrationCheck', Date.now(), immediate);
        console.debug('[ChatPlus2] Migration marked as completed');
    }

    /**
     * Create backup of v1 settings before migration
     *
     * @returns {boolean} True if backup was created successfully
     */
    backupV1Settings() {
        try {
            const extensionSettings = window.SillyTavern?.getContext()?.extensionSettings;

            if (!extensionSettings || !extensionSettings.chatsPlus) {
                return false;
            }

            // Create backup
            extensionSettings.chatsPlusV1Backup = {
                ...extensionSettings.chatsPlus,
                backupDate: Date.now()
            };

            console.debug('[ChatPlus2] v1 settings backed up');
            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error backing up v1 settings:', error);
            return false;
        }
    }

    /**
     * Export settings as JSON string (for user backup)
     *
     * @returns {string} JSON string of current settings
     */
    exportSettings() {
        if (!this.settings) {
            return JSON.stringify(StateManager.DEFAULT_SETTINGS, null, 2);
        }
        return JSON.stringify(this.settings, null, 2);
    }

    /**
     * Import settings from JSON string (for user restore)
     *
     * @param {string} jsonString - JSON string containing settings
     * @param {boolean} immediate - If true, save immediately
     * @returns {boolean} True if import was successful
     */
    importSettings(jsonString, immediate = true) {
        try {
            const importedSettings = JSON.parse(jsonString);

            // Validate that it has expected structure
            if (typeof importedSettings !== 'object') {
                throw new Error('Invalid settings format');
            }

            // Merge with defaults to ensure all keys exist
            this.settings = {
                ...StateManager.DEFAULT_SETTINGS,
                ...importedSettings
            };

            this.save(immediate);
            console.debug('[ChatPlus2] Settings imported successfully');
            return true;
        } catch (error) {
            console.error('[ChatPlus2] Error importing settings:', error);
            return false;
        }
    }
}

export default StateManager;
