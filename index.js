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

/**
 * Cloneable <template> content for the Snapshot Database viewer overlay.
 * Populated during {@link loadAllTemplates}; cloned on demand by the
 * View-button handler in {@link wireSettingsPanel}.
 * @type {DocumentFragment|null}
 */
let snapshotViewerFragment = null;

/**
 * Session-level sort state for the Snapshot viewer. Persists across opens
 * within the same page load (module-scope only — no localStorage).
 * @type {{ column: 'key'|'lastMessage'|'updatedAt', direction: 'asc'|'desc' }}
 */
const snapshotViewerSortState = { column: 'updatedAt', direction: 'desc' };

/**
 * Open the Snapshot Database viewer overlay. Clones the preloaded template,
 * populates rows from the live snapshot store, and wires sort / filter /
 * close interactions. Safe to call with an empty store (shows empty state).
 */
function openSnapshotViewer() {
    if (!snapshotViewerFragment) {
        toastr.error('Snapshot viewer template failed to load.', 'ChatPlus 2');
        return;
    }
    const store = coordinatorRef?.snapshotStore;
    if (!store?._loaded) {
        toastr.warning('Snapshot store is not loaded. Enable the extension and reload first.', 'ChatPlus 2');
        return;
    }

    // Clone fragment → grab refs before appending so querySelector is cheap
    const root = snapshotViewerFragment.cloneNode(true);
    /** @type {HTMLElement} */
    const overlay = root.querySelector('.chatplus-snapshot-viewer-overlay');
    const modal = overlay.querySelector('.chatplus-snapshot-viewer-modal');
    const countEl = overlay.querySelector('.chatplus-snapshot-viewer-count');
    const closeBtn = overlay.querySelector('.chatplus-snapshot-viewer-close');
    const searchInput = overlay.querySelector('.chatplus-snapshot-viewer-search');
    const tableWrap = overlay.querySelector('.chatplus-snapshot-viewer-table-wrap');
    const tbody = overlay.querySelector('.chatplus-snapshot-viewer-tbody');
    const emptyEl = overlay.querySelector('.chatplus-snapshot-viewer-empty');
    const emptyText = overlay.querySelector('.chatplus-snapshot-viewer-empty-text');
    const statusEl = overlay.querySelector('.chatplus-snapshot-viewer-status');
    const sortButtons = overlay.querySelectorAll('.chatplus-snapshot-viewer-sort');

    // ── Snapshot data (flattened) ──
    const all = store.getAll();
    const entries = Object.entries(all).map(([key, snap]) => ({
        key,
        lastMessage: snap.lastMessage || '',
        updatedAt: typeof snap.updatedAt === 'number' ? snap.updatedAt : 0,
    }));
    const totalCount = entries.length;
    countEl.textContent = totalCount === 1 ? '1 entry' : `${totalCount} entries`;

    // ── Current UI state ──
    let currentFilter = '';
    const sortState = snapshotViewerSortState;

    /** Update arrow icon on every sort button to reflect active column. */
    const paintSortIcons = () => {
        sortButtons.forEach(btn => {
            const col = btn.dataset.sortColumn;
            const icon = btn.querySelector('.chatplus-snapshot-viewer-sort-icon');
            btn.classList.toggle('chatplus-active', col === sortState.column);
            if (!icon) return;
            // Reset all known sort icon classes
            icon.classList.remove('fa-sort', 'fa-sort-up', 'fa-sort-down');
            if (col !== sortState.column) {
                icon.classList.add('fa-sort');
            } else {
                icon.classList.add(sortState.direction === 'asc' ? 'fa-sort-up' : 'fa-sort-down');
            }
        });
    };

    const compareValues = (a, b, column) => {
        if (column === 'updatedAt') return a.updatedAt - b.updatedAt;
        if (column === 'lastMessage') return a.lastMessage.localeCompare(b.lastMessage, undefined, { sensitivity: 'base' });
        // 'key'
        return a.key.localeCompare(b.key, undefined, { sensitivity: 'base' });
    };

    /** Filter + sort + re-render tbody. */
    const renderTable = () => {
        const filterLower = currentFilter.trim().toLowerCase();
        const filtered = filterLower
            ? entries.filter(e =>
                e.key.toLowerCase().includes(filterLower)
                || e.lastMessage.toLowerCase().includes(filterLower))
            : entries.slice();

        filtered.sort((a, b) => {
            const cmp = compareValues(a, b, sortState.column);
            return sortState.direction === 'asc' ? cmp : -cmp;
        });

        // Empty-state handling
        if (totalCount === 0) {
            tableWrap.style.display = 'none';
            emptyEl.style.display = '';
            emptyText.textContent = 'No entries stored yet.';
            statusEl.textContent = '';
            return;
        }
        if (filtered.length === 0) {
            tableWrap.style.display = 'none';
            emptyEl.style.display = '';
            emptyText.textContent = 'No entries match your filter.';
            statusEl.textContent = `Showing 0 of ${totalCount} entries`;
            return;
        }

        tableWrap.style.display = '';
        emptyEl.style.display = 'none';

        // Rebuild rows
        tbody.textContent = '';
        const frag = document.createDocumentFragment();
        for (const entry of filtered) {
            const tr = document.createElement('tr');

            const tdKey = document.createElement('td');
            tdKey.className = 'chatplus-snapshot-viewer-cell-key';
            tdKey.textContent = entry.key;
            tdKey.title = entry.key;
            tr.appendChild(tdKey);

            const tdMsg = document.createElement('td');
            tdMsg.className = 'chatplus-snapshot-viewer-cell-message';
            const fullMsg = entry.lastMessage;
            const truncated = fullMsg.length > 100 ? fullMsg.slice(0, 100) + '…' : fullMsg;
            tdMsg.textContent = truncated;
            if (fullMsg.length > 100) tdMsg.title = fullMsg;
            tr.appendChild(tdMsg);

            const tdDate = document.createElement('td');
            tdDate.className = 'chatplus-snapshot-viewer-cell-updated';
            tdDate.textContent = entry.updatedAt
                ? new Date(entry.updatedAt).toLocaleString()
                : '—';
            tr.appendChild(tdDate);

            frag.appendChild(tr);
        }
        tbody.appendChild(frag);

        statusEl.textContent = filtered.length === totalCount
            ? `Showing ${totalCount} ${totalCount === 1 ? 'entry' : 'entries'}`
            : `Showing ${filtered.length} of ${totalCount} entries`;
    };

    // ── Sort header clicks ──
    sortButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const col = btn.dataset.sortColumn;
            if (!col) return;
            if (sortState.column === col) {
                sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortState.column = col;
                // Sensible defaults: dates desc, text asc
                sortState.direction = col === 'updatedAt' ? 'desc' : 'asc';
            }
            paintSortIcons();
            renderTable();
        });
    });

    // ── Search (debounced 200ms) ──
    let searchTimer = 0;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            currentFilter = searchInput.value;
            renderTable();
        }, 200);
    });

    // ── Close handlers ──
    const close = () => {
        clearTimeout(searchTimer);
        document.removeEventListener('keydown', onKeydown, true);
        overlay.remove();
    };
    const onKeydown = (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            close();
        }
    };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    // Prevent clicks inside the modal from bubbling up to the overlay backdrop
    modal.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('keydown', onKeydown, true);

    // ── Mount & initial render ──
    document.body.appendChild(root);
    paintSortIcons();
    renderTable();
    // Focus the search input for immediate typing
    searchInput.focus();
}

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
 * Fetch an HTML file from the extension's app/ folder.
 * @param {string} filename - e.g. 'chatplus.html'
 * @returns {Promise<string|null>} Raw HTML string or null on failure
 */
