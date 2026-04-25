## Plan: ChatPlus 2 - Full Architectural Rewrite

ChatPlus 2 will transform the monolithic v1 extension into a modular, maintainable architecture. The rewrite addresses critical issues: unstable characterId usage, heavy HTML injection, timing dependencies, and event handling fragility. Using patterns from CharacterLibrary (CoreAPI abstraction, separate HTML) and Leits-Lab (class-based modules), we'll build a scalable foundation with avatar-based chat identification, separated concerns, and proper event-driven architecture.

**Key Architectural Decisions:**

- **UI**: Inject tabs into existing ST character menu (v1 style, but cleaner)
- **Templates**: Separate HTML files for maintainability
- **Identity**: Avatar-based chat keys (stable across renames/duplicates)
- **Modules**: Class-based with CoreAPI abstraction layer
- **Migration**: Auto-detect v1 settings with user confirmation
- **Events**: Complete rewrite to eliminate setTimeout race conditions

**Steps**

1. **Create foundational file structure** ✅ COMPLETE
   - Set up SillyTavern-ChatPlus2/manifest.json with proper metadata, loading order
   - Create SillyTavern-ChatPlus2/index.js as lightweight entry point (<200 lines)
   - Add folders: `app/`, `modules/`, `utils/`
   - Create manifest.json following SillyTavern specs (display_name, version, js/css paths, author)

2. **Build HTML template structure** ✅ COMPLETE
   - Create app/chatplus.html with complete tab structure (Characters, Recent, Folders tabs)
   - Define pre-structured DOM: tab buttons, content areas, filter bars, chat list containers
   - Add data attributes for JavaScript hooks (`data-tab`, `data-chat-key`, etc.)
   - Create app/chatplus.css for styling
   - Create app/chatplus-mobile.css for responsive design

3. **Implement ChatIdentifier utility (critical foundation)** ✅ COMPLETE
   - Created utils/chat-identifier.js with comprehensive API
   - Implemented `getChatKey(chat)` returning `${avatar}:${file_name}` format
   - Added `parseChatKey(key)` to extract avatar and filename
   - Included validation and edge case handling (missing avatar, group chats)
   - Added utility functions: `getEntityByAvatar()`, `isValidChat()`, `chatKeyMatchesAvatar()`, etc.
   - Created examples file demonstrating usage patterns
   - **Key advantage**: Avatar-based keys are stable across character renames, unlike v1's characterId

4. **Build StateManager module** ✅ COMPLETE
   - Create modules/state-manager.js as class
   - Implement settings schema: `{pinnedChats: [], folders: [], chatFolders: {}, defaultTab: 'recent', enabled: true}`
   - Add `load()` to initialize from `extensionSettings.chatPlus2`
   - Add `save()` with `saveSettingsDebounced()` integration
   - Include `get(key)` and `set(key, value)` methods
   - Build v1 migration detector: check for `extensionSettings.chatsPlus`, convert characterId keys to avatar keys
   - Additional utilities: `exportSettings()`, `importSettings()`, `backupV1Settings()`, `markMigrationCompleted()`

5. **Create CoreAPI abstraction layer** ✅ COMPLETE
   - Create modules/core-api.js
   - Export functions modules will use: `getAllChats()`, `getChatByKey(key)`, `openChat(chat)`, `updateUI()`, `showToast(msg, type)`
   - Add `getStateManager()`, `getChatRepository()` for accessing other modules
   - Use this pattern from CharacterLibrary to prevent direct dependencies
   - All other modules import only CoreAPI, never SillyTavern internals directly
   - Implemented module registry system, ST context access, chat operations, UI operations, event system, and utilities

6. **Implement ChatRepository module** ✅ COMPLETE
   - Create modules/chat-repository.js as class
   - Implement `fetchAllChats()` with parallel promises for characters and groups (from v1 pattern)
   - Add caching layer with `chatCache` Map indexed by chat keys
   - Include `getChatStats(chat)` for last message, timestamp, message count
   - Handle both character chats (`/api/characters/chats`) and group chats (`/api/groups/all`)
   - Add `rebuildIndex()` method called on CHARACTER_RENAMED/DELETED events
   - Additional features: `searchChats()`, `getAllChatsWithStats()`, avatar-based indexing, cache invalidation

7. **Build PinnedChatsManager module** ✅ COMPLETE
   - Create modules/pinned-chats.js as class
   - Constructor takes `StateManager` instance
   - Implement `pin(chat)`, `unpin(chat)`, `isPinned(chatKey)`, `getAllPinned()`
   - Store as array of chat keys (avatar-based) in state
   - Alphabetical sorting by character name and filename
   - Trigger UI updates via CoreAPI events
   - Additional features: `togglePin()`, `cleanOrphanedPins()`, `updatePinnedKey()`, `clearAllPins()`, `importPins()`, `exportPins()`, `reorderPin()`

8. **Build FolderSystemManager module** ✅ COMPLETE
   - Create modules/folder-system.js as class
   - Implement folder CRUD: `createFolder(name, parent)`, `renameFolder(id, name)`, `deleteFolder(id)`
   - Add `assignChatToFolder(chatKey, folderId)`, `removeChatFromFolder(chatKey, folderId)`
   - Support nested folders with parent-child relationships
   - Multi-folder assignment per chat (many-to-many mapping)
   - Include `getFolderHierarchy()` for tree rendering
   - Validate circular parent references
   - Additional features: `moveFolder()`, `getChatFolders()`, `getFolderChats()`, `getFolderPath()`, `searchFolders()`, `cleanOrphanedAssignments()`

9. **Implement RecentChatsView module** ✅ COMPLETE
   - Create modules/recent-chats.js as class
   - Implement pagination system (100 chats per page)
   - Add `loadMore()` for "Load More" button functionality
   - Generate date separators grouping by day (using `SillyTavern.libs.moment`)
   - Sort chats by last message timestamp descending
   - Render chat items with avatar, character name, filename, last message preview
   - Extracted and replaced inline `renderRecentTab()` / `_createChatItem()` in coordinator
   - Added meta column (relative timestamp + message count), pinned item highlighting, sticky date separators

10. **Create TabController module** ✅ COMPLETE
    - Created modules/tab-controller.js
    - Manages tab switching between Characters, Recent, Folders
    - Reads/persists `defaultTab` via StateManager
    - `activateTab(name)` method wires DOM + emits `CoreAPI.emit('tab-activated')`
    - RecentChatsView subscribes to `tab-activated` for lazy first-render
    - Listens for CHAT_CHANGED → re-emits as internal `chat-changed` event
    - Removed `initializeTabSwitching()` from index.js; wired into chatplus.js Phase 3/4

11. **Build SearchFilter module** ✅ COMPLETE
    - Created modules/search-filter.js as class
    - Debounced input handler (300ms) via CoreAPI.debounce
    - Wires #chatplus-recent-search/clear and #chatplus-folders-search/clear on init()
    - Clear (✕) button auto-shows/hides based on input state
    - Emits 'search-filter-changed' CoreAPI event: { tab, query }
    - filterChats(chats, query) filters by character_name, file_name, stats.lastMessage
    - filterFolders(folders, query) filters by folder name
    - destroy() removes all DOM listeners for clean teardown
    - RecentChatsView subscribes to 'search-filter-changed' and calls applyFilter()
    - When filter active: all matching results rendered at once (no pagination), date separators hidden
    - When filter cleared: pagination and date separators restored

12. **Implement UIRenderer module** ✅ COMPLETE
    - Created modules/ui-renderer.js as stateless DOM factory
    - `renderChatItem(chat, options)` — label row (CharName: filename), action buttons (rename pencil + pin thumbtack), preview line, footer row (timestamp · msg count)
    - `renderFolder(folder, level, options)` for nested folder display
    - `renderDateSeparator(label)`, `renderSectionHeader(text, modifier)`, `renderLoadingSpinner()`, `renderEmptyMessage(msg)`
    - Mobile-first CSS rewrite: action buttons always visible on mobile, hidden-until-hover on desktop via `(hover: hover)` media query
    - Full rewrite of app/chatplus.css (chat items section) and app/chatplus-mobile.css (4 responsive breakpoints)
    - RecentChatsView refactored to instantiate and use UIRenderer; pin/rename handlers wired
    - chatplus.js updated to import, register, and destroy UIRenderer

13. **Rewrite event handling system** ✅ COMPLETE
    - Created utils/event-handlers.js with `EventHandlers` class
    - `register()` subscribes to 5 ST events; stores unsubscribe callbacks from `CoreAPI.onSTEvent()`
    - `destroy()` calls all unsubscribers for clean teardown (no memory leaks)
    - `_onCharacterRenamed` — `invalidateAvatar` + `cleanOrphanedPins` + `cleanOrphanedAssignments` + `refresh()`
    - `_onCharacterDeleted` — same pipeline as rename
    - `_onCharacterDuplicated` — `rebuildIndex()` (async) then `refresh()`
    - `_onChatChanged` — broadcasts `CoreAPI.emit('chat-changed', data)` for decoupled consumers
    - `_onSettingsLoadedAfter` — `stateManager.load()` to pick up external settings changes
    - chatplus.js updated: `setupEventListeners()` delegates entirely to EventHandlers; removed three inline `_handle*` stub methods; `destroy()` now calls `eventHandlers.destroy()`

14. **Build main coordinator (chatplus.js)** ✅ COMPLETE
    - Create app/chatplus.js
    - Import and instantiate all modules: StateManager, ChatRepository, PinnedChatsManager, FolderSystemManager, TabController, etc.
    - Wire modules together via CoreAPI
    - Initialize in correct order: StateManager → ChatRepository → Feature modules → UI modules → Event handlers
    - Expose public API through CoreAPI for potential future extensions
    - Handle enable/disable toggle from settings

15. **Create settings UI panel** ✅ COMPLETE
    - Settings template in app/chatplus.html inside a `<template>` tag, extracted and injected by index.js
    - Build settings panel injected into `#extensions_settings2`
    - Add controls: Enable/Disable toggle, Default tab selector, Manual reload button
    - Include Import/Export buttons for settings backup
    - Migration notification if v1 settings detected with "Migrate Now" button (placeholder for step 16)
    - Uses ST's inline-drawer convention with FA icons
    - Settings panel always injected (even when disabled) so users can re-enable
    - TabController no longer overwrites defaultTab on every tab switch

16. **Implement v1 settings migration** ✅ COMPLETE
    - Created utils/migration.js with `MigrationHelper` class (non-destructive, idempotent)
    - `_buildCharacterIdToAvatarMap()` maps v1 characterIds (array indices for characters, group.id for groups) to v2 avatar strings via `CoreAPI.getContext().characters` and `CoreAPI.getAllGroups()`
    - `_convertPinnedChats()` converts `[{ characterId, file_name }]` → `["avatar:filename"]`; unmapped entries tracked separately
    - `_convertChatFolders()` converts `{ "charId:filename": [folderIds] }` → `{ "avatar:filename": [folderIds] }`; splits on first colon, unions folder IDs for duplicate keys
    - `_upgradeFolders()` adds v2 schema fields (`children[]`, `created`, `modified`); two-pass build populates `children` from parent refs; orphans invalid parents to root
    - `migrate()` pipeline: pre-check → backup v1 to `chatsPlusV1Backup` → read v1 → build ID map → convert all → merge into v2 (deduplicated union, never overwrite) → validate chatFolder references (strip invalid folder IDs) → mark complete → immediate save → return summary
    - Unmapped references planted as synthetic keys (`"<characterId>:filename"`) so Lost & Found detects them as orphans automatically — zero changes needed to `lost-and-found.js`
    - Wired into index.js: "Migrate Now" button → confirmation dialog → spinner → dynamic import of MigrationHelper → run migration → summary toast → hide migration section → force UI refresh (chat repository + recent + folders views) → post-migration L&F scan (compares orphan count before/after; only opens resolver if new orphans appeared)
    - **Non-destructive guarantees**: v1 data never modified or deleted; backup is separate copy; existing v2 data merged not replaced; `markMigrationCompleted()` is last write so partial failures are retryable; all merge logic is idempotent (Set dedup for pins, union for folder IDs, ID-check for folders)
    - Early exit for empty v1 data (marks complete, "No v1 data" toast)

17. **Add error handling and logging** ➡️ SKIPPED
    - Wrap API calls in try-catch with user-friendly error messages
    - Use `toastr.error()` for user-facing errors
    - Add `console.debug()` logging with `[ChatPlus2]` prefix
    - Graceful degradation if features fail (e.g., if folder load fails, still show recent chats)
    - Validate data integrity on load (check for corrupted chatFolders references)

18. **Polish entry point (index.js)** ✅ COMPLETE
    - Load HTML template from app/chatplus.html via fetch
    - Inject into `#rm_print_characters_block` (existing ST character menu area)
    - Import app/chatplus.js dynamically
    - Listen to `APP_READY` event before initialization
    - Check settings.enabled flag—if false, skip all initialization
    - Initialize with `await chatPlus.init()` pattern

19. **Implement Lost & Found chat reconciliation system** ✅ COMPLETE
    - Created modules/lost-and-found.js (not utils/) with full orphan detection and reconciliation
    - `detectOrphanedReferences()` scans pinnedChats and chatFolders for invalid keys
    - `findCandidates(orphan)` matches by avatar + prefix similarity, sorted by most recent first
    - Confidence scoring: high (single candidate), medium (shared filename prefix ≥10), low
    - Resolution API: `applyResolution()`, `applyBatchResolutions()`, `resolveStaleKey()`
    - Interactive resolver UI with batch "Auto-Reconnect Obvious" + "Apply All"
    - SnapshotStore integration: shows stored last message on orphan cards, updates keys on relink/remove
    - **Note**: This system is critical because chat filenames are user-editable in ST, unlike avatars

    **19a. Lost & Found Revamp — Phase 1: File Splitting** ✅ COMPLETE
    - Split chatplus.html → chatplus.html (tabs-only) + app/settings.html + app/lostfound.html
    - Split chatplus.css → chatplus.css (tabs+shared, mobile inlined) + app/settings.css + app/lostfound.css
    - Refactored index.js: `fetchTemplate()` + `loadAllTemplates()` (parallel 3-file fetch)
    - chatplus-mobile.css orphaned (no longer imported), kept for reference

    **19b. Lost & Found Revamp — Phase 2: Last Message Snapshots** ✅ COMPLETE
    - Created modules/snapshot-store.js — persistent pseudo-DB via `/api/files/upload`
    - File: `chatplus2-snapshots.json` in `user/files/`, format: `{ version: 1, snapshots: { [chatKey]: { lastMessage, updatedAt } } }`
    - Debounced writes (1500ms), `flush()` for teardown, base64 encoding for upload
    - Read/write API: `getSnapshot()`, `setSnapshot()`, `removeSnapshot()`, `updateKey()`, `bulkUpdate()`, `prune()`
    - Event hooks: `onChatChanged()`, `onMessageReceived()` (stubs), `onChatTracked()` (implemented)
    - Added `getSnapshotStore()` to core-api.js
    - Wired into coordinator (chatplus.js): Phase 2 init, Phase 3 bootstrap, destroy flush
    - Wired into event-handlers.js: `chat-pinned`, `chat-assigned-to-folder` → `onChatTracked()`, `CHAT_CHANGED` → `onChatChanged()`
    - Integrated into lost-and-found.js: stored message in orphan cards, `updateKey()` on relink, `removeSnapshot()` on remove

    **19c. Lost & Found Revamp — Phase 3: Resolver UI Redesign** ✅ COMPLETE
    - Rewrote lostfound.html: pagination nav (prev/next + "1/N"), single-card viewport, removed "Discard All"
    - Rewrote lostfound.css mobile-first: bottom-sheet on mobile (100vw, 85vh), centered modal on desktop (≥768px), z-index 9000
    - Collapsible cards: header (avatar + name + filename + badges + chevron) always visible, content toggled
    - Scrollable excerpts: stored snapshot in before-section, selected candidate in after-section (no truncation)
    - Actions: [Ignore for now] left + [Reconnect] right. Discard removed from UI (kept `_remove()` for programmatic use)
    - Candidates sorted by most recent first via `lastMessageDate`

20. **Tab navigation polish — icons and label overflow** ✅ COMPLETE
    - Replaced emoji tab icons (👥, 🕒, 📁) with Font Awesome `<i>` tags: `fa-users`, `fa-clock-rotate-left`, `fa-folder-tree`
    - Added `title` attributes to each tab button for tooltip accessibility in compact mode
    - Implemented `ResizeObserver` in TabController (`_checkCompactMode()`) to auto-toggle `.chatplus-tabs--compact` class when tab buttons overflow
    - CSS hides `.chatplus-tab-label` in compact mode; removed redundant `@media (max-width: 480px)` label-hiding rule
    - Icon-only buttons retain sufficient touch targets

21. **Recent tab entry streamlining — reduce information density** ✅ COMPLETE
    - Removed `_buildChatFooter()` method and call from `UIRenderer` entirely
    - Removed CSS rules for `.chatplus-chat-footer-row`, `.chatplus-chat-timestamp`, `.chatplus-chat-count`
    - Net result: each chat item renders avatar · label · preview · action buttons only

