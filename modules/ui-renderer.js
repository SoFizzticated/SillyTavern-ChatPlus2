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
     * @param {Function} [options.onOpen]            Called with (chat) when the row is tapped
     * @param {Function} [options.onPin]             Called with (chat, chatKey) when pin toggled
     * @param {Function} [options.onRename]          Called with (chat, chatKey) when rename pressed
     * @returns {HTMLElement|null}
     */
    renderChatItem(chat, options = {}) {
        const { isPinned = false, isActive = false, onOpen, onPin, onRename } = options;

        try {
            const chatKey = ChatIdentifier.getChatKey(chat);

            const item = document.createElement('div');
            item.className = 'chatplus-chat-item';
            if (isPinned) item.classList.add('chatplus-chat-item--pinned');
            if (isActive) item.classList.add('chatplus-chat-item--active');
            item.dataset.chatKey = chatKey;

            // ── Avatar ──────────────────────────────────────────────────
            item.appendChild(this._buildAvatar(chat));

            // ── Info block ──────────────────────────────────────────────
            const info = document.createElement('div');
            info.className = 'chatplus-chat-info';

            // Top row: "Character: filename" label + action buttons
            const topRow = document.createElement('div');
            topRow.className = 'chatplus-chat-top-row';

            const label = document.createElement('span');
            label.className = 'chatplus-chat-label';
            label.textContent = this._buildLabel(chat);
            topRow.appendChild(label);

            topRow.appendChild(this._buildChatActions(chat, chatKey, { isPinned, onPin, onRename }));
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

            // Footer row: relative timestamp · message count
            const footer = this._buildChatFooter(chat);
            if (footer) info.appendChild(footer);

            item.appendChild(info);

            // ── Tap / click to open ─────────────────────────────────────
            // Ignore clicks originating from the action buttons zone
            item.addEventListener('click', (e) => {
                if (e.target.closest('.chatplus-chat-actions')) return;
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

    // ─────────────────────────────────────────────────────────────
    // FOLDERS
    // ─────────────────────────────────────────────────────────────

    /**
     * Build a folder row element (collapsed by default).
     *
     * Nesting depth is passed via a CSS custom property `--chatplus-depth`
     * so the caller can just set `level` and CSS handles indentation.
     *
     * Children are NOT rendered here — the caller should append child elements
     * to the returned element's `.chatplus-folder-children` container after
     * expanding. A 'folder-expand' event is dispatched on the element when
     * the user opens it for the first time.
     *
     * @param {Object}   folder
     * @param {string}   folder.id
     * @param {string}   folder.name
     * @param {number}   [level=0]       Nesting depth
     * @param {Object}   [options]
     * @param {Function} [options.onExpand]  Called with (folderId) when opened
     * @param {Function} [options.onRename]  Called with (folder) when rename pressed
     * @param {Function} [options.onDelete]  Called with (folder) when delete pressed
     * @returns {HTMLElement}
     */
    renderFolder(folder, level = 0, options = {}) {
        const { onExpand, onRename, onDelete } = options;

        const el = document.createElement('div');
        el.className = 'chatplus-folder-item';
        el.dataset.folderId = folder.id;
        el.style.setProperty('--chatplus-depth', String(level));

        // ── Header row ──────────────────────────────────────────────
        const header = document.createElement('div');
        header.className = 'chatplus-folder-header';

        // Expand chevron
        const toggle = document.createElement('span');
        toggle.className = 'chatplus-folder-toggle';
        toggle.innerHTML = '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';
        header.appendChild(toggle);

        // Folder icon (switches on expand)
        const iconEl = document.createElement('span');
        iconEl.className = 'chatplus-folder-icon';
        iconEl.innerHTML = '<i class="fa-solid fa-folder" aria-hidden="true"></i>';
        header.appendChild(iconEl);

        // Folder name
        const nameEl = document.createElement('span');
        nameEl.className = 'chatplus-folder-name';
        nameEl.textContent = folder.name || 'Unnamed Folder';
        header.appendChild(nameEl);

        // Action buttons (rename, delete)
        const actions = document.createElement('div');
        actions.className = 'chatplus-folder-actions';

        if (onRename) {
            actions.appendChild(
                this._makeActionBtn('fa-solid fa-pencil-alt', 'Rename folder', (e) => {
                    e.stopPropagation();
                    onRename(folder);
                })
            );
        }
        if (onDelete) {
            const deleteBtn = this._makeActionBtn('fa-solid fa-trash', 'Delete folder', (e) => {
                e.stopPropagation();
                onDelete(folder);
            });
            deleteBtn.classList.add('chatplus-action-btn--danger');
            actions.appendChild(deleteBtn);
        }

        header.appendChild(actions);
        el.appendChild(header);

        // ── Children container ──────────────────────────────────────
        const children = document.createElement('div');
        children.className = 'chatplus-folder-children';
        children.hidden = true;
        el.appendChild(children);

        // ── Toggle expand / collapse ────────────────────────────────
        let hasLoadedChildren = false;
        header.addEventListener('click', (e) => {
            if (e.target.closest('.chatplus-folder-actions')) return;

            const expanded = el.classList.toggle('chatplus-folder-item--expanded');
            children.hidden = !expanded;
            iconEl.innerHTML = expanded
                ? '<i class="fa-solid fa-folder-open" aria-hidden="true"></i>'
                : '<i class="fa-solid fa-folder" aria-hidden="true"></i>';

            if (expanded && !hasLoadedChildren) {
                hasLoadedChildren = true;
                if (onExpand) onExpand(folder.id, children);
            }
        });

        return el;
    }

    // ─────────────────────────────────────────────────────────────
    // PRIVATE HELPERS
    // ─────────────────────────────────────────────────────────────

    /**
     * "CharacterName: filename" — mirrors v1 display format.
     * @private
     */
    _buildLabel(chat) {
        const charName = chat.character_name || 'Unknown';
        const fileName = chat.file_name || 'Unnamed Chat';
        // For group chats with 👥 prefix, the character_name already includes it
        return `${charName}: ${fileName}`;
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
     * Footer row: relative timestamp, message count.
     * Returns null when no data is available.
     * @private
     */
    _buildChatFooter(chat) {
        const lastDate = chat.stats?.lastMessageDate;
        const msgCount = chat.stats?.messageCount;
        if (!lastDate && msgCount == null) return null;

        const footer = document.createElement('div');
        footer.className = 'chatplus-chat-footer-row';

        if (lastDate) {
            const ts = document.createElement('span');
            ts.className = 'chatplus-chat-timestamp';
            ts.textContent = CoreAPI.getRelativeTime(lastDate);
            footer.appendChild(ts);
        }

        if (msgCount != null) {
            const count = document.createElement('span');
            count.className = 'chatplus-chat-count';
            count.textContent = `· ${msgCount} msg${msgCount !== 1 ? 's' : ''}`;
            footer.appendChild(count);
        }

        return footer;
    }

    /**
     * Action buttons row (rename + pin toggle).
     * @private
     */
    _buildChatActions(chat, chatKey, { isPinned, onPin, onRename }) {
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
