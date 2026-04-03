/**
 * ChatPlus 2 - Enhanced Chat Management Extension
 * Entry point for the extension
 */

const MODULE_NAME = 'ChatPlus2';
const EXTENSION_FOLDER = 'third-party/SillyTavern-ChatPlus2';
const SETTINGS_KEY = 'chatPlus2';

// Extension state
let isInitialized = false;

/** @type {import('./app/chatplus.js').ChatPlusCoordinator|null} */
let coordinatorRef = null;

// ─────────────────────────────────────────
// SETTINGS HELPERS (work without coordinator)
// ─────────────────────────────────────────

/**
 * Get settings directly from SillyTavern context.
 * Works even when the coordinator/StateManager are not loaded.
 */
function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx?.extensionSettings) return null;
    if (!ctx.extensionSettings[SETTINGS_KEY]) {
        ctx.extensionSettings[SETTINGS_KEY] = {
            pinnedChats: [],
            folders: [],
            chatFolders: {},
            defaultTab: 'recent',
            enabled: true,
            lastMigrationCheck: null,
            migrationCompleted: false,
        };
    }
    return ctx.extensionSettings[SETTINGS_KEY];
}

/**
 * Save settings via SillyTavern's debounced save.
 */
function saveSettings() {
    SillyTavern.getContext()?.saveSettingsDebounced?.();
}

/**
 * Check whether the extension is enabled in persisted settings.
 * Returns true when not yet configured (first launch = enabled by default).
 * Only explicit `false` disables the extension.
 */
function isExtensionEnabled() {
    const settings = getSettings();
    return settings?.enabled !== false;
}

/**
 * Load HTML template from file
 * @returns {Promise<string|null>} Raw HTML string or null on failure
 */
async function loadHTMLTemplate() {
    try {
        const response = await fetch(`/scripts/extensions/${EXTENSION_FOLDER}/app/chatplus.html`);
        if (!response.ok) {
            throw new Error(`Failed to load template: ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error loading HTML template:`, error);
        toastr.error('Failed to load ChatPlus 2 template', 'ChatPlus 2');
        return null;
    }
}

/**
 * Extract the settings template from the loaded HTML and return it as a
 * DocumentFragment. The <template> is removed from the source string so it
 * isn't injected into the main UI.
 *
 * @param {string} html - Raw HTML from chatplus.html
 * @returns {{ mainHTML: string, settingsFragment: DocumentFragment|null }}
 */
function extractSettingsTemplate(html) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;

    const tpl = wrapper.querySelector('#chatplus-settings-template');
    let settingsFragment = null;

    if (tpl) {
        settingsFragment = tpl.content;
        tpl.remove(); // Remove template from main HTML
    }

    return { mainHTML: wrapper.innerHTML, settingsFragment };
}

// ─────────────────────────────────────────
// SETTINGS PANEL
// ─────────────────────────────────────────

/**
 * Inject the settings drawer into SillyTavern's extensions settings area.
 * Always runs — even when the extension is disabled — so users can re-enable.
 *
 * @param {DocumentFragment} fragment - Cloned content from the <template>
 */
function injectSettingsPanel(fragment) {
    const container = document.getElementById('extensions_settings2');
    if (!container) {
        console.warn(`[${MODULE_NAME}] #extensions_settings2 not found — settings panel not injected`);
        return;
    }
    // Guard against duplicate injection
    if (container.querySelector('#chatplus2-settings-drawer')) return;

    container.appendChild(fragment);
    wireSettingsPanel();
    console.log(`[${MODULE_NAME}] Settings panel injected`);
}

/**
 * Wire all settings panel controls (enable toggle, default tab, import/export,
 * reload, migration).
 */