22. **Folder tab overhaul — subfolder creation and chat assignment UI** ✅ COMPLETE
    - **Configurable page size (C1)**: Added `pageSize` to StateManager defaults; "Chats Per Page" `<select>` in settings.html (25/50/100/200); wired in index.js; RecentChatsView reads dynamically via `get pageSize()` getter
    - **Always-expanded folders (C2)**: `UIRenderer.renderFolder()` accepts `expanded` option; folders with chats or sub-folders start expanded, truly empty folders start collapsed
    - **Gear toggle (C2 refinement)**: Gear button (`fa-gear`) in folder header actions (after delete); toggles visibility of content manager panel; `.chatplus-action-btn--cm-active` highlights gear when panel is visible; resets on re-render
    - **Content manager panel (C3)**: Operations panel inside each folder's children container (hidden by default, gear-toggled):
      - Toolbar: "Contents" / "Add Chats" tab buttons + "+ Subfolder" button
      - Contents tab: assigned chats with per-item `×` remove button; calls `removeChatFromFolder()` + re-renders
      - Add Chats tab (lazy-built): `getAllChatsWithStats()` → filter out assigned → paginated with `pageSize` → compact checkbox items (`renderChatItemCompact()`) → 300ms debounced search → "Add Selected" → `assignChatToFolder()` + toast
    - **Subfolder creation**: "+ Subfolder" button prompts for name → `createFolder(name, parentId)` → `folders-changed` event → full re-render
    - **Folder layout**: operations panel renders first (hidden), then sub-folders, then assigned chats — chats and sub-folders always visible when folder is open
    - **Rich empty message**: empty folders show inline gear icon + clickable "Add Chats" link that opens operations panel and switches to Add Chats tab
    - **Integration (C5)**: FoldersView listens to both `folders-changed` and `chat-folders-changed` events for full reactivity; `chatplus.js` passes both `folderSystemManager` and `chatRepository` to FoldersView constructor
    - **Deferred to step 22a**: "Assign to folder" picker from Recent tab (C4)

23. **(22a) "Assign to folder" picker from Recent tab** ✅ COMPLETE
    - ui-renderer.js:
      - Add `renderFolderPicker(folders, onSelect, anchorElement)` — positioned popover near anchor, nested folder list indented by depth, click to select → `onSelect(folderId)` → auto-close. Closes on outside click or Escape. Empty state: "No folders yet".
      - Add `onAddToFolder(chat, chatKey, anchorBtn)` callback option to `renderChatItem()` — renders a `fa-folder-plus` icon button in actions; hidden/disabled when no folders exist.
    - recent-chats.js — In `_renderPage()` and `_renderPinnedSection()`: pass `onAddToFolder` callback. Handler: fetch hierarchy → call `renderFolderPicker()` → on select: `assignChatToFolder()` + toast.
    - chatplus.css — Rules for `.chatplus-folder-picker` (positioned, max-height scroll, z-index), `.chatplus-folder-picker-item` (indented rows, hover).

24. **(22b) Folders-view HTML migration — move DOM construction to templates** ✅ COMPLETE
    - The current FoldersView and its content manager panel build all DOM elements entirely via `document.createElement()` in JavaScript. This is the same pattern that the codebase was earlier migrated away from for the main tabs, settings, and Lost & Found panels (steps 2, 15, 19a). Migrate the folders DOM to a template-based approach for consistency and maintainability.
    - **New file**: `app/folders.html` — a `<template id="chatplus-folders-template">` containing:
      - The content manager panel skeleton: `.chatplus-folder-content-manager` → `.chatplus-folder-cm-bar` (Contents / Add Chats / Subfolder buttons) + `.chatplus-cm-panel[data-cm-panel="contents"]` + `.chatplus-cm-panel[data-cm-panel="add"]` (search bar, list container, footer, load-more)
      - The rich empty-folder message structure (with gear icon and "Add Chats" link placeholder)
      - The folder item skeleton: `.chatplus-folder-item` → `.chatplus-folder-header` (toggle, icon, name, actions) + `.chatplus-folder-children`
    - **index.js**: add `folders.html` to `loadAllTemplates()` parallel fetch
    - **folders-view.js**: refactor `_buildContentManager()`, `_buildEmptyFolderMessage()`, and `_buildAddChatsPanel()` to clone template fragments and wire event listeners onto the pre-built DOM, rather than constructing every element from scratch
    - **ui-renderer.js**: refactor `renderFolder()` to optionally clone a folder item template fragment if available, falling back to current `createElement` approach
    - The goal is to reduce the ~200 lines of procedural DOM construction in folders-view.js to template cloning + data-binding, mirroring how `lostfound.html` and `settings.html` already work

25. **Edit mode and multi-select for Recent & Folder content views** ✅ COMPLETE
    - Add an "Edit" toggle button (`fa-solid fa-pen-to-square`) to the Recent tab header and to each Folder's content-manager expanded area
    - **Edit mode on**:
      - A checkbox appears on the left of every chat item (in the respective list)
      - A bulk-action toolbar slides in below the search bar / folder header with contextual actions:
        - Recent tab: "Add to folder", "Pin selected", "Unpin selected", "Delete selected"
        - Folder contents view: "Remove from folder", "Delete selected"
      - A "Select all" checkbox in the toolbar header selects/deselects all visible items
      - "Select all for this character" is a secondary option in the toolbar (groups by `avatar`, selects all chats sharing an avatar) — this addresses the v1 user request for selecting chats per character
      - Group chats are fully supported: grouped under their group name/avatar
    - **Edit mode off**: checkboxes hidden, toolbar removed, normal tap-to-open behaviour restored
    - Edit mode state is ephemeral (not persisted), reset when switching tabs or navigating away
    - The edit toggle button is implemented in `TabController` for the Recent tab header; `FoldersView` manages its own toggle per expanded folder
    - Multi-select state tracked in-memory in the respective view class

26. **Chat deletion support** ✅ COMPLETE
    - Add a "Delete chat" button (`fa-solid fa-trash`) to each chat item's action row; hidden by default in normal mode, visible in edit mode (or optionally always-visible behind a hold/long-press on mobile)
    - Single-chat delete: confirm dialog ("Delete this chat? This cannot be undone.") → `CoreAPI.deleteChat(chat)` → remove item from DOM optimistically → invalidate `ChatRepository` cache entry → toast confirmation
    - Bulk delete (from edit mode): confirm dialog showing the count ("Delete 5 chats? This cannot be undone.") → delete sequentially via `CoreAPI.deleteChat()` → refresh the view on completion
    - `CoreAPI.deleteChat(chat)` wraps the appropriate SillyTavern API call; add this to `core-api.js`
    - After deletion: pins and folder assignments for the affected chat keys are cleaned up via `cleanOrphanedPins()` and `cleanOrphanedAssignments()`, same pipeline as CHARACTER_DELETED
    - This renders the built-in ST chat management window unnecessary for the majority of users' needs

27. **Complete group chat support audit** ✅ COMPLETE
    - **Phase 1 — Critical API bug fixes** (affected all chats, not just groups):
      - `modules/core-api.js` `renameChat(avatar, old, new, isGroup)` — fixed field names to `original_file` / `renamed_file`, added `is_group` body flag, auto-appends `.jsonl`
      - `modules/core-api.js` `deleteChat(avatar, chatFile, isGroup)` — fixed character branch to use `chatfile` (was `file_name`); added group branch calling `/api/chats/group/delete` with `{ id }`
      - `modules/recent-chats.js` — all three callers (rename at L424, single-delete, bulk-delete) updated to pass `!!chat.is_group`
    - **Phase 2 — Stable group identity**:
      - `modules/chat-repository.js` `_fetchGroupChats()` — `groupAvatar` now always `String(group.id)` (immutable timestamp); mutable display avatar stored separately as `display_avatar` on the chat object
      - `utils/chat-identifier.js` `getEntityByAvatar()` — now matches group by `String(g.id)` first, with legacy `avatar_url` / `avatar` fallback for backwards compatibility
      - `modules/chat-repository.js` `remapStaleGroupKeys(stateManager)` — one-shot idempotent migration; rewrites any `pinnedChats` entries and `chatFolders` keys whose avatar component matches a legacy group-avatar form; deduplicates pins and unions folder-id arrays on collision
      - `app/chatplus.js` — calls `chatRepository.remapStaleGroupKeys(stateManager)` after `fetchAllChats()` and before Phase 3 module init, wrapped in try/catch
    - **Phase 3 — Missing group event handlers**:
      - `utils/event-handlers.js` — added subscriptions for `GROUP_UPDATED`, `GROUP_CHAT_CREATED`, `GROUP_CHAT_DELETED`
      - `_onGroupUpdated`: invalidates cached data for the group by `String(data.id)`, then debounced 250ms `rebuildIndex()` → `refresh()` (debounce matters — fires on every member enable/disable toggle)
      - `_onGroupChatCreated`: `rebuildIndex()` → `refresh()` so new group chats appear immediately
      - `_onGroupChatDeleted`: `rebuildIndex()` → `cleanOrphanedPins()` + `cleanOrphanedAssignments()` → `refresh()`
      - `destroy()` clears the debounce timer
    - **Phase 4 — Cosmetic fixes**:
      - `modules/ui-renderer.js` `_buildLabel()` — prepends `"👥 "` when `chat.is_group`; removed misleading "prefix already included" comment
      - `modules/lost-and-found.js` `_renderOrphanCard()` — detects group orphans via `CoreAPI.getAllGroups()` (matches `String(g.id)`, `g.avatar_url`, `g.avatar`); renders group collage via `CoreAPI.getGroupAvatarElement()` with `--group` class; labels card as `"👥 <group.name>"`; falls back to character thumbnail otherwise
    - **Explicitly not changed**: `_buildAvatar()` in UIRenderer already uses `chat.entity` for groups; `folders-view.js` has no delete/rename callers; `openChat()` in CoreAPI already uses `openGroupChat()` for groups

