# ChatPlus 2 - Recent, Pinned and Foldered Chats for SillyTavern

> **Status:** Public **Beta**. The extension is feature-complete for everyday use, but a few polish items (onboarding tour, deeper snapshot-store hardening, dialog audit, performance pass) are still on the roadmap. Please report anything you break - see [Feedback](#feedback--bug-reports) below.

ChatPlus 2 is a full architectural rewrite of [ChatPlus 1](https://github.com/SoFizzticated/SillyTavern-ChatPlus) with a chat-centric UI bolted onto SillyTavern's right-hand panel. Recent chats, pinned chats and folders all live in the same place - and survive renames, duplicates and external edits via avatar-based identity, a Lost & Found resolver, and a persistent last-message snapshot store.

<!--
TODO: Drop screenshots into ./.readme/ and uncomment.

| Tabs Above the Character List                | Recent Chats with Day Separators              |
| -------------------------------------------- | --------------------------------------------- |
| ![Tabs](./.readme/Tabs.png)                  | ![Recent](./.readme/Recent.png)               |

| Folders & Subfolders                          | Lost & Found Resolver                          |
| --------------------------------------------- | ---------------------------------------------- |
| ![Folders](./.readme/Folders.png)             | ![LostFound](./.readme/LostFound.png)          |
-->

## Why a rewrite?

ChatPlus 1 worked, but it was glued together with `setTimeout`s, identified chats by their volatile `characterId` index, and rebuilt large slabs of HTML by hand. That made it fragile around character renames, duplicates and external edits.

ChatPlus 2 fixes that at the foundation:

- **Avatar-based chat keys** (`avatar:filename`) - stable across renames and duplicates.
- **Modular architecture** - every concern (state, repository, pins, folders, recent view, search, rendering, snapshots, lost & found) lives in its own class, wired through a `CoreAPI` abstraction layer.
- **Event-driven** - proper subscriptions to `CHARACTER_RENAMED`, `CHARACTER_DELETED`, `CHAT_DELETED`, group events; deterministic key remapping where ST gives us the data, Lost & Found resolver where it doesn't.
- **Templates over `createElement`** - HTML lives in `app/*.html`, JavaScript clones and binds.
- **Non-destructive by default** - deletions and renames surface a banner instead of silently wiping your pins and folders.

## Features

### Tabbed character panel

Tabs (`Characters` / `Recent` / `Folders`) inject above SillyTavern's `#rm_PinAndTabs`. The Characters tab leaves the native character list completely untouched (no DOM reparenting), so group-member actions, character creation and the rest of ST's UI keep working identically to having the extension disabled.

### Recent chats

- Chronological view across **all** characters and groups, sorted by last-message timestamp.
- **Infinite scroll** with configurable page size (25 / 50 / 100 / 200).
- **Day separators** that stick to the top of the list while you scroll.
- **Two layout modes**: flat (`CharName: filename`) or grouped-by-character (compact rows under a single character header - toggle live in settings).
- **Search** across character name, file name and the snapshotted last message.
- **Manual reload** button for force-rebuilding the chat index.
- **Edit mode** with multi-select for bulk pin / unpin / move-to-folder / delete.
- **Sticky toolbar** - search, reload and edit toggle stay visible while the list scrolls.

### Pinned chats

- Pin / unpin from any view.
- Pinned section sorts alphabetically by character then filename.
- Pins survive character renames (auto-remap) and surface a Lost & Found notice when they can't be resolved.

### Folders

- Nested folders with multi-folder assignment (one chat can live in many folders).
- **Content manager** per folder (gear icon): browse contents, search-and-add chats with checkbox multi-select, create subfolders inline.
- Always-expanded for non-empty folders; rich empty-folder state with one-click "Add Chats".
- Per-folder edit mode and bulk remove.
- Folder-picker popover (`fa-folder` button on every chat row) for one-click assignment from the Recent tab.

### Lost & Found

SillyTavern lets users rename chat files outside the extension, which would otherwise silently break pins and folder assignments. ChatPlus 2 detects orphans and offers a resolver:

- **Side-by-side layout** - orphan identity + origin breakdown (📌 Pinned, folder breadcrumbs) on the left; candidate dropdown + scrollable last-messages preview on the right.
- **Snapshot-assisted matching** - when the orphan's last message is found verbatim in a candidate's recent history (within ±24 h of the snapshot), the candidate is flagged with an `exact` confidence tier.
- **Auto-Reconnect Obvious** for unambiguous matches; **Apply All** for staged batch resolutions.
- **Pagination** through orphans, keyboard navigation (←/→), drill-down on mobile.
- **Restored Delete action** for genuinely unresolvable entries.
- **Proactive scanning** on app init and after destructive ST events (character/chat/group-chat deletes); banner toast with reason-aware copy.

### Snapshot Database

- Per-chat `lastMessage` + `updatedAt` persisted to `user/files/chatplus2-snapshots.json` via `/api/files/upload`.
- Powers Lost & Found's exact-match heuristic and the orphan-card "what was this chat?" preview.
- **Snapshot Database viewer** (Settings → Maintenance) with sortable columns, filter, and import/export.

### v1 migration

- Detects `extensionSettings.chatsPlus` from ChatPlus 1.
- **Non-destructive** - v1 data is backed up to `chatsPlusV1Backup`, never modified.
- Maps v1 `characterId` keys to v2 avatar keys; unmapped references plant as synthetic Lost & Found entries so you can manually re-link them.
- Idempotent - safe to run multiple times.

### Settings

- Enable / disable (with inline "Reload now" prompt when toggled).
- Default tab (Characters / Recent / Folders).
- Page size for Recent.
- Recent layout (flat vs grouped-by-character).
- Import / export full settings as JSON.
- Snapshot DB viewer + import/export.
- Lost & Found manual scan.
- "Check for Updates" deep-link to ST's Installed Extensions modal.
- "Report an Issue" button - opens this repository's GitHub issues page.

### Plumbing & polish

- **Stable group identity** - `String(group.id)` instead of mutable `avatar_url`; one-shot migration of legacy keys.
- **Loading overlay** with delayed-show (≥150 ms) and re-entrancy guard, so chat-open and bulk-delete operations don't double-fire.
- **Auto-update** via SillyTavern's `auto_update` manifest flag and `onUpdate` lifecycle hook - version-aware migration scaffold ready for future schema bumps.
- **Mobile-first** - every panel collapses cleanly under 768 px (bottom-sheet modals, tab-bar compact mode, drill-down navigation in Lost & Found).

## Installation

1. Use this URL with SillyTavern's extension installer:

   ```
   https://github.com/SoFizzticated/SillyTavern-ChatPlus2
   ```

2. Or clone manually into `SillyTavern/public/scripts/extensions/third-party/SillyTavern-ChatPlus2/` and reload SillyTavern.
3. Enable **ChatPlus 2** in the Extensions menu. The tabs appear in the right-hand character panel.

**Minimum SillyTavern version:** 1.17.0 (validated against `release` 004f1336e).

## Compatibility with ChatPlus 1 during the Beta

ChatPlus 1 and ChatPlus 2 can coexist - they use separate settings keys (`chatsPlus` vs `chatPlus2`) and target different DOM injection points. **Disable v1 before enabling v2** in regular use to avoid a duplicated tab bar. The first time v2 sees v1 data, it offers a one-click migration from the Settings panel; v1 data is backed up, not deleted, so you can re-enable v1 if you want to.

## Known limitations / Beta caveats

- **Onboarding tour not shipped yet** - first-run users get the bare UI; check this README and the Settings panel.
- **Snapshot store reliability** is being audited for harder-edged failure modes (concurrent writes, mid-flight saves on reload). Today it's debounced + flushes on teardown, which covers the common cases.
- **Some confirms still fall back to native browser dialogs** in rarely-trodden code paths. The hot paths (delete, rename, batch actions, migration) all use SillyTavern's themed Popup. A full sweep is on the roadmap.
- **Performance** has been validated against ~200 chats across ~20 characters. Larger datasets work but haven't been profiled for the 1000+ tier.

If you hit a regression you can usually unstick the UI by clicking the **Reload** icon on the Recent tab; everything is rebuildable from the persisted state.

## Feedback & Bug Reports

Open an issue on GitHub:

- https://github.com/SoFizzticated/SillyTavern-ChatPlus2/issues

Helpful information to include:

- SillyTavern version + branch.
- Extension version (visible in the manifest / Installed Extensions).
- Steps to reproduce.
- Browser console output (`F12` → Console). Filter for `[ChatPlus2]` to scope.
- A screenshot of the affected panel if it's visual.

You can also reach me as `starfish_galaxy` on the SillyTavern Discord, or on the extension thread there.

## Thank you

ChatPlus 2's architecture borrows heavily from prior work in this ecosystem:

- **[SillyTavern-CharacterLibrary](https://github.com/Sillyanonymous/SillyTavern-CharacterLibrary)** (by [SillyAnonymous](https://github.com/Sillyanonymous)): for the `CoreAPI` abstraction layer, separated HTML templates, and module-loader patterns.
- **[EvaL3n4](https://github.com/EvaL3n4)**: for the class-based module structure.
- **[RivelleDays](https://github.com/RivelleDays)**: for the styling DNA inherited via ChatPlus 1, and for co-authoring [Extension-TopInfoBar](https://github.com/SillyTavern/Extension-TopInfoBar).
- **[Cohee1207](https://github.com/Cohee1207)**: for [Extension-TopInfoBar](https://github.com/SillyTavern/Extension-TopInfoBar), which started this lineage.
- **[The SillyTavern team](https://github.com/SillyTavern/SillyTavern)**: an extension surface this deep is rare, and it's appreciated.

And to everyone who reported v1 bugs and shaped the v2 design - **thank you**.

**_Your order, your way_**

## License

[AGPLv3](./LICENSE)

---

### Created by SoFizzticated

_Ship your conversations, not your character index._