function wireSettingsPanel() {
    const settings = getSettings();
    if (!settings) return;

    // ── Enable / Disable ──
    const enabledCheckbox = document.getElementById('chatplus2-settings-enabled');
    if (enabledCheckbox) {
        enabledCheckbox.checked = settings.enabled !== false;
        enabledCheckbox.addEventListener('change', () => {
            settings.enabled = enabledCheckbox.checked;
            saveSettings();
        });
    }

    // ── Default Tab ──
    const tabRow = document.getElementById('chatplus2-settings-default-tab');
    if (tabRow) {
        const buttons = tabRow.querySelectorAll('.menu_button');
        // Set initial active state
        buttons.forEach(btn => {
            if (btn.dataset.tab === settings.defaultTab) {
                btn.classList.add('chatplus-active');
            }
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.remove('chatplus-active'));
                btn.classList.add('chatplus-active');
                settings.defaultTab = btn.dataset.tab;
                saveSettings();
            });
        });
    }

    // ── Export ──
    const exportBtn = document.getElementById('chatplus2-settings-export');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const data = JSON.stringify(settings, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ChatPlus2-settings.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
        });
    }

    // ── Import ──
    const importBtn = document.getElementById('chatplus2-settings-import');
    if (importBtn) {
        importBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json,application/json';
            fileInput.style.display = 'none';
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const imported = JSON.parse(text);
                    if (typeof imported !== 'object' || Array.isArray(imported)) {
                        throw new Error('Invalid data format');
                    }
                    if (!confirm('Import ChatPlus 2 data?\nThis will overwrite your current settings, folders, and pinned chats. A reload is needed to apply changes.')) {
                        return;
                    }
                    const ctx = SillyTavern.getContext();
                    ctx.extensionSettings[SETTINGS_KEY] = imported;
                    saveSettings();
                    toastr.success('Settings imported. Please reload to apply.', 'ChatPlus 2');
                } catch (err) {
                    console.error(`[${MODULE_NAME}] Import failed:`, err);
                    toastr.error('Failed to import: ' + err.message, 'ChatPlus 2');
                }
            });
            document.body.appendChild(fileInput);
            fileInput.click();
            setTimeout(() => fileInput.remove(), 5000);
        });
    }

    // ── Reload ──
    const reloadBtn = document.getElementById('chatplus2-settings-reload');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', async () => {
            if (!coordinatorRef?.initialized) {
                toastr.warning('Extension is not active. Enable it and reload the page first.', 'ChatPlus 2');
                return;
            }
            const originalHTML = reloadBtn.innerHTML;
            reloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reloading…';
            reloadBtn.disabled = true;

            try {
                const repo = coordinatorRef.chatRepository;
                if (repo) {
                    repo.clearCache();
                    await repo.fetchAllChats();
                }
                await coordinatorRef.recentChatsView?.refresh();
                await coordinatorRef.foldersView?.render();

                reloadBtn.innerHTML = '<i class="fa-solid fa-check"></i> Reloaded!';
                setTimeout(() => {
                    reloadBtn.innerHTML = originalHTML;
                    reloadBtn.disabled = false;
                }, 2000);
            } catch (error) {
                console.error(`[${MODULE_NAME}] Reload failed:`, error);
                reloadBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Error';
                setTimeout(() => {
                    reloadBtn.innerHTML = originalHTML;
                    reloadBtn.disabled = false;
                }, 3000);
            }
        });
    }

    // ── V1 Migration Notice ──
    const migrationSection = document.getElementById('chatplus2-settings-migration');
    const migrateBtn = document.getElementById('chatplus2-settings-migrate');
    if (migrationSection) {
        // Check for v1 settings
        const extensionSettings = SillyTavern.getContext()?.extensionSettings;
        const hasV1 = extensionSettings?.chatsPlus !== undefined;
        const migrated = settings.migrationCompleted === true;

        if (hasV1 && !migrated) {
            migrationSection.style.display = '';
        }

        if (migrateBtn) {
            migrateBtn.addEventListener('click', () => {
                // Step 16 will implement the actual migration logic.
                // For now, show a placeholder message.
                toastr.info('Migration will be available in a future update.', 'ChatPlus 2');
            });
        }
    }

    // ── Drawer toggle (ST inline-drawer convention) ──
    const drawer = document.getElementById('chatplus2-settings-drawer');
    const toggle = drawer?.querySelector('.inline-drawer-toggle');
    const icon = drawer?.querySelector('.inline-drawer-icon');
    const content = drawer?.querySelector('.inline-drawer-content');

    if (toggle && icon && content) {
        toggle.addEventListener('click', () => {
            toggle.classList.toggle('open');
            icon.classList.toggle('down');
            icon.classList.toggle('up');
            content.classList.toggle('open');
        });
    }
}

// ─────────────────────────────────────────
// MAIN UI INJECTION
// ─────────────────────────────────────────

/**
 * Inject tabs into SillyTavern UI
 */
function injectTabsIntoUI(templateHTML) {
    const pinAndTabs = document.getElementById('rm_PinAndTabs');

    if (!pinAndTabs) {
        console.error(`[${MODULE_NAME}] Could not find #rm_PinAndTabs element`);
        toastr.error('Failed to inject ChatPlus 2 UI', 'ChatPlus 2');
        return false;
    }

    // Create container for our tabs
    const container = document.createElement('div');
    container.id = 'chatplus-root';
    container.innerHTML = templateHTML;

    // Insert as immediate next sibling of #rm_PinAndTabs
    pinAndTabs.parentNode.insertBefore(container, pinAndTabs.nextSibling);

    // Wrap existing ST content in "Characters" tab
    wrapExistingCharacterList();

    console.log(`[${MODULE_NAME}] UI injected successfully`);
    return true;
}

/**
 * Wrap existing SillyTavern character list content
 */
