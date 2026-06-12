/**
 * UIRenderer - Stateless DOM factory for chat items, folders, and UI chrome
 *
 * Produces HTMLElements from data objects. Has no internal state and no direct
 * dependencies on feature modules — all interactivity is wired through the
 * `options` callbacks passed by the calling view.
 *
 * All user-generated text is written via .textContent (XSS-safe).
 * DOMPurify is not needed here because we never use innerHTML for user data.
 *
 * @module UIRenderer
 */

import * as CoreAPI from './core-api.js';
import * as ChatIdentifier from '../utils/chat-identifier.js';

export class UIRenderer {

    // ─────────────────────────────────────────────────────────────
    // CHAT ITEMS
    // ─────────────────────────────────────────────────────────────

    /**
     * Build a single chat-list item element.
     *
     * Label format: "CharacterName: filename" (matching v1 style).
     *
     * @param {Object}   chat
     * @param {Object}   [options]
     * @param {boolean}  [options.isPinned=false]   Whether this chat is pinned
     * @param {boolean}  [options.isActive=false]   Whether this is the currently open chat
     * @param {boolean}  [options.editMode=false]   Whether edit/multi-select mode is active
     * @param {boolean}  [options.selected=false]   Whether this item is selected (edit mode)
     * @param {Function} [options.onOpen]            Called with (chat) when the row is tapped
     * @param {Function} [options.onPin]             Called with (chat, chatKey) when pin toggled
     * @param {Function} [options.onRename]          Called with (chat, chatKey) when rename pressed
     * @param {Function} [options.onRemoveFromFolder] Called with (chat, chatKey) when remove-from-folder pressed
     * @param {Function} [options.onAddToFolder]      Called with (chat, chatKey, anchorBtn) when add-to-folder pressed
     * @param {Function} [options.onDelete]           Called with (chat, chatKey) when delete pressed
     * @param {Function} [options.onSelect]           Called with (chatKey, checked) when checkbox toggled (edit mode)
     * @param {boolean}  [options.includeEntityPrefix=true] When false, render only the chat filename
     *                                                  (character/group name is expected to be shown in a
     *                                                  separator row above). Defaults to true for
     *                                                  backwards compatibility with pinned, folder, and
     *                                                  add-chats views.
     * @param {boolean}  [options.includeAvatar=true] When false, suppress the per-row avatar
     *                                                  thumbnail. Used by the Recent tab's
     *                                                  "Grouped by character" layout, where a
     *                                                  character separator above the cluster
     *                                                  already shows the entity avatar and the
     *                                                  per-row thumbnail would be redundant.
     * @returns {HTMLElement|null}
     */
    renderChatItem(chat, options = {}) {
        const { isPinned = false, isActive = false, editMode = false, selected = false, onOpen, onOpenInTab, onPin, onRename, onRemoveFromFolder, onAddToFolder, onDelete, onSelect, includeEntityPrefix = true, includeAvatar = true } = options;

        try {
            const chatKey = ChatIdentifier.getChatKey(chat);

            const item = document.createElement('div');
            item.className = 'chatplus-chat-item';
            if (isPinned) item.classList.add('chatplus-chat-item--pinned');
            if (isActive) item.classList.add('chatplus-chat-item--active');
            item.dataset.chatKey = chatKey;

            // ── Edit-mode checkbox ───────────────────────────────────────
            if (editMode && onSelect) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'chatplus-edit-checkbox';
                checkbox.checked = selected;
                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    onSelect(chatKey, checkbox.checked);
                });
                item.appendChild(checkbox);
                item.classList.add('chatplus-chat-item--edit-mode');
            }

            // ── Avatar ──────────────────────────────────────────────────
            // Suppressed by the Recent tab's grouped layout, which shows
            // the avatar once on the character-separator row above the cluster.
            if (includeAvatar) {
                item.appendChild(this._buildAvatar(chat));
            } else {
                item.classList.add('chatplus-chat-item--no-avatar');
            }

            // ── Info block ──────────────────────────────────────────────
            const info = document.createElement('div');
            info.className = 'chatplus-chat-info';

            // Top row: "Character: filename" label + action buttons
            const topRow = document.createElement('div');
            topRow.className = 'chatplus-chat-top-row';

            const label = document.createElement('span');
            label.className = 'chatplus-chat-label';
            label.textContent = this._buildLabel(chat, { includeEntityPrefix });
            topRow.appendChild(label);

            topRow.appendChild(this._buildChatActions(chat, chatKey, { isPinned, onPin, onRename, onRemoveFromFolder, onAddToFolder, onDelete, editMode }));
            info.appendChild(topRow);

            // Last message preview
            const lastMsg = chat.stats?.lastMessage;
            if (lastMsg) {
                const preview = document.createElement('div');
                preview.className = 'chatplus-chat-preview';
                // Trim long previews — textContent is safe
                preview.textContent = lastMsg.length > 80
                    ? lastMsg.slice(0, 80).trimEnd() + '…'
                    : lastMsg;
                info.appendChild(preview);
            }

            item.appendChild(info);

            // ── Open-in-tab "+" (Recent tab only — gated on the callback) ──
            // Full-height button at the right edge that opens the chat as a secondary multi-profile tab instead of switching the main chat.
            if (onOpenInTab) {
                const openTabBtn = document.createElement('button');
                openTabBtn.type = 'button';
                openTabBtn.className = 'chatplus-chat-open-tab';
                openTabBtn.title = 'Open in a new chat tab';
                openTabBtn.setAttribute('aria-label', 'Open in a new chat tab');
                openTabBtn.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i>';
                openTabBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onOpenInTab(chat);
                });
                item.appendChild(openTabBtn);
            }

            // ── Tap / click to open ─────────────────────────────────────
            // Ignore clicks originating from the action buttons zone or checkboxes.
            item.addEventListener('click', (e) => {
                if (e.target.closest('.chatplus-chat-actions')) return;
                if (e.target.closest('.chatplus-edit-checkbox')) return;
                if (e.target.closest('.chatplus-chat-open-tab')) return;
                // Edit mode takes precedence: clicking the row toggles the checkbox
                // instead of opening the chat.
                if (editMode && onSelect) {
                    const cb = item.querySelector('.chatplus-edit-checkbox');
                    if (cb) {
                        cb.checked = !cb.checked;
                        onSelect(chatKey, cb.checked);
                    }
                    return;
                }
                // Non-edit "edit-mode" marker (used by some legacy flows) — still
                // suppress open when the item is in a non-open state.
                if (item.classList.contains('chatplus-chat-item--edit-mode')) return;
                if (onOpen) onOpen(chat);
            });

            return item;
        } catch (error) {
            console.error('[ChatPlus2] UIRenderer: error building chat item', error, chat);
            return null;
        }
    }

    /**
     * Build a date-separator element ("Today", "Yesterday", "Monday", etc.).
     * @param {string} label
     * @returns {HTMLElement}
     */
    renderDateSeparator(label) {
        const sep = document.createElement('div');
        sep.className = 'chatplus-date-separator';
        sep.textContent = String(label);
        return sep;
    }

    /**
     * Build a character / group separator row for the Recent list.
     * Rendered when the avatar changes between two consecutive items
     * within the same date bucket. Shows the avatar thumbnail + entity name
     * (prefixed with 👥 for group chats). No filename, no actions.
     *
     * @param {Object} chat  Any chat object owned by the entity to header.
     * @returns {HTMLElement}
     */
    renderCharacterSeparator(chat) {
        const sep = document.createElement('div');
        sep.className = 'chatplus-character-separator';
        if (chat?.is_group) sep.classList.add('chatplus-character-separator--group');

        sep.appendChild(this._buildAvatar(chat));

        const name = document.createElement('span');
        name.className = 'chatplus-character-separator-name';
        const entityName = chat?.character_name || 'Unknown';
        name.textContent = chat?.is_group ? `👥 ${entityName}` : entityName;
        sep.appendChild(name);

        return sep;
    }

    /**
     * Build a visually distinct section header (e.g. "📌 Pinned Chats").
     * @param {string}  text
     * @param {string}  [modifier]  Extra BEM modifier class (e.g. "pinned")
     * @returns {HTMLElement}
     */
    renderSectionHeader(text, modifier = '') {
        const el = document.createElement('div');
        el.className = 'chatplus-section-header';
        if (modifier) el.classList.add(`chatplus-section-header--${modifier}`);
        el.textContent = text;
        return el;
    }

    /**
     * Build a centered loading spinner element.
     * @returns {HTMLElement}
     */
    renderLoadingSpinner() {
        const wrap = document.createElement('div');
        wrap.className = 'chatplus-loading';
        const spinner = document.createElement('div');
        spinner.className = 'chatplus-spinner';
        wrap.appendChild(spinner);
        return wrap;
    }

    /**
     * Build an empty / no-results message element.
     * @param {string} message
     * @returns {HTMLElement}
     */
    renderEmptyMessage(message) {
        const el = document.createElement('div');
        el.className = 'chatplus-empty-message';
        el.textContent = String(message);
        return el;
    }

    /**
     * Build a compact "⚠ N item(s) unavailable — review in Lost & Found"
     * notice row. Rendered at the end of a section (pinned list, folder
     * contents) when one or more saved chat keys failed to resolve.
     * Clicking the row invokes `onClick` (typically opening the resolver
     * scoped to the stale keys in that section).
     *
     * @param {number}    count    Number of unavailable items in this section
     * @param {Function}  onClick  Click handler; receives the raw click event
     * @returns {HTMLElement}
     */
    renderUnavailableNotice(count, onClick) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'chatplus-unavailable-notice';
        el.title = 'Open Lost & Found to relink or remove these references';

        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-triangle-exclamation';
        icon.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'chatplus-unavailable-notice-label';
        label.textContent = `${count} item${count === 1 ? '' : 's'} unavailable — review in Lost & Found`;

        el.appendChild(icon);
        el.appendChild(label);

        if (typeof onClick === 'function') {
            el.addEventListener('click', onClick);
        }

        return el;
    }

    /**
     * Build a dimmed "stale" placeholder for a chat key that no longer
     * resolves to a live chat (orphaned pin or folder assignment).
     * Rendered in-place so the user keeps the spatial context of their
     * saved list. Clicking the row invokes `onClick(chatKey)` — usually
     * opens the Lost & Found resolver scoped to this single key.
     *
     * @param {string}   chatKey   The orphaned chat key (avatar:fileName)
     * @param {Object}   [options]
     * @param {string[]} [options.sources]  Where the key is referenced: 'pin' | 'folder' | 'transient'
     * @param {Function} [options.onClick]  Called with (chatKey) when the row is activated
     * @returns {HTMLElement}
     */
    renderStaleChatItem(chatKey, options = {}) {
        const { sources = [], onClick } = options;

        const item = document.createElement('div');
        item.className = 'chatplus-chat-item chatplus-chat-item--stale';
        item.dataset.chatKey = chatKey;
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.title = 'This chat no longer exists at its saved name. Click to relink or remove via Lost & Found.';

        // ── Warning glyph in the avatar slot ─────────────────────────
        const avatar = document.createElement('div');
        avatar.className = 'chatplus-chat-avatar chatplus-chat-avatar--stale';
        const warnIcon = document.createElement('i');
        warnIcon.className = 'fa-solid fa-triangle-exclamation';
        warnIcon.setAttribute('aria-hidden', 'true');
        avatar.appendChild(warnIcon);
        item.appendChild(avatar);

        // ── Info block ───────────────────────────────────────────────
        const info = document.createElement('div');
        info.className = 'chatplus-chat-info';

        const topRow = document.createElement('div');
        topRow.className = 'chatplus-chat-top-row';

        const label = document.createElement('span');
        label.className = 'chatplus-chat-label';
        // Show the saved filename (avatar suffix stripped) so the user can
        // still recognise which entry they're looking at.
        const fileName = ChatIdentifier.extractFileNameFromKey(chatKey) || chatKey;
        label.textContent = fileName;
        topRow.appendChild(label);

        info.appendChild(topRow);

        const preview = document.createElement('div');
        preview.className = 'chatplus-chat-preview chatplus-chat-preview--stale';
        const src = sources.includes('pin') && sources.includes('folder')
            ? 'pinned & in folder'
            : sources.includes('pin')
                ? 'pinned'
                : sources.includes('folder')
                    ? 'in folder'
                    : '';
        preview.textContent = src
            ? `Unavailable (${src}) — click to resolve`
            : 'Unavailable — click to resolve';
        info.appendChild(preview);

        item.appendChild(info);

        const fire = () => {
            if (typeof onClick === 'function') onClick(chatKey);
        };
        item.addEventListener('click', fire);
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fire();
            }
        });

        return item;
    }

    /**
     * Build a compact chat item with a leading checkbox.
     * Used in the "Add Chats" view of the folder content manager.
     * Lightweight: 32px avatar + label only, no preview or action buttons.
     *
     * @param {Object}   chat
     * @param {Object}   [options]
     * @param {boolean}  [options.checked=false]  Initial checkbox state
     * @param {Function} [options.onToggle]        Called with (chatKey, checked) on checkbox change
     * @returns {HTMLElement|null}
     */
    renderChatItemCompact(chat, options = {}) {
        const { checked = false, onToggle } = options;

        try {
            const chatKey = ChatIdentifier.getChatKey(chat);

            const item = document.createElement('label');
            item.className = 'chatplus-chat-item chatplus-chat-item--compact';
            item.dataset.chatKey = chatKey;

            // Checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'chatplus-cm-checkbox';
            checkbox.checked = checked;
            if (onToggle) {
                checkbox.addEventListener('change', () => onToggle(chatKey, checkbox.checked));
            }
            item.appendChild(checkbox);

            // Avatar (smaller)
            item.appendChild(this._buildAvatar(chat));

            // Label only — no preview, no actions
            const label = document.createElement('span');
            label.className = 'chatplus-chat-label';
            label.textContent = this._buildLabel(chat);
            item.appendChild(label);

            return item;
        } catch (error) {
            console.error('[ChatPlus2] UIRenderer: error building compact chat item', error, chat);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // FOLDERS
    // ─────────────────────────────────────────────────────────────

    /**
     * Build a folder row element from the template.
     *
     * Nesting depth is passed via a CSS custom property `--chatplus-depth`
     * so the caller can just set `level` and CSS handles indentation.
     *
     * The template includes:
     *   .chatplus-folder-header  — chevron, icon, name, actions
     *   .chatplus-folder-body    — options bar + content wrapper (hidden when collapsed)
     *
     * The caller (FoldersView) is responsible for:
     *   - wiring expand/collapse (header click)
     *   - populating .chatplus-folder-contents on expand
     *   - wiring options bar buttons
     *
     * @param {Object}   folder
     * @param {string}   folder.id
     * @param {string}   folder.name
     * @param {number}   [level=0]       Nesting depth
     * @param {Object}   [options]
     * @param {boolean}  [options.expanded=false]      Whether to start expanded
     * @param {Function} [options.onExpand]             Called with (folderId, folderEl) when opened for the first time
     * @param {Function} [options.onRename]             Called with (folder) when rename pressed
     * @param {Function} [options.onCreateSubfolder]    Called with (folder) when subfolder pressed
     * @param {Function} [options.onToggleOptions]      Called with (folder, gearBtn) when gear pressed
     * @param {Function} [options.onToggleExpand]       Called with (folderId, isExpanded) on every expand/collapse
     * @returns {HTMLElement}
     */
    renderFolder(folder, level = 0, options = {}) {
        const { expanded: startExpanded = false, onExpand, onRename, onCreateSubfolder, onToggleOptions, onToggleExpand, onOpenAsTabs } = options;

        const tpl = document.getElementById('chatplus-folder-item-template');
        if (!tpl) {
            console.error('[ChatPlus2] UIRenderer: chatplus-folder-item-template not found');
            return document.createElement('div');
        }

        const el = tpl.content.firstElementChild.cloneNode(true);
        el.dataset.folderId = folder.id;
        el.style.setProperty('--chatplus-depth', String(level));

        // ── Populate header ─────────────────────────────────────
        const header = el.querySelector('.chatplus-folder-header');
        const iconEl = el.querySelector('.chatplus-folder-icon');
        const nameEl = el.querySelector('.chatplus-folder-name');
        const actions = el.querySelector('.chatplus-folder-actions');
        const body = el.querySelector('.chatplus-folder-body');

        nameEl.textContent = folder.name || 'Unnamed Folder';

        // ── Action buttons: open-as-tabs, rename, subfolder, gear ───────
        if (onOpenAsTabs) {
            actions.appendChild(
                this._makeActionBtn('fa-regular fa-window-maximize', 'Open folder as tabs', (e) => {
                    e.stopPropagation();
                    onOpenAsTabs(folder);
                })
            );
        }
        if (onRename) {
            actions.appendChild(
                this._makeActionBtn('fa-solid fa-pencil-alt', 'Rename folder', (e) => {
                    e.stopPropagation();
                    onRename(folder);
                })
            );
        }
        if (onCreateSubfolder) {
            actions.appendChild(
                this._makeActionBtn('fa-solid fa-folder-plus', 'Create subfolder', (e) => {
                    e.stopPropagation();
                    onCreateSubfolder(folder);
                })
            );
        }
        if (onToggleOptions) {
            const gearBtn = this._makeActionBtn('fa-solid fa-gear', 'Folder options', (e) => {
                e.stopPropagation();
                onToggleOptions(folder, gearBtn);
            });
            actions.appendChild(gearBtn);
            el._gearBtn = gearBtn;
        }

        // ── Body visibility (collapsed / expanded) ──────────────
        body.hidden = !startExpanded;

        let hasLoadedChildren = false;
        if (startExpanded) {
            el.classList.add('chatplus-folder-item--expanded');
            iconEl.innerHTML = '<i class="fa-solid fa-folder-open" aria-hidden="true"></i>';
            hasLoadedChildren = true;
            if (onExpand) onExpand(folder.id, el);
        }

        // ── Toggle expand / collapse on header click ────────────
        header.addEventListener('click', (e) => {
            if (e.target.closest('.chatplus-folder-actions')) return;

            const expanded = el.classList.toggle('chatplus-folder-item--expanded');
            body.hidden = !expanded;
            iconEl.innerHTML = expanded
                ? '<i class="fa-solid fa-folder-open" aria-hidden="true"></i>'
                : '<i class="fa-solid fa-folder" aria-hidden="true"></i>';

            if (expanded && !hasLoadedChildren) {
                hasLoadedChildren = true;
                if (onExpand) onExpand(folder.id, el);
            }

            if (onToggleExpand) onToggleExpand(folder.id, expanded);

            // Collapse → reset gear + any active mode
            if (!expanded) {
                const optionsBar = el.querySelector('.chatplus-folder-options-bar');
                if (optionsBar) optionsBar.classList.add('chatplus-hidden');
                if (el._gearBtn) el._gearBtn.classList.remove('chatplus-action-btn--cm-active');
                // Reset active option buttons
                optionsBar?.querySelectorAll('.chatplus-options-btn').forEach(btn => btn.classList.remove('active'));
                // Ensure normal contents visible, add panel hidden
                const contents = el.querySelector('.chatplus-folder-contents');
                const addPanel = el.querySelector('.chatplus-folder-add-panel');
                const removeFooter = el.querySelector('.chatplus-remove-footer');
                if (contents) contents.classList.remove('chatplus-hidden');
                if (addPanel) addPanel.classList.add('chatplus-hidden');
                if (removeFooter) removeFooter.classList.add('chatplus-hidden');
            }
        });

        return el;
    }

    // ─────────────────────────────────────────────────────────────
    // FOLDER PICKER
    // ─────────────────────────────────────────────────────────────

    /**
     * Build a positioned folder-picker popover anchored near a given element.
     * Shows a nested folder list; click a folder to select it.
     * Auto-closes on outside click, Escape, or selection.
     *
     * @param {Array}       folders       - Hierarchical folder array from getFolderHierarchy()
     * @param {Function}    onSelect      - Called with (folderId) when a folder is selected
     * @param {HTMLElement} anchorElement - Element to position the popover near
     * @returns {HTMLElement} The popover element (already appended to document.body)
     */
    renderFolderPicker(folders, onSelect, anchorElement) {
        // Remove any existing picker first
        this.dismissFolderPicker();

        const tpl = document.getElementById('chatplus-folder-picker-template');
        const picker = tpl
            ? tpl.content.firstElementChild.cloneNode(true)
            : (() => {
                const el = document.createElement('div');
                el.className = 'chatplus-folder-picker';
                el.dataset.chatplusFolderPicker = '';
                return el;
            })();

        if (!folders || folders.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'chatplus-folder-picker-empty';
            empty.textContent = 'No folders yet';
            picker.appendChild(empty);
        } else {
            this._buildPickerTree(folders, picker, 0, onSelect, picker);
        }

        // Position near anchor
        document.body.appendChild(picker);
        this._positionPicker(picker, anchorElement);

        // Close on outside click (delayed to avoid catching the triggering click)
        const onOutsideClick = (e) => {
            if (!picker.contains(e.target) && !anchorElement.contains(e.target)) {
                cleanup();
            }
        };
        const onEscape = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                cleanup();
            }
        };
        const cleanup = () => {
            document.removeEventListener('pointerdown', onOutsideClick, true);
            document.removeEventListener('keydown', onEscape, true);
            picker.remove();
        };

        // Use requestAnimationFrame so the current click event doesn't trigger dismiss
        requestAnimationFrame(() => {
            document.addEventListener('pointerdown', onOutsideClick, true);
            document.addEventListener('keydown', onEscape, true);
        });

        // Store cleanup so dismissFolderPicker() can tear down listeners
        picker._cleanup = cleanup;

        return picker;
    }

    /**
     * Remove any open folder picker from the DOM.
     */
    dismissFolderPicker() {
        const existing = document.querySelector('[data-chatplus-folder-picker]');
        if (existing) {
            if (existing._cleanup) existing._cleanup();
            else existing.remove();
        }
    }

    /**
     * Recursively build folder rows inside the picker popover.
     * Uses the row template if available, falls back to createElement.
     * @private
     */
    _buildPickerTree(folders, container, depth, onSelect, pickerEl) {
        const rowTpl = document.getElementById('chatplus-folder-picker-row-template');

        for (const folder of folders) {
            let row;
            if (rowTpl) {
                row = rowTpl.content.firstElementChild.cloneNode(true);
                row.style.setProperty('--chatplus-picker-depth', String(depth));
                const nameSpan = row.querySelector('.chatplus-picker-row-name');
                if (nameSpan) nameSpan.textContent = folder.name || 'Unnamed Folder';
            } else {
                row = document.createElement('div');
                row.className = 'chatplus-folder-picker-item';
                row.style.setProperty('--chatplus-picker-depth', String(depth));
                const icon = document.createElement('i');
                icon.className = 'fa-solid fa-folder';
                icon.setAttribute('aria-hidden', 'true');
                row.appendChild(icon);
                const nameSpan = document.createElement('span');
                nameSpan.textContent = folder.name || 'Unnamed Folder';
                row.appendChild(nameSpan);
            }

            row.addEventListener('click', (e) => {
                e.stopPropagation();
                onSelect(folder.id);
                if (pickerEl._cleanup) pickerEl._cleanup();
                else pickerEl.remove();
            });

            container.appendChild(row);

            // Recurse into children
            if (folder.children && folder.children.length > 0) {
                this._buildPickerTree(folder.children, container, depth + 1, onSelect, pickerEl);
            }
        }
    }

    /**
     * Position the picker popover near the anchor element.
     * Prefers below-right; flips up if off-screen.
     * @private
     */
    _positionPicker(picker, anchor) {
        const rect = anchor.getBoundingClientRect();
        const gap = 4;

        // Start below-right of the anchor
        let top = rect.bottom + gap;
        let left = rect.left;

        // Measure after appending (already in DOM at this point)
        const pickerRect = picker.getBoundingClientRect();

        // Flip up if overflows viewport bottom
        if (top + pickerRect.height > window.innerHeight - 8) {
            top = rect.top - pickerRect.height - gap;
        }
        // Keep within horizontal bounds
        if (left + pickerRect.width > window.innerWidth - 8) {
            left = window.innerWidth - pickerRect.width - 8;
        }
        if (left < 8) left = 8;
        if (top < 8) top = 8;

        picker.style.top = `${top}px`;
        picker.style.left = `${left}px`;
    }

    // ─────────────────────────────────────────────────────────
    // EDIT MODE / BULK ACTIONS
    // ─────────────────────────────────────────────────────────

    /**
     * Create an edit-mode toggle button (pencil icon).
     * Caller is responsible for inserting it into the DOM.
     *
     * @param {Function} onToggle  Called with (active:boolean) when toggled
     * @returns {HTMLElement}
     */
    renderEditToggle(onToggle) {
        const btn = document.createElement('button');
        // Match `#chatplus-recent-reload` styling (step 43c) — both buttons
        // live in the same toolbar and must look identical.
        btn.className = 'menu_button chatplus-icon-btn chatplus-edit-toggle';
        btn.type = 'button';
        btn.title = 'Edit mode';
        btn.setAttribute('aria-label', 'Toggle edit mode');
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>';

        let active = false;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            active = !active;
            btn.classList.toggle('chatplus-edit-toggle--active', active);
            if (onToggle) onToggle(active);
        });

        return btn;
    }

    /**
     * Build a bulk-action toolbar shown inside the Recent tab toolbar
     * while edit mode is active.
     *
     * Only the action buttons are rendered here; the "N selected" count
     * and select-all affordance live elsewhere:
     *   - count  → `.chatplus-recent-selected-hint` under the search bar
     *   - select-all → removed (per UX revision, 2026-04-24)
     *
     * @param {Array<{label:string, icon:string, action:string, danger?:boolean}>} actions
     *   e.g. [{ label:'Delete', icon:'fa-solid fa-trash', action:'delete', danger:true }]
     * @param {Object}   [options]
     * @param {Function} [options.onAction] Called with (actionName) when a toolbar button is clicked
     * @returns {HTMLElement}
     */
    renderBulkToolbar(actions, options = {}) {
        const { onAction } = options;

        const toolbar = document.createElement('div');
        toolbar.className = 'chatplus-bulk-toolbar';

        // ── Action buttons ───────────────────────────────────────
        for (const a of actions) {
            const btn = document.createElement('button');
            btn.className = 'chatplus-bulk-btn';
            if (a.danger) btn.classList.add('chatplus-bulk-btn--danger');
            btn.type = 'button';
            btn.title = a.label;
            btn.innerHTML = `<i class="${a.icon}" aria-hidden="true"></i> ${CoreAPI.escapeHtml(a.label)}`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (onAction) onAction(a.action);
            });
            toolbar.appendChild(btn);
        }

        return toolbar;
    }

    // ─────────────────────────────────────────────────────────────
    // PRIVATE HELPERS
    // ─────────────────────────────────────────────────────────────

    /**
     * "CharacterName: filename" for characters; "👥 GroupName: filename" for
     * group chats so the entry is visually distinct in Recent / Folder views.
     *
     * Pass `includeEntityPrefix: false` to render just the filename
     * (used by Recent's grouped main list, where the character is named
     * by a `renderCharacterSeparator()` row above).
     * @private
     */
    _buildLabel(chat, { includeEntityPrefix = true } = {}) {
        const fileName = chat.file_name || 'Unnamed Chat';
        if (!includeEntityPrefix) return fileName;
        const charName = chat.character_name || 'Unknown';
        const prefix = chat.is_group ? '👥 ' : '';
        return `${prefix}${charName}: ${fileName}`;
    }

    /**
     * Avatar element — single image for characters, collage for groups.
     * @private
     */
    _buildAvatar(chat) {
        const wrap = document.createElement('div');
        wrap.className = 'chatplus-chat-avatar';

        if (chat.group_id && chat.entity) {
            wrap.classList.add('chatplus-chat-avatar--group');
            const groupEl = CoreAPI.getGroupAvatarElement(chat.entity);
            if (groupEl) {
                wrap.appendChild(groupEl);
            } else {
                wrap.appendChild(this._fallbackImg(chat.character_name || 'Group'));
            }
        } else {
            const img = document.createElement('img');
            img.className = 'chatplus-avatar-img';
            img.alt = chat.character_name || 'Character';
            img.loading = 'lazy';
            img.onerror = () => { img.src = '/img/ai4.png'; };

            const ctx = CoreAPI.getContext();
            if (ctx?.getThumbnailUrl && chat.avatar) {
                img.src = ctx.getThumbnailUrl('avatar', chat.avatar);
            } else if (chat.avatar) {
                img.src = `/characters/${chat.avatar}`;
            } else {
                img.src = '/img/ai4.png';
            }

            wrap.appendChild(img);
        }

        return wrap;
    }

    /**
     * Action buttons row (rename + pin toggle).
     * @private
     */
    _buildChatActions(chat, chatKey, { isPinned, onPin, onRename, onRemoveFromFolder, onAddToFolder, onDelete, editMode }) {
        const actions = document.createElement('div');
        actions.className = 'chatplus-chat-actions';

        if (onRename) {
            actions.appendChild(
                this._makeActionBtn('fa-solid fa-pencil-alt', 'Rename chat', (e) => {
                    e.stopPropagation();
                    onRename(chat, chatKey);
                })
            );
        }

        if (onPin) {
            const pinBtn = this._makeActionBtn(
                isPinned ? 'fa-solid fa-thumbtack' : 'fa-regular fa-thumbtack',
                isPinned ? 'Unpin chat' : 'Pin chat',
                (e) => {
                    e.stopPropagation();
                    onPin(chat, chatKey);
                }
            );
            if (isPinned) pinBtn.classList.add('chatplus-action-btn--pinned');
            // Data attribute lets _handlePinToggle in RecentChatsView find this button
            pinBtn.dataset.pinBtn = '';
            actions.appendChild(pinBtn);
        }

        if (onAddToFolder) {
            // Plain `fa-folder` — `fa-folder-plus` is reserved for
            // folder-creation controls (step 37, step 43e).
            const folderPlusBtn = this._makeActionBtn('fa-solid fa-folder', 'Add to folder', (e) => {
                e.stopPropagation();
                onAddToFolder(chat, chatKey, folderPlusBtn);
            });
            folderPlusBtn.dataset.folderPlusBtn = '';
            actions.appendChild(folderPlusBtn);
        }

        if (onRemoveFromFolder) {
            const removeBtn = this._makeActionBtn('fa-solid fa-xmark', 'Remove from folder', (e) => {
                e.stopPropagation();
                onRemoveFromFolder(chat, chatKey);
            });
            removeBtn.classList.add('chatplus-action-btn--danger');
            actions.appendChild(removeBtn);
        }

        if (onDelete) {
            const deleteBtn = this._makeActionBtn('fa-solid fa-trash', 'Delete chat', (e) => {
                e.stopPropagation();
                onDelete(chat, chatKey);
            });
            deleteBtn.classList.add('chatplus-action-btn--danger');
            // Only show in edit mode or always show based on caller
            if (!editMode) deleteBtn.classList.add('chatplus-hidden');
            deleteBtn.dataset.deleteBtn = '';
            actions.appendChild(deleteBtn);
        }

        return actions;
    }

    /**
     * Create a small icon action button.
     * @param {string}   iconClass  FontAwesome class string (e.g. "fa-solid fa-pencil-alt")
     * @param {string}   title      Accessible tooltip text
     * @param {Function} handler    Click event handler
     * @private
     */
    _makeActionBtn(iconClass, title, handler) {
        const btn = document.createElement('button');
        btn.className = 'chatplus-action-btn';
        btn.title = title;
        btn.type = 'button';
        btn.setAttribute('aria-label', title);
        btn.innerHTML = `<i class="${iconClass}" aria-hidden="true"></i>`;
        btn.addEventListener('click', handler);
        return btn;
    }

    /**
     * Fallback img element used when group avatar generation fails.
     * @private
     */
    _fallbackImg(alt) {
        const img = document.createElement('img');
        img.className = 'chatplus-avatar-img';
        img.alt = alt;
        img.src = '/img/ai4.png';
        return img;
    }
}

export default UIRenderer;