async function fetchTemplate(filename) {
    try {
        const response = await fetch(`/scripts/extensions/${EXTENSION_FOLDER}/app/${filename}`);
        if (!response.ok) {
            throw new Error(`Failed to load ${filename}: ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error loading ${filename}:`, error);
        return null;
    }
}

/**
 * Load all HTML templates in parallel.
 * Returns the tabs HTML, settings DocumentFragment, and lostfound DocumentFragment.
 *
 * @returns {Promise<{ tabsHTML: string, settingsFragment: DocumentFragment|null, lostfoundFragment: DocumentFragment|null, foldersRaw: string|null }|null>}
 */
async function loadAllTemplates() {
    const [tabsRaw, settingsRaw, lostfoundRaw, foldersRaw, snapshotViewerRaw] = await Promise.all([
        fetchTemplate('chatplus.html'),
        fetchTemplate('settings.html'),
        fetchTemplate('lostfound.html'),
        fetchTemplate('folders.html'),
        fetchTemplate('snapshot-viewer.html'),
    ]);

    if (!tabsRaw) {
        toastr.error('Failed to load ChatPlus 2 template', 'ChatPlus 2');
        return null;
    }

    // Extract <template> content from settings HTML
    let settingsFragment = null;
    if (settingsRaw) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = settingsRaw;
        const tpl = wrapper.querySelector('#chatplus-settings-template');
        if (tpl) settingsFragment = tpl.content;
    }

    // Extract <template> content from snapshot viewer HTML → module-level
    if (snapshotViewerRaw) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = snapshotViewerRaw;
        const tpl = wrapper.querySelector('#chatplus-snapshot-viewer-template');
        if (tpl) snapshotViewerFragment = tpl.content;
    }

    return { tabsHTML: tabsRaw, settingsFragment, lostfoundRaw, foldersRaw };
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
    const inlineReloadBtn = document.getElementById('chatplus2-settings-inline-reload');
    if (enabledCheckbox) {
        const initialEnabled = settings.enabled !== false;
        enabledCheckbox.checked = initialEnabled;
        // The inline "Reload now" button (step 43b) only appears when the
        // checkbox has drifted away from the value the page was loaded
        // with — i.e. the user actually needs a reload for their change
        // to take effect.
        const syncInlineReload = () => {
            if (!inlineReloadBtn) return;
            if (enabledCheckbox.checked !== initialEnabled) {
                inlineReloadBtn.hidden = false;
            } else {
                inlineReloadBtn.hidden = true;
            }
        };
        enabledCheckbox.addEventListener('change', () => {
            settings.enabled = enabledCheckbox.checked;
            saveSettings();
            syncInlineReload();
        });
        if (inlineReloadBtn) {
            inlineReloadBtn.addEventListener('click', () => {
                // Full page reload: the Enable flag gates top-level module
                // initialisation in index.js — a soft tab reload isn't
                // enough to (re)instantiate the disabled modules.
                location.reload();
            });
        }
    }

    // ── Chat Tabs feature toggles (apply live) ──
    // Persist via StateManager.set() so the cached settings stay in sync, then apply the change immediately through the coordinator. coordinatorRef is read lazily (it's null at wire time, set by the time of a click).
    const tabsEnabledCb = document.getElementById('chatplus2-tabs-enabled');
    if (tabsEnabledCb) {
        tabsEnabledCb.checked = settings.tabsEnabled !== false;
        tabsEnabledCb.addEventListener('change', () => {
            const on = tabsEnabledCb.checked;
            const sm = coordinatorRef?.stateManager;
            if (sm?.set) sm.set('tabsEnabled', on); else { settings.tabsEnabled = on; saveSettings(); }
            try {
                coordinatorRef?.setChatTabsEnabled?.(on);
            } catch (error) {
                console.error(`[${MODULE_NAME}] setChatTabsEnabled failed:`, error);
            }
        });
    }

    const tabsStylingCb = document.getElementById('chatplus2-tabs-native-styling');
    if (tabsStylingCb) {
        tabsStylingCb.checked = settings.tabsNativeStyling !== false;
        tabsStylingCb.addEventListener('change', () => {
            const on = tabsStylingCb.checked;
            const sm = coordinatorRef?.stateManager;
            if (sm?.set) sm.set('tabsNativeStyling', on); else { settings.tabsNativeStyling = on; saveSettings(); }
            try {
                coordinatorRef?.chatTabsView?.refreshStyleMode?.();
            } catch (error) {
                console.error(`[${MODULE_NAME}] refreshStyleMode failed:`, error);
            }
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

    // ── Page Size ──
    // Route the write through StateManager.set() so the module's cached
    // `this.settings` stays in sync with `extensionSettings.chatPlus2`.
    // Direct mutation of the persisted object would leave StateManager.get()
    // returning the stale value until the next full load().
    const pageSizeSelect = document.getElementById('chatplus2-settings-page-size');
    if (pageSizeSelect) {
        pageSizeSelect.value = String(settings.pageSize || 100);
        pageSizeSelect.addEventListener('change', () => {
            const value = parseInt(pageSizeSelect.value, 10);
            const stateManager = coordinatorRef?.stateManager;
            if (stateManager && typeof stateManager.set === 'function') {
                stateManager.set('pageSize', value);
            } else {
                settings.pageSize = value;
                saveSettings();
            }
            // Re-render Recent tab so the new page size is visible immediately
            try {
                const recentView = coordinatorRef?.recentChatsView;
                if (recentView && typeof recentView.refresh === 'function') {
                    recentView.refresh().catch(() => { });
                }
            } catch (_) { /* no-op */ }
        });
    }

    // ── Recent List Layout (Flat vs Grouped by character) ──
    const layoutRow = document.getElementById('chatplus2-settings-recent-layout');
    if (layoutRow) {
        const layoutButtons = Array.from(layoutRow.querySelectorAll('[data-layout]'));
        const syncLayoutActive = () => {
            const current = settings.recentListGroupByCharacter ? 'grouped' : 'flat';
            layoutButtons.forEach(btn => {
                btn.classList.toggle('chatplus-active', btn.dataset.layout === current);
            });
        };
        syncLayoutActive();
        layoutButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const grouped = btn.dataset.layout === 'grouped';
                if (settings.recentListGroupByCharacter === grouped) return;
                // Route the write through StateManager.set() so its cached
                // `this.settings` is updated in lock-step — otherwise
                // RecentChatsView's reads via stateManager.get() keep
                // returning the previous value and the list renders stale.
                const stateManager = coordinatorRef?.stateManager;
                if (stateManager && typeof stateManager.set === 'function') {
                    stateManager.set('recentListGroupByCharacter', grouped);
                } else {
                    settings.recentListGroupByCharacter = grouped;
                    saveSettings();
                }
                syncLayoutActive();
                // Re-render Recent tab so the change is visible immediately
                try {
                    const recentView = coordinatorRef?.recentChatsView;
                    if (recentView && typeof recentView.refresh === 'function') {
                        recentView.refresh().catch(() => { });
                    }
                } catch (_) { /* no-op */ }
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

    // ── Check for Updates ──
    const updateBtn = document.getElementById('chatplus2-settings-update');
    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            // Deep-link into ST's Installed Extensions modal, which automatically
            // checks for updates and highlights rows with available updates.
            const trigger = document.querySelector('#extensions_details');
            if (trigger) {
                trigger.click();
            } else {
                toastr.warning(
                    'Open User Settings → Extensions → Manage Extensions to check for updates.',
                    'ChatPlus 2',
                );
            }
        });
    }

    // ── Feedback / Bug Reports (44d) ──
    const feedbackBtn = document.getElementById('chatplus2-settings-feedback');
    if (feedbackBtn) {
        feedbackBtn.addEventListener('click', () => {
            // Open a new tab to the project's GitHub issues page. URL matches
            // manifest.json `homePage`. `noopener,noreferrer` prevents the new
            // tab from accessing window.opener.
            window.open(
                'https://github.com/SoFizzticated/SillyTavern-ChatPlus2/issues/new',
                '_blank',
                'noopener,noreferrer',
            );
        });
    }

    // ── Lost & Found ──
    const lostFoundBtn = document.getElementById('chatplus2-settings-lostfound');
    if (lostFoundBtn) {
        lostFoundBtn.addEventListener('click', async () => {
            if (!coordinatorRef?.initialized) {
                toastr.warning('Extension is not active. Enable it and reload the page first.', 'ChatPlus 2');
                return;
            }

            const lostAndFound = coordinatorRef.lostAndFound;
            if (!lostAndFound) {
                toastr.error('Lost & Found module not available.', 'ChatPlus 2');
                return;
            }

            const originalHTML = lostFoundBtn.innerHTML;
            lostFoundBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning…';
            lostFoundBtn.disabled = true;

            try {
                const { report, candidates } = lostAndFound.scan();
                lostFoundBtn.innerHTML = originalHTML;
                lostFoundBtn.disabled = false;

                const summary = await lostAndFound.showResolver(report, candidates);
                if (summary) {
                    const parts = [];
                    if (summary.relinked) parts.push(`${summary.relinked} reconnected`);
                    if (summary.removed) parts.push(`${summary.removed} removed`);
                    if (summary.skipped) parts.push(`${summary.skipped} skipped`);
                    if (summary.errors) parts.push(`${summary.errors} error(s)`);
                    toastr.success(parts.join(', ') || 'No changes.', 'Lost & Found');
                }
            } catch (error) {
                console.error(`[${MODULE_NAME}] Lost & Found scan failed:`, error);
                lostFoundBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Error';
                setTimeout(() => {
                    lostFoundBtn.innerHTML = originalHTML;
                    lostFoundBtn.disabled = false;
                }, 3000);
            }
        });
    }

    // ── Snapshot Database ──
    const snapshotInfo = document.getElementById('chatplus2-snapshot-info');
    const snapshotInfoText = snapshotInfo?.querySelector('.chatplus-settings-pill-text');
    const updateSnapshotInfo = () => {
        // Prefer the inner pill text span (settings panel overhaul markup);
        // fall back to the pill root for older/injected markup.
        const target = snapshotInfoText ?? snapshotInfo;
        if (!target) return;
        const store = coordinatorRef?.snapshotStore;
        if (!store?._loaded) {
            target.textContent = 'Not loaded (extension inactive or still initializing).';
        } else {
            target.textContent = `${store.size} entries stored.`;
        }
    };
    updateSnapshotInfo();

    const snapshotViewBtn = document.getElementById('chatplus2-snapshot-view');
    if (snapshotViewBtn) {
        snapshotViewBtn.addEventListener('click', () => {
            openSnapshotViewer();
        });
    }

    const snapshotExportBtn = document.getElementById('chatplus2-snapshot-export');
    if (snapshotExportBtn) {
        snapshotExportBtn.addEventListener('click', () => {
            const store = coordinatorRef?.snapshotStore;
            if (!store?._loaded) {
                toastr.warning('Snapshot store is not loaded. Enable the extension and reload first.', 'ChatPlus 2');
                return;
            }
            const db = { version: 1, snapshots: store.getAll() };
            const data = JSON.stringify(db, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'chatplus2-snapshots.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
            toastr.success(`Exported ${store.size} entries.`, 'ChatPlus 2');
        });
    }

    const snapshotImportBtn = document.getElementById('chatplus2-snapshot-import');
    if (snapshotImportBtn) {
        snapshotImportBtn.addEventListener('click', () => {
            const store = coordinatorRef?.snapshotStore;
            if (!store?._loaded) {
                toastr.warning('Snapshot store is not loaded. Enable the extension and reload first.', 'ChatPlus 2');
                return;
            }
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

                    // Validate structure
                    if (!imported || typeof imported !== 'object' || typeof imported.snapshots !== 'object' || Array.isArray(imported.snapshots)) {
                        throw new Error('Invalid snapshot database format. Expected { version, snapshots: { ... } }');
                    }
                    // Validate individual entries
                    for (const [key, val] of Object.entries(imported.snapshots)) {
                        if (!val || typeof val.lastMessage !== 'string' || typeof val.updatedAt !== 'number') {
                            throw new Error(`Invalid entry for key "${key}". Each snapshot must have lastMessage (string) and updatedAt (number).`);
                        }
                    }

                    const count = Object.keys(imported.snapshots).length;
                    if (!confirm(`Import ${count} entries?\nThis will replace the current snapshot database (${store.size} entries).`)) {
                        return;
                    }

                    // Replace the internal database
                    store._db = { version: imported.version ?? 1, snapshots: imported.snapshots };
                    store._dirty = true;
                    await store.flush();
                    updateSnapshotInfo();
                    toastr.success(`Imported ${count} entries.`, 'ChatPlus 2');
                } catch (err) {
                    console.error(`[${MODULE_NAME}] Snapshot import failed:`, err);
                    toastr.error('Failed to import snapshots: ' + err.message, 'ChatPlus 2');
                }
            });
            document.body.appendChild(fileInput);
            fileInput.click();
            setTimeout(() => fileInput.remove(), 5000);
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
            migrateBtn.addEventListener('click', async () => {
                // Guard: coordinator must be live so we can access modules post-migration
                if (!coordinatorRef?.initialized) {
                    toastr.warning('Extension is not active. Enable it and reload the page first.', 'ChatPlus 2');
                    return;
                }

                // Confirmation prompt
                if (!confirm(
                    'Migrate ChatPlus v1 data to v2?\n\n'
                    + 'This will import your v1 pins, folders, and folder assignments into v2. '
                    + 'Your v1 data will NOT be modified — a backup will be created first.\n\n'
                    + 'Any references that can\'t be resolved (e.g. deleted characters) will be '
                    + 'sent to Lost & Found for manual reconciliation.'
                )) {
                    return;
                }

                const originalHTML = migrateBtn.innerHTML;
                migrateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Migrating…';
                migrateBtn.disabled = true;

                try {
                    // Snapshot orphan count BEFORE migration so we can detect new ones
                    const lostAndFound = coordinatorRef.lostAndFound;
                    let orphansBefore = 0;
                    if (lostAndFound) {
                        try {
                            const preScan = lostAndFound.scan();
                            orphansBefore = preScan.report.orphans.length;
                        } catch (_) { /* best-effort */ }
                    }

                    const { default: MigrationHelper } = await import('./utils/migration.js');
                    const helper = new MigrationHelper(coordinatorRef.stateManager);
                    const summary = await helper.migrate();

                    // Build human-readable result
                    const parts = [];
                    if (summary.convertedPins > 0) parts.push(`${summary.convertedPins} pin(s)`);
                    if (summary.convertedFolderKeys > 0) parts.push(`${summary.convertedFolderKeys} folder assignment(s)`);
                    if (summary.upgradedFolders > 0) parts.push(`${summary.upgradedFolders} folder(s)`);

                    if (parts.length > 0) {
                        toastr.success(`Migrated: ${parts.join(', ')}.`, 'ChatPlus 2');
                    } else {
                        toastr.info('No v1 data to migrate.', 'ChatPlus 2');
                    }

                    // Hide migration section now that it's complete
                    migrationSection.style.display = 'none';

                    // Refresh the UI if coordinator is live
                    try {
                        await coordinatorRef.chatRepository?.fetchAllChats(true);
                        await coordinatorRef.recentChatsView?.refresh();
                        await coordinatorRef.foldersView?.render();
                    } catch (refreshErr) {
                        console.warn(`[${MODULE_NAME}] Post-migration UI refresh failed:`, refreshErr);
                    }

                    // Scan for orphans AFTER migration — trigger resolver if new ones appeared
                    if (lostAndFound) {
                        try {
                            const { report, candidates } = lostAndFound.scan();
                            const newOrphans = report.orphans.length - orphansBefore;

                            if (report.orphans.length > 0 && newOrphans > 0) {
                                toastr.warning(
                                    `${newOrphans} reference(s) couldn't be resolved automatically. Opening Lost & Found…`,
                                    'ChatPlus 2',
                                    { timeOut: 6000 }
                                );
                                await lostAndFound.showResolver(report, candidates);
                            }
                        } catch (lfErr) {
                            console.error(`[${MODULE_NAME}] Post-migration Lost & Found failed:`, lfErr);
                        }
                    }
                } catch (error) {
                    console.error(`[${MODULE_NAME}] V1 migration failed:`, error);
                    toastr.error('Migration failed: ' + error.message, 'ChatPlus 2');
                } finally {
                    migrateBtn.innerHTML = originalHTML;
                    migrateBtn.disabled = false;
                }
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
 * Inject the chat-tabs stylesheet. The manifest only declares chatplus.css, so the multi-profile chat-tabs styles are loaded here. Idempotent.
 */
function injectChatTabsStylesheet() {
    const id = 'chatplus2-chat-tabs-css';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `/scripts/extensions/${EXTENSION_FOLDER}/app/chat-tabs.css`;
    document.head.appendChild(link);
}

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

    // Insert as immediate PREVIOUS sibling of #rm_PinAndTabs (matches ChatPlus v1's placement above the pin/tabs bar).
    // Deliberately do NOT move or reparent any SillyTavern DOM — the ChatPlus tab panels live alongside `.scrollableInner`, and the TabController toggles visibility on it via `.chatplus-native-hidden`.
    pinAndTabs.parentNode.insertBefore(container, pinAndTabs);

    console.log(`[${MODULE_NAME}] UI injected successfully`);
    return true;
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

    // Load all HTML templates (tabs, settings, lostfound) in parallel
    const templates = await loadAllTemplates();
    if (!templates) return;

    const { tabsHTML, settingsFragment, lostfoundRaw, foldersRaw } = templates;

    // Always inject the settings panel so users can toggle enabled state
    if (settingsFragment) {
        injectSettingsPanel(settingsFragment);
    }

    // Inject ALL lostfound templates (main resolver + sub-templates) into DOM
    // so lost-and-found.js can clone any of them by id via _tpl().
    if (lostfoundRaw) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = lostfoundRaw;
        for (const tpl of wrapper.querySelectorAll('template')) {
            if (tpl.id && !document.getElementById(tpl.id)) {
                document.body.appendChild(tpl);
            }
        }
    }

    // Inject folders templates into DOM for runtime cloning by folders-view.js / ui-renderer.js
    if (foldersRaw) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = foldersRaw;
        for (const tpl of wrapper.querySelectorAll('template')) {
            document.body.appendChild(tpl);
        }
    }

    // Bail out if the extension has been explicitly disabled in settings.
    // Settings panel is already injected above so the user can re-enable.
    if (!isExtensionEnabled()) {
        console.log(`[${MODULE_NAME}] Disabled in settings — skipping main UI initialization`);
        isInitialized = true;
        return;
    }

    // Load the chat-tabs stylesheet (manifest only declares chatplus.css).
    injectChatTabsStylesheet();

    // Inject main tab UI
    if (!injectTabsIntoUI(tabsHTML)) return;

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

// ─────────────────────────────────────────
// LIFECYCLE HOOKS (ST manifest.hooks)
// ─────────────────────────────────────────

/**
 * Read the current extension version from the live manifest.json.
 * Bypasses the module cache so post-update hooks see the new version.
 */
async function _readManifestVersion() {
    try {
        const resp = await fetch(`/scripts/extensions/${EXTENSION_FOLDER}/manifest.json`, { cache: 'no-store' });
        const m = await resp.json();
        return m?.version ?? 'unknown';
    } catch (err) {
        console.warn(`[${MODULE_NAME}] Could not read manifest version:`, err);
        return 'unknown';
    }
}

/**
 * ST lifecycle hook: install.
 * Called once by SillyTavern after successful first-time installation.
 * Initializes default settings and stamps the installed version.
 */
export async function onInstall() {
    try {
        const settings = getSettings(); // also seeds DEFAULT_SETTINGS if missing
        const version = await _readManifestVersion();
        if (settings) {
            settings._lastRanVersion = version;
            saveSettings();
        }
        console.log(`[${MODULE_NAME}] Installed (v${version})`);
    } catch (error) {
        console.error(`[${MODULE_NAME}] onInstall failed:`, error);
    }
}

/**
 * ST lifecycle hook: update.
 * Called by SillyTavern after a successful git-pull update, before the
 * "Reload to apply updates" toast. Runs any registered data migrations
 * and updates the version stamp.
 *
 * Must complete in well under 5 seconds (ST hard-kills the hook at 5s).
 */
export async function onUpdate() {
    try {
        const settings = getSettings();
        const toVersion = await _readManifestVersion();
        const fromVersion = settings?._lastRanVersion ?? null;

        console.log(`[${MODULE_NAME}] Updated from ${fromVersion ?? '(first hook run)'} → ${toVersion}`);

        // Delegate to migration scaffold if present and version actually changed.
        // Uses the coordinator's StateManager if initialized; otherwise skipped
        // (migrations can be re-attempted on next reload via onSettingsLoadedAfter).
        let summary = null;
        if (fromVersion !== toVersion) {
            try {
                const sm = coordinatorRef?.stateManager;
                if (sm && typeof sm.runMigrations === 'function') {
                    summary = await sm.runMigrations(fromVersion, toVersion);
                }
            } catch (mErr) {
                console.error(`[${MODULE_NAME}] Migration pipeline failed:`, mErr);
            }
        }

        // Always stamp the new version last so a mid-migration failure is retryable.
        if (settings) {
            settings._lastRanVersion = toVersion;
            saveSettings();
        }

        // Only toast when a migration actually mutated state — ST already
        // shows its own "Reload to apply updates" toast after this hook returns.
        if (summary && typeof summary === 'object' && summary.migrationsRun > 0) {
            toastr.info(
                `Applied ${summary.migrationsRun} data migration(s) for v${toVersion}. Reload to use the new version.`,
                'ChatPlus 2',
                { timeOut: 0, closeButton: true }
            );
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] onUpdate failed:`, error);
    }
}

// Listen for APP_READY event
const { eventSource, event_types } = SillyTavern.getContext();
eventSource.on(event_types.APP_READY, initialize);