function wrapExistingCharacterList() {
    const chatPlusRoot = document.getElementById('chatplus-root');
    const charactersTabContent = document.getElementById('chatplus-characters-content');

    if (!chatPlusRoot || !charactersTabContent) {
        console.error(`[${MODULE_NAME}] Could not wrap character list - missing elements`);
        return;
    }

    // Move all non-comment siblings after #rm_PinAndTabs into the Characters tab
    let currentElement = chatPlusRoot.nextSibling;

    while (currentElement) {
        // Save reference to next sibling before moving the element
        const nextElement = currentElement.nextSibling;

        // Skip comment nodes
        if (currentElement.nodeType === Node.COMMENT_NODE) {
            currentElement = nextElement;
            continue;
        }

        // Move element into Characters tab content
        charactersTabContent.appendChild(currentElement);
        currentElement = nextElement;
    }

    console.log(`[${MODULE_NAME}] Wrapped existing character list content`);
}
/**
 * Bind SillyTavern elements to switch to Characters tab when clicked
 */
function bindSTElementsToCharactersTab() {
    const charactersButton = document.querySelector('[data-chatplus-tab="characters"]');
    if (!charactersButton) {
        console.warn(`[${MODULE_NAME}] Characters tab button not found for binding`);
        return;
    }

    // Function to activate the Characters tab
    const activateCharactersTab = () => {
        if (!charactersButton.classList.contains('active')) {
            charactersButton.click();
        }
    };

    // Bind #rm_button_characters or its first .interactable child
    const rmButtonCharacters = document.getElementById('rm_button_characters');
    if (rmButtonCharacters) {
        const targetElement = rmButtonCharacters.classList.contains('interactable')
            ? rmButtonCharacters
            : rmButtonCharacters.querySelector('.interactable');

        if (targetElement) {
            targetElement.addEventListener('click', activateCharactersTab);
            console.log(`[${MODULE_NAME}] Bound #rm_button_characters to Characters tab`);
        }
    }

    // Bind #rm_button_selected_ch or its first .interactable child
    const rmButtonSelectedCh = document.getElementById('rm_button_selected_ch');
    if (rmButtonSelectedCh) {
        const targetElement = rmButtonSelectedCh.classList.contains('interactable')
            ? rmButtonSelectedCh
            : rmButtonSelectedCh.querySelector('.interactable');

        if (targetElement) {
            targetElement.addEventListener('click', activateCharactersTab);
            console.log(`[${MODULE_NAME}] Bound #rm_button_selected_ch to Characters tab`);
        }
    }
}

/**
 * Initialize the extension
 */
async function initialize() {
    if (isInitialized) {
        console.log(`[${MODULE_NAME}] Already initialized`);
        return;
    }

    console.log(`[${MODULE_NAME}] Initializing...`);

    // Wait for SillyTavern to be ready
    const context = SillyTavern.getContext();
    if (!context) {
        console.error(`[${MODULE_NAME}] SillyTavern context not available`);
        toastr.error('SillyTavern not ready', 'ChatPlus 2');
        return;
    }

    // Load HTML template (contains both main UI and settings template)
    const rawHTML = await loadHTMLTemplate();
    if (!rawHTML) return;

    const { mainHTML, settingsFragment } = extractSettingsTemplate(rawHTML);

    // Always inject the settings panel so users can toggle enabled state
    if (settingsFragment) {
        injectSettingsPanel(settingsFragment);
    }

    // Bail out if the extension has been explicitly disabled in settings.
    // Settings panel is already injected above so the user can re-enable.
    if (!isExtensionEnabled()) {
        console.log(`[${MODULE_NAME}] Disabled in settings — skipping main UI initialization`);
        isInitialized = true;
        return;
    }

    // Inject main tab UI
    if (!injectTabsIntoUI(mainHTML)) return;

    // Bind ST elements to auto-switch to Characters tab
    bindSTElementsToCharactersTab();

    // Dynamically import the coordinator — deferred so the module is never
    // parsed or executed when the extension is disabled.
    let coordinator;
    try {
        const module = await import('./app/chatplus.js');
        coordinator = module.chatPlusCoordinator;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to load coordinator module:`, error);
        toastr.error('ChatPlus 2 failed to load', 'ChatPlus 2');
        isInitialized = true;
        return;
    }

    // Store coordinator reference so settings panel can use it (reload button)
    coordinatorRef = coordinator;

    // Initialize the coordinator (wires all modules together)
    try {
        console.log(`[${MODULE_NAME}] Initializing coordinator...`);
        const success = await coordinator.init();

        if (!success) {
            console.warn(`[${MODULE_NAME}] Coordinator initialization returned false`);
            toastr.warning('ChatPlus 2 loaded with warnings', 'ChatPlus 2');
        } else {
            console.log(`[${MODULE_NAME}] Initialization complete`);
            toastr.success('ChatPlus 2 loaded successfully', 'ChatPlus 2');
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to initialize coordinator:`, error);
        toastr.error('ChatPlus 2 initialization failed. Check console for details.', 'ChatPlus 2');
    }

    // Mark initialized regardless of outcome to prevent repeated attempts
    isInitialized = true;
}

// Listen for APP_READY event
const { eventSource, event_types } = SillyTavern.getContext();
eventSource.on(event_types.APP_READY, initialize);