28. **Fix character / group chat switching (UI desync)** ✅ COMPLETE
    - Investigated via SillyTavern source (`public/scripts/group-chats.js`, `public/script.js`, `public/scripts/welcome-screen.js`) and deepwiki docs. Root cause: `CoreAPI.openChat()` called only `context.openGroupChat(groupId, fileName)` for groups, which does NOT set `selected_group` and does NOT sync the right panel, top bar, or Characters tab — it only swaps the chat file within an already-selected group. Cross-entity group switches therefore loaded messages while the rest of ST's UI stayed stuck on the previous entity.
    - Additional smaller issues fixed simultaneously: 150ms `setTimeout` hack after `selectCharacterById` (unneeded once we `await` the promise correctly); missing `setActiveCharacter` / `setActiveGroup` calls (so the choice didn't persist for `RA_autoloadchat`); no short-circuit for "already on this chat" (caused flicker on re-click); no handling of `openGroupChat`'s silent-no-op when a chat file isn't in `group.chats[]`.
    - **`modules/core-api.js`**:
      - Added static imports: `openGroupById` from `../../../../group-chats.js` and `setActiveCharacter` / `setActiveGroup` from `../../../../../script.js` — these are required but are NOT exposed on `SillyTavern.getContext()`.
      - Rewrote `openChat()` to mirror the exact two-step pattern from `welcome-screen.js` (`openRecentCharacterChat` / `openRecentGroupChat`):
        - Character path: validate → short-circuit → `await selectCharacterById(idx)` → `setActiveCharacter(avatar)` + `saveSettingsDebounced()` → if `getCurrentChatId() === fileName` done, else `await openCharacterChat(fileName)`.
        - Group path: validate group exists → short-circuit → `await openGroupById(groupId)` (detect `false` return distinguishing "already selected (fine)" from "blocked by save/gen (fail)") → `setActiveGroup(groupId)` + save → if target chat already current done, else pre-validate `fileName ∈ group.chats[]` → `await openGroupChat(groupId, fileName)`.
      - Fail-loud import guard: if `openGroupById` / `setActiveCharacter` / `setActiveGroup` are missing (SillyTavern reorganised its exports), shows user-facing toast "ChatPlus 2 cannot open chats on this SillyTavern version. Please report this on the SillyTavern Discord so we can ship a fix." — intentionally loud rather than silently half-broken.
      - Returns `Promise<boolean>` so callers know whether to assume success.
    - **`modules/recent-chats.js` `_openChat()`** and **`modules/folders-view.js` `_openChat()`** — both are now `async` and await the boolean return; CoreAPI shows its own failure toast so view-level error handling is minimal.
    - **Deliberately not changed**: no manual `printCharacters()` / `select_group_chats()` call — `openGroupById` calls the latter internally and the former is triggered by the next natural re-render.
    - **NOTE for step 29**: the pre-validation added in the group path (rejecting `fileName ∉ group.chats[]` with a "chat no longer exists in this group" toast) is the minimum bar. Step 29 should upgrade this to route those cases into the Lost & Found resolver for one-click re-linking, using this step's pre-validation point as the hand-off site.

29. **Wire Lost & Found into the live chat-open path (stale chat-filename keys)** ✅ COMPLETE
    - **Rationale (reframed from the original step 28 brief)**: after steps 19, 27, and 28 shipped, the actual current behaviour differs from the original bug description. Stale keys no longer produce broken clicks — they _silently vanish at render_. The problem today is invisibility + lack of proactive recovery, not incorrect clicks. Step 28's group-chat pre-validation also added one new surface that should hand off to the existing resolver.
    - **Current behaviour (verified against the code):**
      - `modules/folders-view.js` L304-311: on render, `if (!chat) continue;` — any stale folder-key silently disappears from the folder.
      - `modules/pinned-chats.js` L178-185: on render, same silent skip — stale pins vanish without any warning.
      - `modules/recent-chats.js`: Recent is rebuilt from `ChatRepository`'s fresh fetch, so stale keys can only appear as a cache/disk race; not a persistent state.
      - `modules/core-api.js` `_openGroupChatSwitch`: now pre-rejects `fileName ∉ group.chats[]` with a toast (step 28, Bug C hand-off point).
    - **Existing infrastructure (already shipped, reuse — do not rebuild):**
      - `modules/lost-and-found.js` `detectOrphanedReferences()` — scans `pinnedChats` + `chatFolders`, returns `OrphanReport { orphans, totalPins, totalFolderKeys }` with `sources` (`'pin'` / `'folder'`) and `folderIds`.
      - `modules/lost-and-found.js` (L145-212) — candidate matching by avatar; powers the resolver UI.
      - `utils/chat-identifier.js` `getChatKey` / `extractAvatarFromKey` / `extractFileNameFromKey` — stable key-shape codec.
      - Settings panel already exposes a "Lost & Found" entry (step 19 / step 31 General section).
    - **Scope (three integration surfaces only):**
      1. **Passive → proactive detection on app init.** `app/chatplus.js` already calls `remapStaleGroupKeys()` after `fetchAllChats()` (step 27 Phase 2). Immediately after that, invoke `LostAndFound.detectOrphanedReferences()` one-shot. If `report.orphans.length > 0`, show a non-blocking banner toast: `"<N> saved chat reference(s) are broken. Open Lost & Found to review."` with a callback that opens the resolver. Do NOT auto-clean; user must confirm via the resolver UI.
      2. **Render-time badge for partially-degraded views.** In `modules/pinned-chats.js` and `modules/folders-view.js`, instead of silently skipping null resolutions, count them during render and, if the count is > 0, surface a single compact row at the end of the affected section (or folder): `"⚠ <N> item(s) unavailable — review in Lost & Found"` as a clickable link that opens the resolver scoped to the current view's keys. This keeps the UI clean but stops the silent-vanish surprise.
      3. **Group chat file mismatch hand-off (Bug C from step 28).** In `modules/core-api.js` `_openGroupChatSwitch()`, replace the `showToast('This chat no longer exists in this group', 'warning')` with a call to `LostAndFound.resolveSingleOrphan({ avatar: String(groupId), fileName })` (new thin wrapper — see below). If the user re-links and confirms, retry `openGroupChat(groupId, newFileName)` once; if they cancel, show the original toast.
    - **New public API on LostAndFound module (minimal, to keep step focused):**
      - `resolveSingleOrphan({ avatar, fileName })` → `Promise<{ action: 'relinked'|'removed'|'cancelled', newKey?: string }>`. Wraps the existing candidate-matching logic and disambiguation UI (L145-212) scoped to one key instead of the full orphan list. Most of the body delegates to existing private helpers; the new surface is just a single-entry entry point.
    - **State updates after successful re-link (shared helper):**
      - Pin re-link → replace the entry in `stateManager.pinnedChats` (dedupe on collision).
      - Folder re-link → replace the key in `stateManager.chatFolders` (union folder-id arrays on collision).
      - After any update, call `saveSettingsDebounced()` and `ChatRepository.rebuildIndex()` + emit the existing repository-updated signal so views repaint.
    - **Explicit non-scope:**
      - Do NOT add per-item inline "relink" buttons on every row (noisy; the section-level badge handles it).
      - Do NOT add automatic silent re-link even on unambiguous matches (a silent rewrite of user's saved state is worse than a 1-click confirm).
      - Do NOT build a new ST-event hook for external renames — ST does not fire a rename event; relying on the one-shot init scan + render-time badge is sufficient, and cheaper.
      - Do NOT rebuild the resolver UI; step 19's disambiguation flow already covers both unambiguous and multi-candidate cases.
    - **Dependencies (realistic):**
      - Hard: step 19 (Lost & Found base), step 27 Phase 2 (stable group keys), step 28 (Bug C hand-off point in `_openGroupChatSwitch`).
      - Reused helpers: `ChatRepository.getChatByKey()`, `ChatRepository.rebuildIndex()`, `ChatIdentifier.getChatKey/extract*`, `stateManager.get/set` + `saveSettingsDebounced()`.
    - **Verification plan:**
      1. Pin a chat, close ST, rename the `.jsonl` on disk, reopen ST → on app init expect a toast with the correct orphan count; clicking it opens the resolver with that orphan preselected.
      2. Place the renamed chat in a folder → opening the folder shows the compact "⚠ 1 item unavailable" row; clicking it opens the resolver scoped to that folder's keys.
      3. Delete one chat file from a group's `chats[]` array, click that saved chat entry in Recent → expect the resolver dialog (not the original toast), re-link to a surviving chat in the same group, confirm → the group chat opens successfully on retry.
      4. Cancel the resolver dialog in scenario 3 → expect the original step-28 toast as the graceful fallback.
      5. With no orphans present, confirm no banner toast and no render-time badges appear (no false positives).
    - **Implementation notes (what actually shipped):**
      - **Surface 1 (init-time toast) was already in place** from an earlier pass in `app/chatplus.js` Phase 3 (calls `lostAndFound.scan()` then shows a clickable `toastr.warning` that opens `showResolver(report, candidates)`). No change needed there.
      - **Surface 2 (render-time notices):**
        - Added `UIRenderer.renderUnavailableNotice(count, onClick)` — a single `<button class="chatplus-unavailable-notice">` with a `fa-triangle-exclamation` icon and the `"N item(s) unavailable — review in Lost & Found"` label.
        - Styled in `app/chatplus.css` with the existing `--SmartThemeBodyColor` / amber accent palette, hover + focus states, and a compact 0.8rem row height.
        - `modules/recent-chats.js` `_renderPinnedSection()` — instead of `if (!chat) continue;`, collects orphan keys into an array during the loop and appends one notice row to the pinned section with a click handler that calls `CoreAPI.getLostAndFound().openResolverFor(orphanKeys)`.
        - `modules/folders-view.js` `_renderFolderContents()` — same pattern, appending to the folder's `.chatplus-folder-contents` container.
      - **Surface 3 (group-chat hand-off):** `modules/core-api.js` `_openGroupChatSwitch()` — when `fileName ∉ group.chats[]`, builds the stale key `` `${groupId}:${fileName.replace(/\.jsonl$/, '')}` ``, calls `LostAndFound.resolveStaleKey(staleKey)`, and on a successful relink extracts `newKey` from the batch-summary results, re-reads the group's current `chats[]` (in case it refreshed), and retries `openGroupChat(groupId, newFileName)` once. On cancel / no match / retry failure, falls back to the original `"This chat no longer exists in this group"` toast.
      - **New L&F API:** `LostAndFound.openResolverFor(scopeKeys)` — scans, filters orphans to the supplied key set, and opens `showResolver` on the scoped report. Shows a `"Those references are no longer orphaned."` info toast if the cache refreshed between render and click. **Deviation from the plan:** the plan specified a new `resolveSingleOrphan({ avatar, fileName })` wrapper, but `resolveStaleKey(staleKey)` already existed and does the exact same job at the single-entry level (builds minimal report, opens resolver, returns `BatchResolutionSummary`); no new single-entry wrapper was added to avoid redundancy.
      - **Files touched:** `modules/lost-and-found.js` (added `openResolverFor`), `modules/ui-renderer.js` (added `renderUnavailableNotice`), `modules/recent-chats.js` (pinned section), `modules/folders-view.js` (folder contents), `modules/core-api.js` (group-chat hand-off), `app/chatplus.css` (notice row styles).
      - **Not touched (intentionally):** `modules/pinned-chats.js` `getAllPinned()` still silently skips orphans — the orphan detection + notice is handled one layer up in the renderer because that's where we have access to both the pinned-keys list and the notice-building context. Adding a `getOrphanKeys()` method would have duplicated logic the renderer already runs inline.

30. **Snapshot Database terminology cleanup — "entries" not "snapshots"** ✅ COMPLETE
    - **Rationale**: Users interact with a database of rows/records; "snapshot" is an implementation detail. The current UI also visibly toggles between the two nouns in the same sentence — the import confirm dialog reads _"Import N snapshot(s)? … replace the current snapshot database (M entries)."_ Align on **entries** for all user-facing strings (button labels, toasts, confirms, info line, help hint). Keep **snapshot** only in internal identifiers (class/file/module names, API method names, the persisted file `chatplus2-snapshots.json`, and console logs). The feature title "Snapshot Database" is kept as a proper noun for the section.
    - **Files touched** (surgical string-only change, no logic):
      - `index.js` `wireSettingsPanel()` — four user-facing strings swapped from `snapshot(s)` to `entries`:
        - Info line: `${store.size} snapshot(s) stored.` → `${store.size} entries stored.`
        - Export toast: `Exported ${store.size} snapshot(s).` → `Exported ${store.size} entries.`
        - Import confirm: `Import ${count} snapshot(s)?` → `Import ${count} entries?` (second half `(${store.size} entries)` was already correct)
        - Import-success toast: `Imported ${count} snapshot(s).` → `Imported ${count} entries.`
    - **Left unchanged (intentional)**:
      - `modules/snapshot-store.js` — only two `console.debug` call-sites use `snapshot(s)`; dev-facing, kept as-is. No `toastr.error` paths used the noun.
      - `app/settings.html` "Snapshot Database:" section title + help hint — proper-noun feature name, kept.
      - `app/chatplus.js` bootstrap log `Bootstrapped N snapshot(s)` — console-only, kept.
    - **Scope explicitly excluded** (kept from original plan):
      - Renaming the module (`SnapshotStore`), file (`chatplus2-snapshots.json`), or public API methods (`getSnapshot`, `setSnapshot`, `bulkUpdate`, etc.) — breaking change for zero user-facing gain.
      - Changing the "Snapshot Database" section title.
    - **Verification**:
      1. Open settings → info line reads "N entries stored."
      2. Click Export → toast reads "Exported N entries."
      3. Click Import on a file with K records → confirm dialog reads "Import K entries? This will replace the current snapshot database (M entries)." (both numbers use "entries")
      4. Finish import → toast reads "Imported K entries."
      5. Grep the codebase for `snapshot(s)` — only internal console.debug calls should remain.

31. **(BUG) Fix `#rm_button_group_chats` / Characters-tab DOM injection regression** ✅ COMPLETE
    - **Rationale (updated after audit)**: the original analysis listed `#favorite_view` as a sibling — that element does not exist in ST. In practice `wrapExistingCharacterList()` moved **one** node (the entire `#right-nav-panel > .scrollableInner` wrapper, which already holds every `.right_menu`: `#rm_ch_create_block`, `#rm_group_chats_block`, `#rm_character_import`, `#rm_characters_block`) into `#chatplus-characters-content`. ST's `selectRightMenuWithAnimation` uses the descendant selector `#right-nav-panel .right_menu`, so basic panel switching continued to work by accident. The real regression was elsewhere: group-member mutations (Remove "X", Move up/down) silently no-op'd or didn't fire at all with ChatPlus2 enabled, while "View card" kept working. Root cause: `printGroupMembers` uses the **class** selector `$('.rm_group_members')` and jQuery-stored `.data('id')`; reparenting produced stale/duplicate subtrees so `.append()` landed the re-render in an orphaned copy and mutations never persisted.
    - **Phase 1 — Discovery (completed)**:
      - Verified DOM structure: `#rm_PinAndTabs` and `.scrollableInner` are siblings inside `<nav id="right-nav-panel">` (`public/index.html` L5972 / L5996).
      - Verified ST panel switching: `selectRightMenuWithAnimation` (`public/script.js` L8524) uses descendant selectors and survives wrapping.
      - Confirmed group-action handler binding (`public/scripts/group-chats.js` L2489) is delegated on `document` — so Remove reaches the handler but fails downstream due to the class-selector re-render (`printGroupMembers`, L1647).
      - Reproduction: Remove silently no-ops (persists after reload), Move up/down fires no event, View card works. All three work with ChatPlus2 disabled.
      - Decision gate passed → Option A.
    - **Phase 2 — Implementation (Option A — pure additive injection, no DOM reparenting)**:
      - `index.js` `injectTabsIntoUI()`: now only inserts the ChatPlus container as a next-sibling of `#rm_PinAndTabs`. No ST DOM is moved.
      - `index.js`: `wrapExistingCharacterList()` removed entirely.
      - `app/chatplus.html`: removed `<div id="chatplus-characters-content">`; the Characters tab content is now an empty `.chatplus-tab-content[data-chatplus-tab="characters"]` placeholder whose sole role is to trigger visibility handling in `TabController`.
      - `modules/tab-controller.js`: `init()` caches `document.querySelector('#right-nav-panel .scrollableInner')` as `_stNativeContainer`. `activateTab(name)` toggles `.chatplus-native-hidden` on it — removed when `name === 'characters'`, added otherwise. Existing `.chatplus-tab-content.active` toggling and `_handleReclick` logic unchanged.
      - `app/chatplus.css`: added `.chatplus-native-hidden { display: none !important; }`. `!important` is required because ST sets inline `display` on individual right_menu blocks.
    - **Files touched**:
      - `public/scripts/extensions/third-party/SillyTavern-ChatPlus2/index.js`
      - `public/scripts/extensions/third-party/SillyTavern-ChatPlus2/modules/tab-controller.js`
      - `public/scripts/extensions/third-party/SillyTavern-ChatPlus2/app/chatplus.html`
      - `public/scripts/extensions/third-party/SillyTavern-ChatPlus2/app/chatplus.css`
    - **Out of scope (unchanged)**: tab-bar position, settings drawer, Pinned/Recent/Folders content, any "Characters tab disabled when no characters" state.
    - **Verification**:
      1. In a selected group chat: Remove ("X"), Move up, and Move down all behave identically to ChatPlus2 disabled; View card still works.
      2. `#rm_button_group_chats` → group panel appears in its original position.
      3. `#rm_button_create` → character create form appears; saving a character surfaces the character list.
      4. Switch to Recent/Folders → `.scrollableInner` hides via `.chatplus-native-hidden`; ChatPlus panel shows. Switch back to Characters → native container returns with its prior inline `display` intact.
      5. DevTools sanity: `document.querySelector('#right-nav-panel .scrollableInner').parentElement.id === 'right-nav-panel'` — zero reparenting.
      6. Mobile / compact viewport: ST's responsive behaviour for `#rm_characters_block` still applies; `chatplus-tabs--compact` still engages via `ResizeObserver`.
      7. Regression sweep: pinned chats, folders, edit mode, search, lost-and-found, snapshot store all unchanged.

32. **Auto-Updater support (manifest + lifecycle hooks + manual "Check for Updates" button)** ✅ COMPLETE
    - **Phase A (manifest opt-in)**: `manifest.json` adds `auto_update: true`, `minimum_client_version: "1.17.0"`, and `hooks: { install: "onInstall", update: "onUpdate" }`.
    - **Phase B (lifecycle hooks)**: `index.js` exports `onInstall` (stamps `_lastRanVersion`, initialises settings, logs install) and `onUpdate` (reads manifest version via `_readManifestVersion()`, delegates to `stateManager.runMigrations(from, to)` via optional chaining, stamps `_lastRanVersion`, saves, and only shows its own toast when `summary.migrationsRun > 0` so ST's built-in "Reload to apply" toast isn't duplicated).
    - **Phase C (migration scaffold)**: `modules/state-manager.js` gains `_lastRanVersion: null` in `DEFAULT_SETTINGS`, a `static MIGRATIONS = []` registry (documented shape `{ from, to, run(settings) }`), and `async runMigrations(fromVersion, toVersion)` that chains matching entries, counts real mutations vs no-ops, persists via `save(true)` when anything changed, and returns `{ migrationsRun, notes }` (or `null` when the registry is empty).
    - **Phase D (Check for Updates button)**: `app/settings.html` adds an "Updates" section with `#chatplus2-settings-update` (icon `fa-solid fa-cloud-arrow-down`). `index.js` `wireSettingsPanel()` wires a click handler that triggers `document.querySelector('#extensions_details')?.click()` and falls back to `toastr.warning("Open User Settings → Extensions → Manage Extensions to check for updates.", "ChatPlus 2")` when the element is absent. No direct calls to `/api/extensions/update` — ST's modal owns the UX.
    - **Locked decisions**: `minimum_client_version = 1.17.0`; `onUpdate` does NOT flush the snapshot store (no current migration touches snapshots, 5 s hook budget is tight); our migration toast stacks below ST's built-in "Reload to apply" toast rather than replacing it.
    - **Rationale**: SillyTavern already supports automatic extension updates natively via the `auto_update` manifest flag and the `onUpdate` lifecycle hook. We do not need to write a custom downloader — we opt in, declare a data-migration hook, and deep-link users to ST's native **Installed Extensions** modal (selector `#extensions_details`) for manual checks. ST's updater already handles git pull, version comparison, reload toast, and failure cases.
    - **Source-verified facts (confirmed in `public/scripts/extensions.js`, April 2026)**:
      - Manifest `auto_update: true` — triggers (1) daily `checkForExtensionUpdates()` toast nag when `extension_settings.notifyUpdates` is on; (2) `autoUpdateExtensions(false)` during `loadExtensionSettings()` **when the ST core version changes** (not our extension's version).
      - Manifest `minimum_client_version` — checked in `activateExtensions()` via `versionCompare(CLIENT_VERSION.split(':')[1], minClientVersion)`; failing value blocks activation and surfaces an error banner under `#extensions_details`.
      - Manifest `hooks` — `{ [hookName]: exportedFunctionName }`, supported names: `install | update | delete | enable | disable | activate`. 5 000 ms hard timeout per hook (`callExtensionHook`).
      - `update` hook fires **only when `data.isUpToDate === false`** (i.e. a real git pull happened). ST itself shows `toastr.success("Extension updated to <hash>", "Reload the page to apply updates")` AFTER our hook returns — any persistent toast we add will stack on top.
      - Correct deep-link target is `#extensions_details` (User Settings → Extensions row that opens `showExtensionsDetails()`). `#extensionsMenuButton` is the unrelated wand dropdown.
      - Direct endpoint `POST /api/extensions/update` exists but bypasses popup UI state — not used.
    - **32a Manifest opt-in** ✅ COMPLETE
      - `manifest.json` — added `"auto_update": true`, `"minimum_client_version": "1.17.0"` (SillyTavern 1.17.0 'release' 004f1336e, the version validated through step 31), and `"hooks": { "install": "onInstall", "update": "onUpdate" }`.
    - **32b Exported lifecycle hooks in `index.js`** ✅ COMPLETE
      - Added `export async function onInstall()` — calls the existing `getSettings()` seeder, reads current version via `_readManifestVersion()` helper (fetches `./manifest.json` with `cache: 'no-store'` so post-update reads the new version), stamps `settings._lastRanVersion`, saves, logs `[ChatPlus2] Installed (v<version>)`.
      - Added `export async function onUpdate()` — version-aware migration pipeline:
        1. Read current `settings` + live manifest version.
        2. If `fromVersion !== toVersion`, attempt `coordinatorRef?.stateManager?.runMigrations?.(from, to)` — **optional-chained**, so the hook works even though Phase C (the `runMigrations` scaffold itself) is not landed yet. Returns `null` in that case.
        3. Always stamp `_lastRanVersion = toVersion` last (partial-failure-safe: next reload retries migrations).
        4. Toast policy (revised, layering decision): persistent `toastr.info` with `timeOut: 0, closeButton: true` is fired **only when a migration returned `{ migrationsRun > 0 }`**. When no migration ran (common case), we stay silent and let ST's own "Reload to apply updates" toast do all the talking — avoids double-toasting the user for every single version bump.
      - Both hooks are top-level named exports from `index.js` (matching `manifest.hooks` function names). Total runtime << 5 s in the no-migration path (one fetch + one settings mutation).
      - `_readManifestVersion()` helper added alongside — keeps the fetch logic in one place.
    - **Supporting change in `modules/state-manager.js`** ✅
      - Added `_lastRanVersion: null` to `DEFAULT_SETTINGS` so fresh installs merge it in cleanly.
      - The `runMigrations(from, to)` method itself is **deferred to 32c (Phase C)**; `onUpdate` uses optional chaining so it is a no-op until the method lands.
    - **32c Migration scaffold in StateManager** (can land independently)
      - Add `async runMigrations(fromVersion, toVersion)` — initial body logs `[ChatPlus2] runMigrations(${from} → ${to}) — nothing registered` and returns `null`. Later migrations register as ordered `[fromVersion, transformFn]` entries; method returns `{ migrationsRun: N, notes: [...] }` when any entries actually execute.
      - No semver comparator yet — equality check + ordered list is enough until migration count > 3.
    - **32d "Check for Updates" button + Installed Extensions shortcut**
      - `app/settings.html` — add `#chatplus2-settings-update` button (label "Check for Updates", icon `fa-solid fa-cloud-arrow-down`) inside the Maintenance grouping.
      - `index.js` `wireSettingsPanel()` — click handler: `document.querySelector('#extensions_details')?.click()` opens ST's Installed Extensions popup (which auto-runs `checkForUpdatesManual()`). Fallback toastr guidance if the element is missing (very old ST build).
      - **Do NOT** call `/api/extensions/update` directly — races the popup's state machine and produces no UI feedback.
    - **Files touched (A + B)**:
      - `manifest.json` — `auto_update`, `minimum_client_version`, `hooks`
      - `index.js` — `_readManifestVersion()`, `onInstall`, `onUpdate`
      - `modules/state-manager.js` — `_lastRanVersion: null` in `DEFAULT_SETTINGS`
    - **Scope explicitly excluded** (unchanged): custom downloader, GitHub polling, release-notes UI, semver-aware migration routing, any UI duplicating ST's Installed Extensions popup.
    - **Verification plan** (full, applies once C + D also land; A + B portion is testable now):
      1. Fresh install (delete `settings.chatPlus2` from `extensionSettings`, reload) → console: `[ChatPlus2] Installed (v2.0.0)`; `_lastRanVersion === '2.0.0'`.
      2. Bump `manifest.json` `version` to `2.0.1`, click Update in Installed Extensions popup → `onUpdate` fires, console: `Updated from 2.0.0 → 2.0.1`; `_lastRanVersion === '2.0.1'`; **no duplicate toast** while no migration registered.
      3. Re-click Update when already up-to-date → `data.isUpToDate === true` → ST skips `onUpdate` (confirmed from source); `_lastRanVersion` unchanged.
      4. (After 32c) Register a dummy migration returning `{ migrationsRun: 1 }` → on next update, our persistent info toast appears below ST's "Reload to apply" toast.
      5. Disable extension via the popup → `disable` hook fires, not `update`.
      6. (After 32d) Click "Check for Updates" in settings → Installed Extensions popup opens with ChatPlus 2 row visible.
      7. `auto_update: true` respected on ST core version bump (manual QA, or inspect `autoUpdateExtensions()` path).
      8. `minimum_client_version` gate: temporarily set to `99.0.0`, reload → extension blocks, error banner under `#extensions_details`. Revert before commit.
    - **Decisions (final)**:
      - Deep-link target is `#extensions_details`, not `#extensionsMenuButton`.
      - `onUpdate` is idempotent; `_lastRanVersion` stamped last so partial failures are retryable.
      - Post-update toast fires **only when a migration mutates state** — ST's built-in "Reload to apply" toast handles the vanilla version bump.
      - `minimum_client_version` pinned to `1.17.0` (SillyTavern 1.17.0 'release' 004f1336e, validated through step 31).
      - `onUpdate` does **not** flush `snapshotStore` before migrations — no current migration touches snapshots, and an unconditional flush would eat into the 5 s hook budget; revisit when a snapshot-schema migration lands.

33. **Snapshot Database viewer — dedicated HTML/CSS panel** ✅ COMPLETE
    - Created `app/snapshot-viewer.html` with `<template id="chatplus-snapshot-viewer-template">` — overlay, modal (role="dialog"), header (icon + title + entry count + close button), search input with magnifying-glass icon, `<table>` with three sortable column headers (Chat Key / Last Message / Updated), `<tbody>`, empty-state block, footer with status text
    - Created `app/snapshot-viewer.css` — mobile-first: bottom-sheet layout (100vw × 85vh) on mobile, centered modal (`min(900px, 92vw)` × `min(720px, 85vh)`) on ≥768px, z-index 9500 (above Lost & Found's 9000), fade-in + slide-up animations, SmartTheme CSS variables (`--SmartThemeBorderColor`, `--SmartThemeBlurTintColor`, `--SmartThemeBotMesBlurTintColor`, `--SmartThemeBodyColor`), sticky `<thead>`, alternating row tint, monospace chat-key cell, tabular-nums date column
    - `app/chatplus.css` — added `@import url('./snapshot-viewer.css');` alongside existing module imports
    - `index.js` `loadAllTemplates()` — added 5th parallel `fetchTemplate('snapshot-viewer.html')`; extracts template content to module-level `snapshotViewerFragment` (kept out of the return object since it's only consumed by the settings-panel handler)
    - `index.js` `openSnapshotViewer()` — new self-contained function that clones the fragment, flattens snapshot entries to `{ key, lastMessage, updatedAt }` array, and runs a filter→sort→render pipeline:
      - **Sort state**: module-level `snapshotViewerSortState = { column, direction }` persists across opens within the same page load (no localStorage); defaults to `updatedAt` / `desc`; clicking active column toggles direction, clicking other columns resets to sensible defaults (`desc` for dates, `asc` for text)
      - **Sort icons**: `fa-sort` / `fa-sort-up` / `fa-sort-down` swapped on active column; `.chatplus-active` class highlights the column header
      - **Filter**: 200 ms-debounced input, case-insensitive substring match over `key` OR `lastMessage`
      - **Rendering**: `textContent`-only (XSS-safe, matches UIRenderer convention); `lastMessage` truncated at 100 chars with full-text `title` tooltip; `updatedAt` formatted via `toLocaleString()` with `—` fallback for missing timestamps
      - **Empty states**: "No entries stored yet." when store is empty; "No entries match your filter." when filter produces zero rows; footer shows `Showing N of M entries`
      - **Close**: X button, backdrop click (ignores modal-interior clicks via `stopPropagation`), Escape key (captured with `useCapture: true`, detached on close); search timer also cleared on close to prevent stale renders
      - **Focus**: search input auto-focused on open for immediate typing
    - `index.js` View-button click handler — replaced ~40-line inline `createElement`/`innerHTML` block with a single call to `openSnapshotViewer()`; dropped the early-return `toastr.info('Snapshot database is empty.')` — empty state now handled inline in the overlay

34. **Settings panel UI/UX overhaul** ✅ COMPLETE
    - **Note on plan staleness**: `app/settings.css` already existed and was already `@import`ed from `chatplus.css`, so the original "new file" item was a no-op; this step _expanded_ the stylesheet from ~60 → ~210 lines instead.
    - `app/settings.html` rewritten: three `<section class="chatplus-settings-group">` wrappers (General / Data / Maintenance), each with an `<h4 class="chatplus-settings-group-heading">`. Per-section `<b>…</b>` replaced with `<span class="chatplus-settings-group-label">` (and `<label>` where it binds a control). Every `<p class="chatplus-settings-hint">` converted to `<span class="chatplus-settings-hint">` to drop block-model spacing. Snapshot info line rebuilt as `<span class="chatplus-settings-pill" id="chatplus2-snapshot-info">` with an inner `<i class="fa-database">` + `<span class="chatplus-settings-pill-text">` (JS now writes only to the inner text span).
    - Drawer header gained a `fa-solid fa-comments` logo via `.chatplus-settings-drawer-title` wrapper sitting alongside the existing chevron.
    - `app/settings.css` rewritten end-to-end:
      - Scoped tokens under `#chatplus2-settings-drawer`: `--cp-spacing-sm: 8px`, `--cp-spacing-md: 16px`, `--cp-btn-min-height: 36px`, `--cp-divider`, `--cp-muted`.
      - `.chatplus-settings-group` — flex-column with `gap: var(--cp-spacing-md)`; `.chatplus-settings-group + .chatplus-settings-group` gets `border-top: 1px solid var(--cp-divider)` (per "further consideration" decision: no `<hr>`).
      - `.chatplus-settings-group-heading` — 0.72rem, uppercase, 0.08em letter-spacing, opacity 0.55.
      - `.chatplus-settings-section` — flex-column, zero margin, relies on parent `gap`. Removes all `margin-top` patchwork.
      - `.chatplus-settings-hint` — block span, 0.82em, muted, line-height 1.35. Inline `<code>` gets a faint tint chip.
      - `.chatplus-settings-enable-label` — inline-flex with `align-items: center` and `gap: var(--cp-spacing-sm)` for baseline-true checkbox + text across themes.
      - `.chatplus-settings-tab-row` + `.chatplus-settings-btn-row` — `gap` only, `flex: 1 1 0`, `min-height: 36px`. Under `max-width: 400px`, `.chatplus-settings-btn-row .menu_button` drops to `flex-basis: 100%` so rows stack.
      - Standalone single-button sections (`.chatplus-settings-section > .menu_button`) use `align-self: flex-start` so Reload / Lost & Found / Updates / Migrate stay content-sized instead of stretching.
      - `.chatplus-settings-pill` — inline-flex, rounded-full (`999px`), subtle tint background, muted text, tabular-nums numbers; FA icon prefix auto-sized.
      - `.chatplus-settings-migration` — kept warning tint; added 3px amber left border for sharper visual cue.
      - Accessibility: global `#chatplus2-settings-drawer :is(button, input, select, label):focus-visible { outline: 2px solid var(--SmartThemeFavColor); outline-offset: 2px; border-radius: 4px; }` and `#chatplus2-settings-drawer button:disabled { opacity: 0.55; cursor: not-allowed; }`.
    - `index.js` `updateSnapshotInfo()` — writes to `.chatplus-settings-pill-text` inner span when present; falls back to the pill root for safety. Single-line adjustment, no other JS changes.
    - All existing button IDs preserved; `wireSettingsPanel()` untouched beyond the one-line snapshot-info tweak.

35. **Recent tab — sticky toolbar + infinite scroll + manual reload** ✅ COMPLETE
    - **What shipped (initial)**:
      - `app/chatplus.html` — `.chatplus-recent-header` replaced by `.chatplus-recent-toolbar` (flex row: `#chatplus-recent-reload` → `.chatplus-search-bar` → runtime-appended edit toggle). `.chatplus-recent-footer` and `#chatplus-load-more` removed entirely.
      - `app/chatplus.css` — new `.chatplus-recent-toolbar` (originally sticky `position: sticky; top: 0; z-index: 2`; see revision below). Shared `.chatplus-icon-btn` utility (36×36) introduced for reuse by step 37. `.chatplus-recent-sentinel` (1px, pointer-events: none).
      - `modules/recent-chats.js` — dropped `loadMoreButton`, `_updateLoadMoreButton()`, `_hideLoadMore()`, public `loadMore()`. New private `_renderNextPage()` guarded by `this._loadingMore`. `_updateSentinel()` lazily creates the observer (root via new `_findScrollAncestor()` walk of `overflow-y: auto|scroll|overlay` parents, fallback viewport; `rootMargin: '200px 0px'`), ensures the sentinel stays at list tail, and re-observes. `_teardownObserver()` disconnects + detaches on every `render()`, `applyFilter()`, edit-mode toggle, and `destroy()`. `_wireReloadButton()` attaches a single click handler that swaps the icon to `fa-spin`, `await chatRepository.rebuildIndex()` → `await refresh()`, shows success/error toast, restores icon. `_setLoading()` kept as a minimal state flag (no DOM side effects). Edit toggle now mounts into the new toolbar with `.chatplus-icon-btn` + id `chatplus-recent-edit-toggle`.
    - **Revision (2026-04-24) — scroll container moves into the list itself**:
      - **Motivation**: previously the whole tab panel scrolled (via `#right-nav-panel`'s scroll context) and the toolbar relied on `position: sticky` to stay in view. On mobile (no scroll wheel, touch-drag only) this was fragile and depended on the outer panel being scrollable. Moving the scroll context inside `#chatplus-recent-list` makes the tab self-contained and works identically on desktop and touch devices.
      - `app/chatplus.css` — new flex chain: `#chatplus-root { flex: 1 1 auto; min-height: 0; height: 100%; display: flex; flex-direction: column }` → `.chatplus-tabs-container { flex: 1 1 auto; min-height: 0 }` → `.chatplus-tab-panels { flex: 1 1 auto; min-height: 0 }` → `.chatplus-tab-content.active[data-chatplus-tab="recent"] { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0 }` → `.chatplus-recent-toolbar { flex: 0 0 auto; display: flex; flex-direction: column }` (no longer sticky) → `.chatplus-recent-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y }`.
      - Removed `.chatplus-recent-list .chatplus-date-separator { top: 44px }` — with the list as the scroll container, day-separators stick to its top edge (`top: 0`) directly.
      - `_findScrollAncestor()` now correctly picks `#chatplus-recent-list` as the observer `root`, tightening the trigger zone.
    - **Revision (2026-04-24) — bulk-action toolbar folds into `.chatplus-recent-toolbar`**:
      - `app/chatplus.html` — toolbar becomes a column with a `.chatplus-recent-toolbar-primary` row for reload + search + edit-toggle; bulk toolbar and selected-hint are appended underneath it when edit mode is active. This keeps bulk actions visible while the list scrolls.
      - `modules/recent-chats.js` — new `_toolbarEl` + `_selectedHintEl` fields. `_toggleEditMode()` now appends both the hint (`<div class="chatplus-recent-selected-hint">`) and the bulk toolbar inside `_toolbarEl` (not before the list container). `destroy()` cleans both.
      - `modules/recent-chats.js` — `_handleSelectAll()` **deleted**; the Select-All affordance is removed per UX revision. `_updateBulkBadge()` renamed to `_updateSelectedHint()` and now writes into the compact `.chatplus-recent-selected-hint` element under the search bar rather than a badge inside the bulk toolbar.
      - `modules/ui-renderer.js` `renderBulkToolbar()` — no longer renders the Select-All button, the count badge, or the spacer; just the action buttons. `onSelectAll` + `selectedCount` options removed.
      - `app/chatplus.css` — dropped `.chatplus-bulk-badge` / `.chatplus-bulk-spacer`; `.chatplus-bulk-toolbar` gets `margin: 0` when nested inside the toolbar column (parent `gap` handles spacing). New `.chatplus-recent-selected-hint` (0.72rem, 0.85 opacity, `aria-live="polite"`).
    - **Notes / deliberate decisions**:
      - Sentinel is a single shared `<div>` reused across pages — `appendChild` re-parents it to the end after each chunk. Observer uses a single registration and relies on `_loadingMore` for re-entry protection.
      - Scroll-ancestor is detected dynamically at observer-creation time rather than hardcoding `#chatplus-recent-list`, so the same view survives future container changes.
      - `#chatplus-root` uses _both_ `flex: 1 1 auto` and `height: 100%` as a belt-and-suspenders fallback for ST builds where `#right-nav-panel` is not configured as a flex column.
      - `isLoading`/`_setLoading` retained (still used by a few call sites) but no longer toggles any visible UI.
      - Select-All removal is intentional: most workflows involve targeted multi-select rather than whole-list operations; the hint UI emphasises the count without encouraging the "delete everything" footgun.

36. **Recent tab — character-grouped section headers (now gated by a preference)** ✅ COMPLETE
    - **What shipped (initial)**:
      - `modules/ui-renderer.js` — new `renderCharacterSeparator(chat)` (flex row: 24px avatar + entity name, `👥 ` prefix for groups, `--group` modifier class). `renderChatItem()` accepts `includeEntityPrefix: boolean` (default `true` for backwards compat). `_buildLabel(chat, { includeEntityPrefix })` returns just `file_name` when `false`, else the original `[👥 ]CharName: filename` string.
      - `modules/recent-chats.js` `_sortChats()` — originally always composite (day → avatar → timestamp); now conditional (see revision).
      - `modules/recent-chats.js` `_renderPage()` — tracks `_lastRenderedAvatar` alongside `_lastRenderedDateLabel`; each new date separator resets `_lastRenderedAvatar = null`.
      - `app/chatplus.css` — `.chatplus-character-separator` (flex row, dashed bottom border, 0.82rem name, 0.85 opacity); scoped `.chatplus-chat-avatar` override to 24×24 inside separators; `--group` italicises the name.
    - **Revision (2026-04-24) — grouping becomes an opt-in preference**:
      - **Motivation**: users pointed out that, with a 40px avatar on every chat row, the character-header avatar above each row becomes redundant and eats vertical space. The grouped layout is a matter of preference, so it's been moved behind a setting and the flat `CharName: filename` layout is restored as the default.
      - `modules/state-manager.js` — new default `recentListGroupByCharacter: false`.
      - `app/settings.html` — new "Recent List Layout" section with two preview buttons (`.chatplus-layout-preview`): **Flat list** (default, shows `Alice: chat_log` rows) vs **Grouped by character** (shows a dashed-underline `Alice` header above filename-only rows). Click-to-toggle using the existing `.chatplus-settings-tab-row` / `.chatplus-active` affordance.
      - `app/settings.css` — new preview styles (`.chatplus-layout-preview`, `-title`, `-body`, `-row-mock`, `-header-mock`, `-dot`, `--indent`) driven by a mini mock of each list style.
      - `index.js` — wires both buttons; on change, persists via `saveSettings()` and calls `coordinatorRef.recentChatsView.refresh()` so the list rebuilds with the new sort + layout instantly.
      - `modules/recent-chats.js` `_renderPage()` — reads `recentListGroupByCharacter` at render time; character separator emission and `includeEntityPrefix: false` are now gated on that flag. Filtered views still keep the prefix regardless (matches earlier decision).
      - `modules/recent-chats.js` `_sortChats()` — split into two branches: **flat** (timestamp desc only) when the preference is off, **composite** (day → avatar → timestamp) when on. This restores v1-like recency feel for the default flat view while preserving clean sectioning when grouping is enabled.
    - **Pinned section, folders view, Add-Chats compact picker**: all unchanged — still render with the default `includeEntityPrefix: true` so the `CharName: filename` label pattern is preserved wherever rows are ungrouped.
    - **Notes / deliberate decisions**:
      - The preference is read _inside_ `_sortChats()` and `_renderPage()` (not cached on the instance) so toggling the setting takes effect on the next render without needing to plumb change events through StateManager.
      - Group chats that lack `avatar` fall back to `String(group_id)` in the composite sort key, matching the stable-group-identity decision from step 27 Phase 2.
      - Forcing avatar-reset on date boundaries means every date bucket unconditionally opens with a character separator — avoids the edge case where the last-rendered avatar of the previous day happens to match the first of the next day.
      - Preview mockups are pure CSS + static HTML (no live previews) to keep the settings panel cheap to render and free of ChatRepository coupling.

37. **Folders tab — sticky header, icon-only New Folder** ✅ COMPLETE
    - **Rationale**: mirrors the Recent-tab revamp (step 35) for consistency. The old `+ New Folder` button occupied a full toolbar slot with a text label; folded it into an icon-only button (`fa-folder-plus`) using the shared `.chatplus-icon-btn` class (36×36) for visual parity with `#chatplus-recent-reload`.
    - **Shipped changes**:
      - `app/chatplus.html` — `.chatplus-folders-header` rewritten: icon-only `#chatplus-new-folder` button (`fa-folder-plus`, `title="New folder"`, `aria-label="New folder"`) on the left; `.chatplus-search-bar` on the right. ID preserved so `FoldersView._wireNewFolderButton()` requires no JS changes.
      - `app/chatplus.css` — extended the flex-column tab-content rule to cover `[data-chatplus-tab="folders"]` alongside `recent` (absolute + flex + `min-height: 0`), so the Folders tab owns its own scroll context like Recent. `.chatplus-folders-header` now styled as a non-scrolling toolbar (`flex: 0 0 auto`, 0.5rem padding, blur-tint background, `box-shadow: 0 1px 0 var(--SmartThemeBorderColor…)` divider, 44px min-height). `.chatplus-folders-list` became the scroll container (`flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y`). Removed the obsolete `.chatplus-new-folder` desktop rule and the mobile `@media (max-width: 768px)` overrides that stacked the header vertically / made the button full-width.
      - `modules/folders-view.js` — no changes. `_wireNewFolderButton()` / `_onNewFolder()` still target `#chatplus-new-folder`; click handler and `destroy()` cleanup unchanged.
    - **Scope excluded (confirmed)**: no IntersectionObserver / infinite scroll (folder trees are rarely paginated — natural scroll is sufficient); no selection-aware "create subfolder here" flourish from the toolbar (step 22's per-folder gear → "+ Subfolder" already covers it; adding a second path would create UI ambiguity); drag-and-drop reorder; keyboard shortcuts.
    - **Decisions locked**:
      - Button order: icon-button left + search right, matching Recent's reload-left placement for cross-tab muscle memory.
      - Sticky delimiter: `box-shadow: 0 1px 0 var(--SmartThemeBorderColor…)` for parity with Recent (not `border-bottom`).
      - Button ID (`#chatplus-new-folder`) preserved — zero JS churn.
    - **Verification**:
      1. Folders toolbar stays pinned while scrolling a long folder tree (30+ folders or 4-level nesting).
      2. Clicking the icon opens the "Enter a name for the new folder:" prompt (unchanged handler from step 22).
      3. Tooltip + aria-label present; icon button renders 36×36 matching `#chatplus-recent-reload` visually.
      4. Mobile ≤768px: toolbar stays horizontal (icon + search side-by-side), no column stacking regression.
      5. Search/clear behaviour and `folders-changed` / `chat-folders-changed` re-renders unchanged.

38. **Lost & Found — UI/UX revamp (side-by-side layout + restore Delete)** ✅ COMPLETE
    - **Rationale**: step 19c's pagination layout (one orphan card at a time, single-card viewport, candidates listed below the card) is functional but hides signal. Users need to eyeball the snapshotted message next to each candidate's identifying info to make a confident choice. A two-pane layout (lost on left, candidates + live preview on right) reinstates that. Separately, step 19c removed the Delete action from the visible UI (kept as `_remove()` programmatically only); advanced users need it back for genuinely unresolvable orphans.
    - **Current responsibilities to preserve (explicitly enumerated)**:
      1. `detectOrphanedReferences()` — scan pins + folder assignments; output `OrphanReport`.
      2. `findCandidates(orphan)` — avatar-match live chats, score confidence (high/medium/low), sort by recency.
      3. Interactive resolution — per-orphan choice of Relink / Discard / Ignore.
      4. Batch actions — "Auto-Reconnect Obvious" (high-confidence auto-link), "Apply All" (execute all staged decisions).
      5. State updates on relink — replace key in `pinnedChats`, rename key in `chatFolders` (preserving folder-id union on collision), update snapshot store via `updateKey()`.
      6. Remove on discard — drop from `pinnedChats`, drop from `chatFolders`, drop from snapshot store.
      7. Scoped mode — `openResolverFor(scopeKeys)` for section-level notices (step 29).
      8. Stale-key hand-off — `resolveStaleKey(staleKey)` for the `_openGroupChatSwitch()` retry path (step 28/29).
    - **Files touched**:
      - `app/lostfound.html` — full template rewrite: two-column flex layout inside the modal body. Left pane (`.chatplus-lf-lost-pane`, `flex: 0 0 40%` desktop / full width mobile when right pane is empty): orphan list (NOT paginated — all orphans listed with avatar + name + filename + badges), each row clickable to select. Right pane (`.chatplus-lf-match-pane`, `flex: 1 1 auto`): header with selected orphan summary, snapshot message excerpt block, candidate list, live-preview panel (scrollable reconstruction of the selected candidate's recent messages — fetched via `CoreAPI.getContext().getChatById?.(file_name)` or equivalent chat-file fetch; if no such API, read via a new `CoreAPI.fetchChatMessages(avatar, fileName, isGroup)` that calls `/api/chats/get` or `/api/chats/group/get`). Footer actions: `[Ignore]` `[Delete]` (restored) `[Relink]`. Batch bar above (Auto-Reconnect + Apply All unchanged).
      - `app/lostfound.css` — full rewrite alongside template: CSS grid or flex two-column, min-width 320px each pane; mobile-first collapses to single pane with an internal back button (shows lost list on mobile; tapping an orphan swaps to match pane; back arrow returns). Preview scroll region has its own contained overflow (`max-height: 40vh; overflow-y: auto`).
      - `modules/lost-and-found.js` — `showResolver()` rewrite: track `_selectedOrphan`, `_selectedCandidate`; on orphan-row click → re-render right pane, lazy-fetch candidate chats (debounced if user scrubs quickly); restore `Delete` button wired to `_remove()` (same code path it already has). On candidate selection → fetch that candidate's messages (limit last ~20) and render them read-only in the preview region using a minimal message-bubble layout (reuse `UIRenderer` if possible or inline simple markup — no full chat-view dependency). Snapshot message shown via `SnapshotStore.getSnapshot(orphan.chatKey)?.lastMessage`.
      - `modules/core-api.js` — add `fetchChatMessages(avatar, fileName, isGroup)` wrapper around ST's chat-file fetch endpoint (character: `POST /api/chats/get`, group: `POST /api/chats/group/get`), returns the message array. Handles the same auth-headers pattern used by `CoreAPI.deleteChat()`.
    - **Critical reference architecture**: the existing `findCandidates()` → `applyResolution()` → state-update pipeline is fully reused; only the presentation layer is replaced. `openResolverFor(scopeKeys)` and `resolveStaleKey(staleKey)` must continue to open the same revamped modal without regressing.
    - **Scope excluded**: editing messages in the preview panel (read-only); cross-avatar candidate suggestion (orphans are always resolved within the same avatar — unchanged from step 19); drag-and-drop between panes.
    - **Verification**:
      1. Open L&F with 5+ orphans across 2+ characters — left pane lists all, right pane shows empty state until one is selected.
      2. Click an orphan → right pane fills with snapshot excerpt + candidate list + empty preview; click a candidate → preview loads the last ~20 messages within 500 ms for a typical chat file.
      3. Delete button: visible, executes `_remove()`, orphan disappears from left pane, state saved.
      4. Mobile width (< 768 px): orphan list full-width; selecting one swaps to match pane with back arrow.
      5. "Auto-Reconnect Obvious" and "Apply All" unchanged behaviour.
      6. `openResolverFor(scopeKeys)` still scopes the left pane correctly.
      7. `resolveStaleKey(staleKey)` still opens the single-orphan flow via the shared modal.
    - **What shipped (initial pass)**:
      - `modules/core-api.js` — new `fetchChatMessages(avatar, fileName, isGroup)` wrapper: character → `POST /api/chats/get` with `{ ch_name: avatarBase, file_name, avatar_url: avatar }`; group → `POST /api/chats/group/get` with `{ id: fileName }`. Returns `messages[]` (strips optional metadata-object at `[0]` for character chats). Exported in the default object alongside existing helpers.
      - `app/lostfound.html` — two-pane body (`.chatplus-lf-body` → `.chatplus-lf-lost-pane` + `.chatplus-lf-match-pane`) with mobile drill-down: left pane is the orphan list, selecting a row adds `.chatplus-lf-body--detail` which hides the list and reveals the right pane on mobile; on desktop both panes stay visible side-by-side.
      - `app/lostfound.css` — full mobile-first rewrite with the drill-down class + desktop override at ≥768 px (left flex `0 0 40%` max 320 px).
      - `modules/lost-and-found.js` — `showResolver()` rewrite + new private helpers: `_renderLostListItem`, `_renderMatchContent` (back button + badges + snapshot + candidate dropdown + preview), `_renderPreviewPanel` (async fetch + stale-fetch guard via `panel.dataset.candidateKey`), `_paintPreview`, `_isGroupOrphan`, `_buildOrphanAvatar` (group collage via `CoreAPI.getGroupAvatarElement()`, character thumb via `ctx.getThumbnailUrl`, fallback to `/img/ai4.png`), `_buildOrphanDisplayName`, `_setLostItemStatus`. Deleted `_renderOrphanCard`, `_setCardStatus`, `_markCardResolved`. Delete restored as an inline confirm strip (`.chatplus-lf-confirm-strip`) rather than a blocking dialog.
    - **What shipped (feedback round — pagination + origin breakdown + side-by-side focus)**:
      - User feedback: the orphan list pane wastes real estate when only a handful of orphans exist; focus should be on side-by-side showcase of orphan vs candidate; `.chatplus-lf-before` needs to clearly show character + chat name + WHERE the chat was (Pinned vs which folder path).
      - `app/lostfound.html` — removed `.chatplus-lf-lost-pane` + orphan list. Added `.chatplus-lf-pager` strip (◀ / "N / M" / ▶) above the body. Body now has two always-visible panes: `.chatplus-lf-orphan-pane` (left) + `.chatplus-lf-candidate-pane` (right). Footer contains a single static action row (Ignore / Delete / Reconnect), the inline delete-confirm strip, and the batch-action bar — all re-bound per orphan via closures rather than rebuilt.
      - `app/lostfound.css` — full rewrite. Mobile: panes stacked. Desktop (≥768 px): orphan pane `flex 0 0 38%` (max 400 px) + candidate pane `flex 1` so preview dominates. Red-tinted orphan pane (`rgba(255,80,60,0.03)`) vs green-tinted candidate pane (`rgba(76,175,80,0.03)`) for at-a-glance orientation. New `.chatplus-lf-origin` styles (pin / folder rows with `›` breadcrumb crumbs). `.chatplus-lf-decision-chip` shows queued-action state (Relink / Delete / Ignore) in the candidate-pane header.
      - `modules/lost-and-found.js` — `showResolver()` now drives a `currentIndex` pagination state; single static footer; ArrowLeft/ArrowRight keyboard nav; Escape closes; auto-advance to next orphan after Reconnect / Ignore / Delete. Reconnect button label swaps to `Queued: Reconnect` when a decision is already staged (mirrors Ignore/Delete via the decision chip). Helpers split: `_renderOrphanPane(orphan)` — identity header (avatar + char name + filename + "Missing" tag) → origin breakdown → snapshot of last-seen message → raw chat-key footer; `_renderCandidatePane(orphan, cands, decisions, previewCache, onCandidateChanged)` — queued-decision chip + searchable dropdown + preview panel; drives reconnect-button enablement via callback. New `_buildOriginBreakdown(orphan)` — resolves `orphan.folderIds` via `CoreAPI.getFolderSystemManager().getFolderPath()`, renders 📌 Pinned row + per-folder breadcrumbs (`Parent › Child › Leaf`); deleted folders render as `(deleted folder)`; transient-only orphans get a subtle hint row. Removed now-unused `_renderLostListItem`, `_renderMatchContent`, `_setLostItemStatus`.
      - `modules/core-api.js` — no additional changes beyond the initial pass; `getFolderSystemManager()` was already exported and is now consumed by `_buildOriginBreakdown()`.

39. **Lost & Found — snapshot-assisted auto-matching (exact message + ±1 day window)** ✅ COMPLETE
    - **Rationale**: the `SnapshotStore` records each tracked chat's last-seen message text + `updatedAt` timestamp. When an orphan is detected, we already know (a) which avatar it belonged to and (b) what its last message said. We can scan all the avatar's live candidate chats for an exact-text match on any message whose timestamp falls within `[snapshot.updatedAt − 24h, snapshot.updatedAt + 24h]`. When exactly one candidate matches, confidence is effectively 100% and the resolver can auto-select it for the user (still requiring a confirmation click — no silent rewrites, per step 29's explicit decision).
    - **Approach**:
      - In `LostAndFound.findCandidates()`, after building the avatar-scoped candidate list, if a snapshot exists for the orphan, fetch each candidate's messages via the new `CoreAPI.fetchChatMessages()` (from step 38) and run the message-match pass.
      - Introduce a new confidence tier `'exact'` above `'high'`. Candidates with an exact text match inside the time window are scored `'exact'`.
      - Handle ambiguity: if multiple candidates all contain the exact message (e.g., forked chats from a continue), return all of them with `'exact'` confidence — the resolver UI (step 38) highlights them and the user picks.
      - Performance ceiling: only run the message-match pass for orphans whose snapshot is < 90 days old (configurable constant); skip otherwise to avoid scanning ancient chat files. Cache per-candidate fetched messages inside the modal session so re-selecting an orphan doesn't re-fetch.
    - **Files touched**:
      - `modules/lost-and-found.js` — new `async findCandidatesWithSnapshotMatch(orphan, snapshot)`; called by the revamped resolver (step 38) when a snapshot exists. Leaves synchronous `findCandidates()` untouched for the batch/auto-reconnect path (which should NOT block on file fetches).
      - `modules/lost-and-found.js` `_autoReconnectObvious()` — extend to opportunistically upgrade to `'exact'` confidence when a snapshot exists AND only one candidate exists (cheap case — no fetch required, pure filename match is already unambiguous). Full message-match batch in batch mode is deferred to a future step due to fetch-cost multiplier.
      - `app/lostfound.css` — new `.chatplus-lf-candidate--exact` visual treatment (stronger accent colour + checkmark icon).
    - **Constants**: `SNAPSHOT_MATCH_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000`, `SNAPSHOT_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000` — declared at module top, easily tunable later.
    - **Dependencies**: hard-depends on step 38 (`CoreAPI.fetchChatMessages()` + revamped resolver UI slot for the new confidence tier).
    - **Scope excluded**: background pre-computation of match results on app init (too much disk I/O for a cold-start path); fuzzy-match fallback inside the window (keep it strict — exact match or nothing, trading recall for precision).
    - **Verification**:
      1. Pin chat, add message "Hello world 12345", close ST, rename the `.jsonl` externally to look unrelated, reopen → L&F opens, selecting the orphan shows one candidate flagged as `exact` (snapshot message matches a message in the renamed file's window).
      2. Create a forked continuation (duplicate chat at message N, then extend both branches) so two chats contain the same last message within the window → resolver shows both as `exact`; user must pick.
      3. Snapshot timestamp > 90 days old → message-match pass skipped; falls back to filename-prefix confidence (unchanged step 19 behaviour).
      4. No snapshot for orphan → existing candidate list only (no regression).
      5. Performance: orphan with 3 candidates, 200 messages each — initial fetch completes < 1.5 s on typical hardware; repeat selections are instant (cache hit).
    - **What shipped**:
      - `modules/lost-and-found.js` — module-top constants `SNAPSHOT_MATCH_MAX_AGE_MS` (90 d) and `SNAPSHOT_MATCH_WINDOW_MS` (±24 h); extended `CandidateMatch.confidence` union with `'exact'`; new `async findCandidatesWithSnapshotMatch(orphan, snapshot, previewCache)` that reuses the modal's preview cache via `Promise.allSettled` over `CoreAPI.fetchChatMessages()`; helpers `_messagesContainSnapshotMatch()` (exact-text + in-window check) and `_parseMessageTimestamp()` (priority: `gen_started` ISO → `Date.parse(send_date)` → last-position fallback).
      - `modules/lost-and-found.js` `showResolver()` — eager sequential background snapshot scan kicked off immediately after the initial paint (guarded by `snapshotPassComplete` / `snapshotPassPromise`); upgraded candidates are merged back into `state.candidatesByKey` with selective repaint so the user sees `exact` badges as soon as each orphan finishes scanning. Initial candidate selection prefers `exact` → `high` → first.
      - `modules/lost-and-found.js` Auto-Reconnect Obvious — awaits the scan (label swaps to "Scanning snapshots…") and prefers `exact` confidence over `high` when selecting the unambiguous winner per orphan.
      - `app/lostfound.css` — added `.chatplus-lostfound-confidence--exact` treatment (cyan accent + FA checkmark `::before`).
    - **Ancillary fixes shipped alongside**:
      - `index.js` `loadAllTemplates()` — fixed a pre-existing regression where only the outer `#chatplus-lostfound-template` was extracted from `lostfound.html`, dropping ~20 sub-templates and breaking the revamped resolver. Now iterates every `<template>` in the parsed document and appends to `document.body` with id-dedupe (mirrors the folders.html pattern).
      - `modules/lost-and-found.js` `_fillOriginList()` — folder-origin rows now deduplicate ancestors: when a chat is assigned to both a parent folder and one of its descendants, only the deepest folder path is shown (display-layer only, no state mutation).
      - `app/lostfound.html` + `app/lostfound.css` + `modules/lost-and-found.js` `showResolver()` — mobile design: new `.chatplus-lf-mobile-tabs` tab bar above the panes with two tab buttons (`data-pane="orphan"` / `data-pane="candidate"`), `[data-active-pane]`-driven pane switching on mobile, hidden on desktop (≥768 px). JS wires `setActiveMobilePane()` helper and resets to `'orphan'` on every repaint.

40. **Proactive orphan re-scan — subscribe to broader ST event surface** ✅ COMPLETE
    - **Rationale**: step 29 landed the one-shot init-time scan + render-time notice pattern. However, orphans can materialise mid-session when the user renames a chat in ST's native UI, deletes a chat, or edits a character in a way that affects chat discovery. Currently we rely on `CHARACTER_RENAMED` / `CHARACTER_DELETED` (handled via `cleanOrphanedPins` + `cleanOrphanedAssignments` — **destructive**, silent) and the eventual render-time notice. Smarter: intercept those same events to fire `LostAndFound.detectOrphanedReferences()` and surface the toast banner instead of silently deleting; plus add coverage for events we don't currently subscribe to.
    - **ST event audit (source-verified against `public/scripts/events.js` + emission grep)**:
      | Event | Subscribed before | Orphan-creating? | Action taken |
      | --- | --- | --- | --- |
      | `CHARACTER_RENAMED` | yes (destructive) | yes | converted → non-destructive rescan + deterministic key remap |
      | `CHARACTER_DELETED` | yes (destructive) | yes | converted → non-destructive rescan |
      | `CHARACTER_DUPLICATED` | yes | no | unchanged |
      | `GROUP_UPDATED` | yes (debounced) | no (stable `group.id`) | unchanged |
      | `GROUP_CHAT_CREATED` | yes | no | unchanged |
      | `GROUP_CHAT_DELETED` | yes (destructive) | yes | converted → non-destructive rescan |
      | `CHAT_DELETED` | **no — added** | yes | **new subscription → rescan** |
      | `CHARACTER_RENAMED_IN_PAST_CHAT` | no | no | skipped (data-only follow-up to RENAMED) |
      | `CHARACTER_EDITED` | no | — | skipped — defined in `events.js` but never emitted |
      | `CHARACTER_PAGE_LOADED` | no | — | skipped — never emitted |
      | ST native "rename chat" UI | n/a | — | ST has no client handler for `/api/chats/rename`; no event to hook |
    - **What shipped**:
      - `utils/event-handlers.js`:
        - New `_triggerOrphanRescan(reason)` — 250ms debounced (`_rescanDebounceTimer`), coalesces burst events; pipeline is `await chatRepository.rebuildIndex()` → `lostAndFound.scan()` → emit `'lost-found-orphans-detected'` with `{ report, candidates, reason, reasons }` when `report.orphans.length > 0` → `recentChatsView.refresh()` unconditionally. Last-reason-wins for banner copy; full reason list retained in console log.
        - New `_onChatDeleted(data)` + `CHAT_DELETED` subscription — full rebuild via rescan (payload is filename-only, avatar unknown; debounce absorbs bulk-delete bursts).
        - `_onCharacterRenamed` rewritten: accepts positional `(oldAvatar, newAvatar)` (ST emits two string args) with defensive fallback for object / single-string shapes; invalidates both avatars; calls new `_remapCharacterAvatar(oldAvatar, newAvatar)` helper then triggers rescan. **Subscription updated to `(...args) => this._onCharacterRenamed(...args)`** so the second positional arg survives the `CoreAPI.onSTEvent` wrapper.
        - `_remapCharacterAvatar(oldAvatar, newAvatar)` — deterministic rewrite of every `${oldAvatar}:${filename}` key in `pinnedChats` (dedup on collision via Set), `chatFolders` (folder-ID union on collision), and `snapshotStore._db.snapshots` (via `updateKey()`). Returns count of remapped keys.
        - `_onCharacterDeleted` / `_onGroupChatDeleted`: dropped `cleanOrphanedPins()` + `cleanOrphanedAssignments()` calls; call `_triggerOrphanRescan(reason)` instead.
        - Constructor accepts new `lostAndFound` module; `destroy()` clears the new debounce timer and empties pending reasons list.
      - `app/chatplus.js`:
        - New `_showLostFoundBanner({ report, candidates, reason })` — reason-aware toast copy (`init` / `character-renamed` / `character-deleted` / `chat-deleted` / `group-chat-deleted`); single notification code path shared by init scan and the event-driven pipeline.
        - Phase 3 init-scan inline `toastr.warning(...)` block replaced by a call to `_showLostFoundBanner({ report, candidates, reason: 'init' })`.
        - `setupEventListeners()` plumbs `lostAndFound: this.lostAndFound` into `EventHandlers` and subscribes to `'lost-found-orphans-detected'` via `CoreAPI.on(...)`; unsubscriber stored at `this._lostFoundUnsub` and invoked in `destroy()`.
    - **Decision (Option A — locked in)**: on `CHARACTER_RENAMED`, we auto-remap avatar keys deterministically instead of feeding the rename into the Lost & Found pipeline. ST gives us the exact `(oldAvatar, newAvatar)` mapping, so post-rename keys are correct without requiring a user resolver round-trip. The rescan still runs afterwards to surface any unrelated orphans that may exist.
    - **Decision (non-destructive shift)**: `CHARACTER_DELETED` / `CHAT_DELETED` / `GROUP_CHAT_DELETED` no longer silently wipe pins / folder assignments. Users see a banner and decide via the resolver. Call out in release notes.
    - **Files touched**:
      - `utils/event-handlers.js` — new helpers + handler rewrites, new `CHAT_DELETED` listener, constructor signature.
      - `app/chatplus.js` — init-scan refactor, banner helper, event subscription, destroy cleanup.
      - `modules/lost-and-found.js` — **not touched**; existing `scan()` returning `{ report, candidates }` was sufficient.
    - **Scope excluded**: polling file-system changes; `FileSystemObserver` hacks; any mechanism involving direct chat-file watching. External filesystem mutations remain the manual-scan fallback from step 19.
    - **Verification**:
      1. Rename a character via ST's character editor — no destructive debug log; matching pins/folders/snapshots are remapped to the new avatar; no banner when remap covers everything; banner appears only if unrelated orphans exist.
      2. Delete a character with pinned chats — banner appears, pins remain resolvable via the resolver; previously-silent destructive cleanup path verified gone.
      3. Delete a single chat via ST's "Manage chat files" dialog — `[ChatPlus2] CHAT_DELETED` console log + banner with chat-deleted copy; resolver opens via toast click.
      4. Rapid-fire burst (rename + delete + delete within 250ms) — single debounced banner with combined count; `reasons` array in console log contains all triggers.
      5. Zero orphans after any event — no banner, no noise.
      6. Extension `destroy()` — no lingering `_rescanDebounceTimer`, no leaked `'lost-found-orphans-detected'` listener.

41. **First-run onboarding tutorial — in-app sandbox tour + settings entry + v1 migration handoff**
    - **Rationale**: the extension now has rich functionality (tabs, edit mode, folders, pin, L&F, snapshots, migration, multi-select, deletion) that is not discoverable without guided exposure. A short, skippable tour that walks through each UI landmark — demonstrated against a temporary hardcoded sandbox dataset — onboards both new users (triggered automatically when `pinnedChats`, `folders`, and `chatFolders` are all empty) and existing users (accessible any time via a settings button). The v1 migration flow can be folded into the same tour so users upgrading from ChatPlus 1 see the migration step in context with the features it unlocks.
    - **Structural approach**:
      - **Sandbox data model**: an in-memory `OnboardingSandbox` class that synthesizes 3 fake characters (e.g., "Aria", "Kai", "Nova") with 2 chats each, plus 1 fake group chat — all served via a scoped override of `CoreAPI.getAllChatsWithStats()` and `CoreAPI.getChatByKey()` that the tour temporarily monkey-patches (or, cleaner: the tour calls `ChatRepository.injectSandboxChats()` which prepends a synthetic batch and auto-clears on tour end). Nothing hits disk; the fake avatars render as data-URI SVG thumbnails.
      - **Tour engine**: a minimal home-grown spotlight-overlay (no external library) — class `TourRunner` with an ordered array of `TourStep { targetSelector, title, body, placement, action? }`. Each step dims the page via an overlay with a cut-out clip-path around the target, shows a tooltip with Next/Skip/Prev, and optionally auto-triggers an `action` (e.g., "click the folders tab", "open Add Chats panel"). On Skip or tour-end, sandbox is torn down and UI returns to real data.
      - **Tour script (ordered steps, 15–18 stops)**: tab bar → Recent tab → search bar → reload button → edit mode toggle → pin button on a row → add-to-folder popover → Folders tab → New Folder button → folder header → gear toggle → Add Chats panel → Lost & Found settings entry → Snapshot Database viewer → v1 Migration section (only shown if `extensionSettings.chatsPlus` exists).
    - **Files touched**:
      - **New** `modules/onboarding.js` — exports `class OnboardingTour` with `run()`, `skip()`, `isCompleted()`. Tour steps defined as a static array constant.
      - **New** `app/onboarding.html` — `<template id="chatplus-onboarding-template">` with overlay + tooltip skeleton (title, body, button row, step counter).
      - **New** `app/onboarding.css` — spotlight overlay (`::before` dim layer + `::after` cut-out via `box-shadow: 0 0 0 100vmax rgba(0,0,0,0.6)` on the target wrapper), tooltip positioning (top/bottom/left/right), responsive mobile fallback (bottom-sheet when no room).
      - `app/chatplus.css` — one `@import url('./onboarding.css');`.
      - `app/settings.html` — new Maintenance-group button `#chatplus2-settings-onboarding` ("Show Tutorial" / `fa-circle-question`).
      - `index.js` — load `onboarding.html` in the parallel `loadAllTemplates()` fetch. After `APP_READY` + all initialization, check `settings._onboardingCompleted` and `settings.pinnedChats/folders/chatFolders` emptiness; if both conditions point to first-run, call `new OnboardingTour().run()`. Wire the settings-panel button. On tour completion, set `settings._onboardingCompleted = true` + save.
      - `modules/state-manager.js` — add `_onboardingCompleted: false` to `DEFAULT_SETTINGS`.
      - `modules/chat-repository.js` — add `injectSandboxChats(chats)` + `clearSandbox()` methods that prepend/remove a scoped batch while the tour is live. Emit a `'sandbox-mode'` event so views can repaint with the synthetic data.
    - **v1 migration handoff integration**: if `MigrationHelper` detects v1 data during tour execution, the migration step shows a live "Migrate Now" CTA (same handler as the settings panel); completing or skipping migration advances the tour. Users can also finish the tour first and migrate later from settings.
    - **Scope excluded**: branching tour paths (e.g., "new user" vs "v1 upgrader" as fully separate scripts — keep it linear with conditional steps); interactive guided tasks that require real data ("pin this specific chat"); localization / i18n strings (hardcoded English for now).
    - **Verification**:
      1. Fresh install (wipe `extensionSettings.chatPlus2`): extension boots → tour auto-runs after `APP_READY` with the sandbox chats visible in Recent.
      2. Skip mid-tour: overlay dismisses cleanly, sandbox torn down, real data restored, `_onboardingCompleted = true` saved, no auto-trigger on next reload.
      3. Click "Show Tutorial" from settings: tour re-runs, sandbox re-injected, no conflict with real data (avatars clearly marked synthetic).
      4. v1 data present: tour ends on the migration step with live "Migrate Now" CTA; running migration then resuming tour works.
      5. No console errors across all tour steps; mobile viewport shows bottom-sheet tooltip correctly.
      6. Tooltip repositions within viewport on small screens (no overflow cutoffs).
      7. Clean teardown: after any exit path, `ChatRepository.clearSandbox()` confirmed called, subsequent UI interactions show only real chats.

42. **(BUG) "Recent List Layout" does not switch properly, does not update/reset the "Recent chats" view properly, still shows the avatar on each chat item entry even when "Grouped by character" is selected.** ✅ COMPLETE
    - **Root causes identified**:
      1. **Stale StateManager cache**: the Settings panel mutated `extensionSettings.chatPlus2` directly (`settings.recentListGroupByCharacter = grouped; saveSettings()`), but `StateManager.settings` is a _separate cached copy_ built via `{ ...DEFAULT, ...extensionSettings.chatPlus2 }` in `load()`. Reads through `stateManager.get('recentListGroupByCharacter')` inside `RecentChatsView._sortChats()` / `_renderPage()` returned the pre-toggle value, so `recentView.refresh()` rebuilt the list with the old layout. The same latent bug affected the `pageSize` setting.
      2. **Avatar unconditionally rendered on every row**: `UIRenderer.renderChatItem()` always called `_buildAvatar(chat)`. Nothing respected the grouped layout, so each row showed a 40 px avatar duplicating the character-separator avatar above the cluster — directly contradicting step 36's stated motivation.
    - **Phase 1 — Fix setting propagation** (`index.js` `wireSettingsPanel()`):
      - Layout toggle handler + page-size `<select>` handler now route writes through `coordinatorRef?.stateManager?.set(key, value)`. StateManager's `set()` mutates `this.settings[key]` _and_ triggers the debounced save, so the cache stays in sync with the persisted object in a single call. Graceful fallback to the old direct-mutation path if the coordinator isn't accessible (defensive only — never exercised in normal runtime).
      - Page-size change now also triggers `recentView.refresh()` immediately (parity with the layout toggle's already-present refresh), so the new page size takes effect without waiting for the next natural refresh event.
    - **Phase 2 — Hide row avatars under the character separator**:
      - `modules/ui-renderer.js` `renderChatItem()` — new `includeAvatar = true` option added to the destructured options block. When `false`, the `_buildAvatar(chat)` append is skipped and `.chatplus-chat-item--no-avatar` is applied to the item for CSS hooks. JSDoc updated.
      - `modules/recent-chats.js` `_renderPage()` — computes `const hideAvatar = groupByCharacter && !isFiltered;` (identical gating to the existing `includeEntityPrefix` flag) and passes `includeAvatar: !hideAvatar`. Pinned section, FoldersView, and Add-Chats compact picker intentionally don't pass the new option, so they default to `true` and continue showing avatars (they don't emit character separators, so their thumbnails remain the only entity cue).
    - **Phase 3 — CSS polish** (`app/chatplus.css`):
      - New `.chatplus-chat-item--no-avatar` rule: `padding-left: 1.75rem` so the filename-only rows visibly nest under the character separator; relaxed `min-height: 0` since the 40 px avatar no longer anchors the row.
      - `.chatplus-chat-item--no-avatar.chatplus-chat-item--pinned` and `--active` variants use `calc(1.75rem - 2px)` to preserve the 2 px accent-border compensation without losing the indent.
    - **Phase 4 — Settings preview mockup**:
      - Verified static "Grouped by character" preview in `app/settings.html` already renders filename-only rows without per-row avatar dots under the character header. No markup/CSS change needed — the mock already matches the fixed live behaviour.
    - **Files touched**:
      - `index.js` — `wireSettingsPanel()` page-size + layout handlers
      - `modules/ui-renderer.js` — `renderChatItem()` options + avatar gate
      - `modules/recent-chats.js` — `_renderPage()` avatar-gating condition
      - `app/chatplus.css` — `.chatplus-chat-item--no-avatar` rule set
    - **Decisions locked**:
      - Route all Settings UI writes through `stateManager.set()` — architectural fix; keeps cache and persisted object in sync automatically. Chose not to refactor StateManager to drop its cache and read live from `extensionSettings` — larger blast radius than necessary.
      - Avatar-hide condition mirrors the separator-emit condition exactly (`groupByCharacter && !isFiltered`); no new preference introduced.
      - Pinned section retains avatars in both layouts — it never emits a character separator, so the thumbnail is its only entity cue.
    - **Scope excluded**: `getSettings()` helper refactor, migration path changes, pinned/folder/add-chat row rendering, character-separator DOM itself.

43. **(Feedback round)** ✅ COMPLETE
    - Moving ChatPlus2 above "#rm_PinAndTabs" again like in ChatPlus1
    - Settings page "this setting needs a reload" => add a "reload now" button
    - "#chatplus-recent-reload" needs the same styling as "#chatplus-recent-edit-toggle"
    - "Characters" tab button should show an icon of a single person if clicking it would take us to the character card and multiple persons if clicking it takes us to the character list. Part of this behavior is already present through the clicking = switching from those two states
    - Chat entries' "Add to folder" button should be an icon of a normal folder. The folder with a plus sign should be reserved for creating folders
    - In the folders tab, the "+ New Folder" button should be replaced by the "Folder with a plus sign" icon. This will make that toolbar design in-line with the "Recent chats" one
    - While doing delicate operations like loading a chat, further actions should be blocked until the first one is finished (and maybe adding some feedback like a loading spinner overlay on the whole extension to make it clear that something is happening and prevent misclicks)
    - **43a — Tabs placement above `#rm_PinAndTabs`**: `index.js` `injectTabsIntoUI()` flipped from `insertBefore(container, pinAndTabs.nextSibling)` → `insertBefore(container, pinAndTabs)`. Pure additive injection (no DOM reparenting) so the step-31 group-chat regression does not recur.
    - **43a follow-up — hide `#rm_PinAndTabs` on non-Characters tabs (2026-04-25)**: with the tabs now sitting _above_ `#rm_PinAndTabs`, the selected-character / token-info bar (`#rm_PinAndTabs` → `#right-nav-panel-tabs` containing `#rm_button_selected_ch` and `#result_info`) remained visible between our tab bar and our injected panel when Recent/Folders were active. Fixed in `modules/tab-controller.js`: `init()` now also caches `document.getElementById('rm_PinAndTabs')` as `_stPinAndTabs`, and `activateTab(name)` toggles `.chatplus-native-hidden` on it in lockstep with `_stNativeContainer` (`hide` when `name !== 'characters'`). No HTML/CSS changes — reuses the existing `.chatplus-native-hidden { display: none !important; }` helper from step 31. Verified: Recent/Folders panels render flush against the ChatPlus tab bar; switching back to Characters restores the bar; group-member actions (step-31 regression) remain unaffected because no DOM is moved.
    - **43b — "Reload now" inline button next to Enable toggle**: `app/settings.html` adds `#chatplus2-settings-inline-reload` (class `menu_button chatplus-settings-inline-reload`, icon `fa-arrows-rotate`, `hidden` by default) inside the same section as the Enable checkbox. `index.js` `wireSettingsPanel()` snapshots `initialEnabled` on wire, defines `syncInlineReload()` that reveals the button only when `checkbox.checked !== initialEnabled`, and wires its click to `location.reload()` (full reload because the Enable flag gates top-level module init). CSS in `app/settings.css` scopes `.chatplus-settings-inline-reload` with `align-self: flex-start` and respects `[hidden]`.
    - **43c — Edit toggle styling parity**: `modules/ui-renderer.js` `renderEditToggle()` now emits `className = 'menu_button chatplus-icon-btn chatplus-edit-toggle'` (dropped `.chatplus-action-btn`); `modules/recent-chats.js` no longer post-hoc `classList.add('chatplus-icon-btn')` on the button. `app/chatplus.css` replaced the standalone `.chatplus-edit-toggle` baseline rules with a single active-state rule (`.chatplus-edit-toggle.chatplus-icon-btn--active, .chatplus-edit-toggle--active { background: var(--SmartThemeFavColor, …) !important; color: var(--SmartThemeBodyColor) }`) — size, padding, hover are inherited from `menu_button + chatplus-icon-btn` so reload + edit-toggle are visually identical (36×36).
    - **43d — Characters tab icon state swap (`fa-users` ↔ `fa-user`)**: `modules/tab-controller.js` — constructor caches `_charactersIconObserver` + `_charactersIconEl`; `init()` caches the `<i>` and attaches a `MutationObserver` on `#rm_ch_create_block` watching `style`+`class`. New `_updateCharactersIcon()` reads the same `getComputedStyle(createBlock).display !== 'none'` check `_handleReclick()` uses: list visible → `fa-user` (next click goes to the card); list hidden → `fa-users` (next click goes to the list). Called from `init()`, `activateTab()`, `_handleChatChanged()` (re-emit path), and `_handleReclick()` via `requestAnimationFrame` (ST flips `display` synchronously but our observer also catches the change). `destroy()` disconnects the observer and nulls the cached element.
    - **43e — "Add to folder" button icon**: `modules/ui-renderer.js` `_buildChatActions()` switched `'fa-solid fa-folder-plus'` → `'fa-solid fa-folder'` in the `onAddToFolder` branch. `fa-folder-plus` is now reserved exclusively for folder-creation controls (`#chatplus-new-folder` + the content-manager "+ Subfolder" button).
    - **43f — "+ New Folder" icon button**: already shipped in step 37 (icon-only `fa-folder-plus` at `#chatplus-new-folder`); confirmed, no changes.
    - **43g — Loading overlay + re-entrancy guard**:
      - `app/chatplus.html` — `#chatplus-loading-overlay` (`role="status"`, `aria-live="polite"`, `hidden` by default) added inside `.chatplus-tab-panels` so it only dims the ChatPlus tab-contents area. ST's `.scrollableInner` (Characters tab) sits outside this container and is never covered; the user can still drive the Characters list, top bar, and chat area while one of our operations is in flight.
      - `app/chatplus.css` — `.chatplus-loading-overlay` rules (`position: absolute; inset: 0; z-index: 8000; display: flex; backdrop-filter: blur(1px)`; inner `.chatplus-loading-overlay-inner` pill with spinner icon + label; `chatplus-overlay-fade-in` keyframe).
      - `modules/core-api.js` — three new helpers above `showToast()`: `showLoadingOverlay(label)`, `hideLoadingOverlay()`, `withLoadingOverlay(fn, label)`. Module-level `_overlayRefcount`, `_overlayShowTimer`, `_overlayVisible` implement a **delayed-show** pattern: `showLoadingOverlay` increments the refcount and schedules a 150 ms timer; if `hideLoadingOverlay` runs before the timer fires (fast op) the overlay is never painted — no flicker. Nested callers are transparent because each call increments the refcount; the overlay only hides when the counter reaches zero. All three helpers are exported on the default object.
      - Re-entrancy guard in `openChat()`: module-level `_chatOpenInProgress` flag. A second entry while the first is pending returns `false` immediately with an info toast "Please wait for the current chat to finish loading". The flag is cleared in a `finally`. The internal body was extracted to `_openChatInternal(chat)` to keep the guard surface shallow.
      - `openChat()` also wraps its internal call in `showLoadingOverlay('Opening chat…')` / `hideLoadingOverlay()` — the Lost & Found retry path, Recent-tab `_openChat`, and Folders-tab `_openChat` all benefit without per-caller changes.
      - `deleteChat()` follows the same internal-split pattern with `showLoadingOverlay('Deleting chat…')`. The bulk-delete loop in `modules/recent-chats.js` `_handleBulkAction` wraps the whole loop in one `showLoadingOverlay` / `hideLoadingOverlay` pair so the overlay stays up continuously across the N delete calls instead of flashing once per chat (the refcount scheme handles the outer-pair-plus-per-call nesting automatically).
    - **Recent List Layout live re-render (user's note 3)**: verified already handled by step 42 — `index.js` `wireSettingsPanel()` already calls `coordinatorRef.recentChatsView.refresh()` on layout-button click, and `refresh() → render()` re-reads the `recentListGroupByCharacter` setting via `stateManager.get()`. No reload disclaimer needed; no additional code change shipped.
    - **Files touched**:
      - `index.js` — `injectTabsIntoUI()` (43a), `wireSettingsPanel()` enable-toggle wiring (43b)
      - `app/chatplus.html` — loading overlay DOM (43g)
      - `app/chatplus.css` — `.chatplus-loading-overlay` rules (43g), `.chatplus-edit-toggle` replaced with active-state-only rule (43c)
      - `app/settings.html` — inline "Reload now" button (43b)
      - `app/settings.css` — `.chatplus-settings-inline-reload` layout (43b)
      - `modules/core-api.js` — overlay helpers, `openChat` / `deleteChat` overlay wrapping, `_chatOpenInProgress` guard, default-export additions (43g)
      - `modules/tab-controller.js` — characters-icon state swap + MutationObserver + teardown (43d)
      - `modules/ui-renderer.js` — `renderEditToggle()` class rewrite (43c), add-to-folder icon swap (43e)
      - `modules/recent-chats.js` — removed redundant `classList.add('chatplus-icon-btn')` (43c), bulk-delete overlay wrapping (43g)
    - **Verification**:
      1. Reload ST → ChatPlus2 tab bar renders _above_ `#rm_PinAndTabs`; group-member Remove / Move up / Move down still mutate correctly; step-31 regression does not return.
      2. Toggle Enable checkbox → inline "Reload now" button appears; toggle back to original value → button hides again; click button → full page reload.
      3. `#chatplus-recent-reload` and `#chatplus-recent-edit-toggle` are visually identical (36×36, same padding, same hover); reload's `fa-spin` state still works; edit-mode active highlight is unambiguous via the favorite-color background.
      4. Characters tab icon: list view visible → `fa-users`; select a character (card view) → icon flips to `fa-user`; click ST's native "Back to character list" button → icon flips back without any ChatPlus interaction (MutationObserver coverage).
      5. Every chat row shows plain `fa-folder` for "Add to folder"; `fa-folder-plus` is only on `#chatplus-new-folder` and content-manager subfolder buttons.
      6. Open a chat from Recent → overlay appears after ~150 ms (instant for slow opens, invisible for fast ones); rapid triple-click → 2nd and 3rd click produce an info toast and no-op; first click completes cleanly.
      7. Bulk-delete 5 chats from edit mode → overlay stays up continuously through the sequence (no flicker between items); list refreshes once at the end.
      8. Recent List Layout switch (Flat ↔ Grouped) → Recent tab re-renders immediately with the new layout; no reload needed.
      9. Grep `fa-folder-plus` → only remains in creation contexts (`#chatplus-new-folder`, `+ Subfolder` button in step 22 content manager).

44. **(Feedback round 2)** ✅ COMPLETE
    - Lost & Found - Find better way to display candidate chats on mobile because current approach forces focus on the search bar and that display the keyboard and we run out of screen and squish everything
    - Sort pinned chats by character alphabetically and then the chats alphabetically. Folder chats too
    - After filtering and deleting chats from a filtered list, the recent chats chat list got fumbled hard:
      - ALL the chats from the character of the deleted chats were gone until a reload was enforced
      - The filtering got lost after the deletion
      - Some weird chat shenanigans happened because it feels like there's a duplicate of another chat now? Confirm pop-up also needs to specify the list of chats being deleted somewhat neatly (instead of "Do you want to delete N chats?")
    - I need to add a feedback button that allows users to send me a ticket or a report
    - **44a — L&F candidate dropdown: mobile-friendly behaviour**:
      - **Root cause**: `_renderCandidateDropdown()` in `modules/lost-and-found.js` unconditionally `requestAnimationFrame(() => search.focus())` on every trigger-tap. On mobile (coarse pointer) this pops the on-screen keyboard inside the bottom-sheet modal (`85vh`), squeezing the candidate list + preview into an unusable sliver.
      - `modules/lost-and-found.js` `_renderCandidateDropdown()` — gated `search.focus()` behind `window.matchMedia('(hover: hover) and (pointer: fine)').matches` (cached as `canHoverFocus` at dropdown-build time). Touch devices skip the auto-focus entirely; tapping the search input is now an explicit, opt-in action. Also added a `showSearch = cands.length > 1` short-circuit that hides the search input when there's nothing to filter (saves vertical space on mobile and removes a redundant control in the single-candidate case).
      - `app/lostfound.css` — new `@media screen and (max-width: 767px)` block above the existing desktop overrides. Sets `.chatplus-lf-dropdown-panel { max-height: 50vh; display: flex; flex-direction: column; }` so the panel stays usable when the user _does_ deliberately tap the search (panel + options coexist within the bottom-sheet's free space). `.chatplus-lf-dropdown-options` becomes the scroll container (`flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch`). Touch-friendly row padding bumped to 12 px. Search input font-size set to `16px` to suppress iOS Safari's auto-zoom-on-focus.
    - **44b — Alphabetical sort for folder chats**:
      - **Pinned chats**: already sorted by `(character_name → file_name)` inside `PinnedChatsManager.getAllPinned()` (verified L195–201). No code change.
      - `modules/folders-view.js` `_renderFolderContents()` — pre-resolved live chats are now collected into a `liveChats` array, sorted by `character_name.localeCompare()` then `file_name.localeCompare()`, and rendered after the sort. Stale (orphan) keys are appended after the live block — keeping the existing aggregate "review in Lost & Found" notice flow intact at the trailing position. Folder assignment storage order remains untouched (sort is a render-time concern only).
    - **44c — Recent-tab post-delete cache regression + smarter confirm dialog**:
      - **Root cause (1, 2, 3)**: both `_handleDelete()` and `_handleBulkAction('delete')` called `chatRepository.invalidateAvatar(chat.avatar)` after each successful delete. `invalidateAvatar()` (chat-repository.js L371–L389) **wipes every chat for that avatar** from `chatCache` + `chatsByAvatar`. The follow-up `refresh()` then read from a now-empty avatar slice, so every chat for the deleted chat's character vanished from the Recent view until the next full `fetchAllChats()` (manual reload). The "filter lost" and "duplicate" symptoms were downstream artifacts of the same wipe.
      - `modules/chat-repository.js` — new `async refetchAvatar(avatar, isGroup = false)` method. Drops the avatar's cache via the existing `invalidateAvatar()`, then re-runs the appropriate per-entity fetch (`_fetchCharacterChats` or `_fetchGroupChats`), and re-indexes the returned chats into `chatCache` + `chatsByAvatar`. Surgical: only the deleted chat is missing from the repopulated set; siblings remain visible. Returns void (errors logged, never thrown). Idempotent — safe to call repeatedly.
      - `modules/recent-chats.js` `_handleDelete()` — replaced the optimistic DOM removal + `invalidateAvatar()` pair with a single `await CoreAPI.getChatRepository()?.refetchAvatar(chat.avatar, !!chat.is_group)` followed by `await this.refresh()`. The full re-render handles the visual update consistently and preserves `_filterQuery` (which `refresh() → render()` already passes through unchanged).
      - `modules/recent-chats.js` `_handleBulkAction('delete')` — collects unique avatars during the loop into a `Map<avatar, isGroup>`, calls `refetchAvatar()` once per unique avatar **inside** the existing `showLoadingOverlay`/`hideLoadingOverlay` pair (so the overlay stays continuous through the refetch). Drops the per-chat `invalidateAvatar()` call. Behaviour for pin/folder bulk actions unchanged.
      - **Confirm dialog upgrade (issue 4)**: bulk-delete confirmation now builds an HTML body with up to 10 `<charName>: <fileName>` entries (escaped via `_escapeHtml`) inside a scrollable `<ul>` (max-height 240px), plus an "…and N more" tail when the selection exceeds the preview limit. Passed to `CoreAPI.showConfirmation()` which forwards `text` to `SillyTavern.Popup.show({ type: 'confirm' })` — Popup renders HTML directly. Single-delete dialog already named the chat, so it was left unchanged.
    - **44d — Feedback / bug-report button**:
      - `app/settings.html` Maintenance section — new `chatplus-settings-section` placed after the Updates section and before the V1 Migration Notice. Label "Feedback & Bug Reports", hint "Open a ticket on GitHub. Include reproduction steps and console logs when possible.", button `#chatplus2-settings-feedback` with icon `fa-solid fa-bug` and label "Report an Issue".
      - `index.js` `wireSettingsPanel()` — new click handler immediately after the Check for Updates handler. Opens `https://github.com/SoFizzticated/SillyTavern-ChatPlus2/issues/new` (matches `manifest.json` `homePage`) via `window.open(url, '_blank', 'noopener,noreferrer')`. No state, no event wiring, no in-app form.
    - **Files touched**:
      - `modules/lost-and-found.js` — `_renderCandidateDropdown()` focus gating + single-candidate search hide (44a)
      - `app/lostfound.css` — mobile dropdown panel rules (44a)
      - `modules/folders-view.js` — `_renderFolderContents()` live-chat sort + orphan-tail rendering (44b)
      - `modules/chat-repository.js` — new `refetchAvatar()` method (44c)
      - `modules/recent-chats.js` — `_handleDelete()` + `_handleBulkAction('delete')` switched to `refetchAvatar()`; HTML chat-list confirm body (44c)
      - `app/settings.html` — Feedback & Bug Reports section (44d)
      - `index.js` — `wireSettingsPanel()` Feedback button handler (44d)
    - **Decisions locked**:
      - **44a focus-gating, not redesign**: kept the existing dropdown structure and selectively disabled the auto-focus on coarse pointers. Lower risk, narrower diff than a full mobile bottom-sheet rebuild; addresses the actual reported pain point without regressing desktop muscle-memory (where the auto-focus enables type-to-search).
      - **44b render-time sort**: chats inside folders are not stored sorted (folder assignment list preserves insertion order, which remains legitimate state for any future reorder UX). Sort happens at render time only — zero migration cost.
      - **44c targeted refetch over full rebuildIndex**: `refetchAvatar()` re-runs only the affected entity's fetch endpoint; full `rebuildIndex()` would also fire `chat-index-rebuilt` and re-fetch every character + group on the user's account. The targeted approach is O(1) endpoints regardless of total chat count.
      - **44c HTML confirm body**: ST's `SillyTavern.Popup.show({ text })` renders HTML — confirmed in `core-api.js` `showConfirmation()` which passes `text: message` straight through. Limit list to 10 entries to keep the dialog scannable without scroll-fatigue; longer selections collapse to "…and N more".
      - **44d external link, no in-app form**: a GitHub-issues deep-link is the lowest-friction option for both the user and the maintainer (no server, no PII handling, no telemetry). The `noopener,noreferrer` rel keeps the new tab from accessing `window.opener`.
    - **Verification**:
      1. **44a desktop (≥768 px, hover-capable)**: tap the candidate dropdown trigger → panel opens, search input auto-focuses, type-to-filter works as before.
      2. **44a mobile (375×667, no hover)**: tap the candidate dropdown trigger → panel opens, search input is **not** auto-focused, on-screen keyboard does not appear, candidate options + preview remain visible. Deliberately tap the search input → keyboard opens, panel + options scroll within `50vh`, list remains usable.
      3. **44a single-candidate**: orphan with one candidate → search input is hidden (no value to filter), trigger + single option only.
      4. **44b folder sort**: assign 5+ chats from 3 different characters to one folder in random order → expand folder, entries appear sorted by character name then filename. Pinned-section regression check: no order change.
      5. **44c cache fix (single delete)**: filter Recent for one character with 5+ chats; delete one → other 4 chats remain visible immediately, filter text still applied, no manual reload needed.
      6. **44c cache fix (bulk delete)**: edit-mode select 4 chats spanning 2 characters → bulk-delete → both characters' remaining chats are still visible; filter (if active) still applied.
      7. **44c confirm dialog**: select 15 chats and trigger bulk delete → dialog shows first 10 lines as `<charName>: <fileName>` + "…and 5 more"; HTML metacharacters in filenames render as text (escaped).
      8. **44d feedback**: click "Report an Issue" → new tab opens to the GitHub issues new-ticket page; original ST tab unaffected; `window.opener === null` in the new tab (`noopener` honoured).
    - **Out of scope**:
      - Redesigning the L&F candidate dropdown component (e.g., converting to native `<datalist>`, fullscreen sheet, or virtualised list).
      - Persisting folder-chat sort preferences (sort is fixed alphabetical per user request; future drag-to-reorder is left as a separate request).
      - Touching `invalidateAvatar()` callers in non-delete paths (`CHARACTER_RENAMED` / `CHARACTER_DELETED` / `GROUP_UPDATED` already follow up with `rebuildIndex()` or full `fetchAllChats()` and don't exhibit the regression).
      - In-app feedback form, screenshot capture, or telemetry — `noopener` external link only.
    - **44d — Deletion pipeline audit & elegant orchestrator** ✅ COMPLETE
      - **Rationale**: 44c's view-layer choreography (cleanup → refetch → refresh, called from two near-duplicate paths in `_handleDelete` and `_handleBulkAction`) had `cleanOrphanedPins()` running against a stale cache. Pins for the just-deleted chat survived the cleanup (cache still contained the chat), then `_renderPinnedSection()` failed to find the chat in `_allSortedChats` and rendered a Lost & Found stale-key placeholder where the deleted chat used to be — the visible "pinned chats popping into view" regression.
      - **Phase 1 — Centralise the pipeline in `modules/core-api.js`**:
        - Added `deleteChats(chats)` orchestrator beside `deleteChat()`. Order is the correctness fix: server delete → unique-avatar `refetchAvatar()` (cache fresh) → `cleanOrphanedPins()` → `cleanOrphanedAssignments()` → emit `'repository-mutated'`. Returns `{ deleted, failed }`.
        - Internal calls bypass the per-chat overlay via `_deleteChatInternal` so the caller's single overlay span stays continuous.
        - Caller owns the loading overlay (orchestrator can run from non-UI contexts).
        - Each phase wrapped in try/catch so a single failure (e.g. cleanup throw) doesn't break the rest.
      - **Phase 2 — Slim view call sites in `modules/recent-chats.js`**:
        - `_handleDelete` collapsed to: confirm → overlay → `await CoreAPI.deleteChats([chat])` → toast. Removed all direct `cleanOrphanedPins`, `cleanOrphanedAssignments`, `refetchAvatar`, and `refresh()` calls (~25 → ~12 lines).
        - `_handleBulkAction('delete')` similarly slimmed; preview list and edit-mode exit unchanged. Removed the affected-avatars loop and explicit refresh. Failure path now reports `Deleted N; M failed` when partial success occurs.
        - Subscribed to `'repository-mutated'` (alongside existing `tab-activated` / `search-filter-changed` / `lost-found-resolved`) → calls `refresh()` which preserves `_filterQuery`. Unregistered in `destroy()`.
      - **Phase 3 — `modules/folders-view.js`** subscribes to the same `'repository-mutated'` event for future-proofing (no current per-row delete path there); reuses the existing `_foldersChangedHandler` callback.
      - **Decisions locked**:
        - Surgical `refetchAvatar()` over full `rebuildIndex()` — already implemented, fast, sufficient.
        - `'repository-mutated'` event over view-by-view explicit calls — matches existing `chat-pinned` / `folders-changed` patterns.
        - Loading overlay stays in callers (UX is a call-site concern; orchestrator is reusable from headless contexts).
        - No new abstraction — CoreAPI is already the right home for cross-module orchestration.
      - **Files touched**:
        - `modules/core-api.js` — `deleteChats()` orchestrator + default-export entry.
        - `modules/recent-chats.js` — `_handleDelete` + `_handleBulkAction('delete')` rewrites; new `_repositoryMutatedHandler` registration / cleanup.
        - `modules/folders-view.js` — `_repositoryMutatedHandler` registration / cleanup (aliases existing folders-changed handler).
      - **Verification**:
        1. Pin a chat, delete it from Recent → no Lost & Found stale-key placeholder appears in the pinned section; entry just disappears.
        2. Bulk delete in edit mode (5 chats across 2 characters) → single overlay span, filter preserved, edit mode exits, no orphan placeholders.
        3. Delete chat assigned to a folder → folders view (when reopened or open) shows no stale entry.
        4. Search filter active during delete → query still applied after re-render.
        5. Partial-success path: returns accurate `{ deleted, failed }`; cleanup still runs for the chats that did delete.

45. **Due to the increased reliance on the Lost&Found module, an audit to improve the "snapshot" module and make it way more reliable is necessary**

46. **Dialog audit — migrate every confirm/input/alert to SillyTavern's Popup API**
    - **Rationale**: `CoreAPI.showConfirmation()` and `CoreAPI.showInput()` were originally written against an imagined `SillyTavern.Popup.show({ ... })` options-object signature, but the real ST API is the `Popup.show.confirm(header, text, opts)` / `Popup.show.input(...)` helper namespace exposed on `getContext().Popup`. The mismatch silently fell through to the browser's native `confirm()` / `prompt()`, which renders HTML message bodies as raw text (visible in the bulk-delete dialog where `<p>`, `<ul>`, `<strong>` tags showed up inline). The two helpers were patched in this round; this step audits the rest of the codebase to ensure every dialog routes through the now-correct helpers and gets the styling, theming, and HTML rendering benefits of ST's Popup.
    - **Scope — sweep these surfaces**:
      - All callers of `CoreAPI.showConfirmation()` and `CoreAPI.showInput()` — verify the message bodies render correctly and any user-controlled substrings (chat names, file names, folder names) are escaped via `_escapeHtml()` / equivalent before interpolation.
      - Any remaining direct `window.confirm()` / `window.prompt()` / `window.alert()` calls in `modules/`, `app/`, `utils/` — replace with the CoreAPI helpers (or add an `showAlert()` wrapper if a non-confirm message-only popup is needed).
      - `modules/lost-and-found.js` resolver dialogs (relink confirm, remove confirm, batch confirm) — currently route through `showConfirmation`; verify they look correct under the fixed Popup path and upgrade to richer HTML where appropriate (e.g., side-by-side preview of stored vs candidate snippet).
      - `modules/folders-view.js` folder-name input, rename input, delete-folder confirm — verify input dialogs work end-to-end.
      - `modules/recent-chats.js` rename / single-delete / bulk-delete dialogs — already migrated to HTML lists; verify rendering.
      - `index.js` settings panel — Reset, Import, Migrate Now, snapshot DB Clear/Import buttons — verify confirm/input flows.
      - `modules/lost-and-found.js` "Discard All" / "Auto-reconnect Obvious" batch confirms.
    - **Helper additions to consider (do not over-engineer — only add if 2+ call sites need it)**:
      - `CoreAPI.showAlert(message, title)` — single-button "OK" popup using `Popup.show.text()` for cases that currently misuse `showConfirmation()` just to display info.
      - `CoreAPI.escapeHtml(str)` exposed on the public API instead of duplicated as `_escapeHtml` inside individual view classes.
    - **HTML hygiene rule (locked)**: any caller passing rich content (HTML, lists, formatted character/file names) through `showConfirmation` / `showInput` MUST escape user-controlled substrings before interpolation. Document the rule in the JSDoc on both helpers (already added in this round). Add a lint-style code review checklist item.
    - **Visual consistency pass**:
      - Standardise on a single set of button labels: "Confirm" / "Cancel" for confirms, "Save" / "Cancel" for inputs (override only when a destructive action needs "Delete" / "Remove").
      - Add an optional `okButtonClass` for destructive operations (red button styling) — the underlying `Popup` constructor accepts it; surface it through the helper signature when needed.
    - **Verification**:
      1. Bulk-delete from Recent → confirm dialog renders the chat list with proper formatting (headings, scrollable `<ul>`, escaped names), not raw tags.
      2. Single-delete from Recent → confirm dialog shows the chat name as styled text.
      3. Lost & Found relink/remove confirms → ST-themed popup, not browser native.
      4. Folder rename / new-folder name input → ST-themed input popup, default value populated.
      5. Settings → Reset / Import / Clear snapshot DB → all use ST Popup; HTML in their messages renders correctly.
      6. Grep the codebase for `window.confirm`, `window.prompt`, `window.alert`, `confirm(`, `prompt(`, `alert(` — only the documented fallbacks inside CoreAPI should remain.
    - **Out of scope**:
      - Building a custom dialog framework — ST Popup is sufficient.
      - Modal-stacking / z-index tweaks — Popup handles this natively.
      - Migrating non-modal toasts (`toastr.*` calls) — those are fine as-is.

47. **If we reach this step, we've implemented everything to a "good enough" degree that we can now audit the whole application for optimizations**

**Verification**

- Test in SillyTavern staging with multiple characters (20+) and many chats (200+)
- Verify migration from v1: enable v1, create pins/folders, enable v2, confirm migration
- Test CHARACTER_RENAMED event: rename character, verify all pins/folders update without manual refresh
- Test CHARACTER_DELETED event: delete character, confirm orphaned chats removed from pins/folders
- Test nested folders (3+ levels deep) with expand/collapse
- Test multi-folder assignment: add chat to 3 folders, remove from 1, verify consistency
- Test pagination on Recent tab with 300+ chats
- Test search/filter across all content types
- Check mobile responsiveness with DevTools
- Verify no console errors in browser
- Performance test: measure time to render 1000+ chats in Recent tab
- **Test Lost & Found system**:
  - Pin a chat, rename it in ST, verify orphan is detected
  - Add chat to folder, delete and recreate with different name, test reconciliation
  - Test fuzzy matching suggests correct replacement when filename partially matches
  - Verify batch reconnect works for multiple orphans with same avatar
- **Tab navigation polish (step 20)**:
  - Verify Font Awesome icons render correctly for all three tabs
  - Resize the sidebar to a narrow width and confirm labels collapse to icons-only; tooltips show on hover
  - Expand sidebar and confirm labels return without page reload
- **Recent entry streamlining (step 21)**:
  - Confirm no relative timestamp or message count appears on any chat item
  - Confirm footer row is omitted when there is no preview text either
- **Folder overhaul (step 22)**:
  - Create a root folder, then add a subfolder via the "+ Subfolder" button in the folder header; confirm it appears collapsed under the parent
  - Open the folder content manager: switch to Add Chats view, search for a chat by character name, select several and click "Add selected"; confirm they appear in Contents view
  - Remove a chat from the Contents view; confirm it disappears and folder assignment is saved
  - In Recent tab, click "Add to folder" on a chat item; confirm the folder picker popover lists all folders; select one and confirm a toast + assignment
  - Confirm "Add to folder" button is hidden/disabled when no folders exist
  - Confirm group chats appear in Add Chats view and can be assigned
- **Edit mode and multi-select (step 23)**:
  - In Recent tab: toggle Edit mode, verify checkboxes appear; select 3 chats by different characters; use "Add to folder" bulk action
  - "Select all for this character": select a character's chats using this option; verify only that character's chats are checked
  - Toggle Edit mode off; confirm checkboxes are gone and tapping opens chats again
  - In a folder's content manager: enter edit mode, select chats, use "Remove from folder" bulk action
- **Chat deletion (step 24)**:
  - Delete a single chat from Recent tab: check it is gone from the list, from pins, and from any folder assignments
  - Bulk delete 3 chats from edit mode: verify all three are removed and cache is invalidated
  - Verify the confirmation dialog shows the correct count before bulk delete
- **Group chat support (step 25)**:
  - Pin a group chat and confirm it appears in the Pinned section with a group avatar
  - Assign a group chat to a folder from the Recent tab and from the folder's Add Chats view
  - Toggle Edit mode in Recent tab and multi-select a mix of character and group chats; perform Add to Folder and Delete operations on the selection
  - Delete a group chat and confirm cleanup of pins and folder assignments
- **Stale chat-filename handling (step 26)**:
  - Rename a chat file externally (directly in the ST data folder), reload the extension; confirm the Recent tab shows a warning on the stale entry rather than silently allowing it to create a new chat
  - Click "Find & Re-link" on the stale entry; confirm the resolver proposes the renamed file (same avatar) and that accepting it updates the displayed entry
  - Pin a chat, rename its file externally, reload; confirm a notification appears in the pinned section and that the re-link flow corrects the stored key and saves settings
  - Verify that after re-linking, opening the chat from Recent and from the pinned section both open the correct (renamed) file

**Decisions**

- **Avatar-based identity over characterId**: Chose stable identifier that survives renames/reloads, avoiding v1's fragile index-based system
- **Separate HTML files**: Cleaner separation of structure/logic, easier maintenance, follows CharacterLibrary pattern
- **CoreAPI abstraction**: Enables future refactoring without breaking modules, testability, loose coupling between features
- **Class-based modules**: Better state encapsulation, aligns with Leits-Lab pattern, easier to test
- **Event-driven architecture**: Eliminates setTimeout race conditions, more predictable behavior, proper ST integration
