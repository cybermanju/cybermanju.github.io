# File and Provider Experience: Research and Improvement Plan

**Status:** Research brief for future work  
**Date:** 2026-10-26  
**Scope:** File browsing, local and cloud storage, cross-provider transfers, encryption/decryption, and the surrounding user experience.

## Executive summary

CyberManju OS already contains much of the underlying capability for a useful multi-provider file manager: a local vault view, disk scopes, provider mounts, a Google Drive aggregate, provider file and directory listing, and transfer actions. The main usability problem is that those capabilities are exposed as several overlapping storage concepts and entry points. A person must infer whether an item is in the vault, a disk, a provider mount, a remote sync destination, or a host-local location, then learn which operations work in each place.

The future product should present one clear **Files** workspace with explicit locations and consistent actions. People should be able to browse each location, compare source and destination, and choose a transfer action with an understandable consequence. Encryption should be an explicit step in the transfer workflow, with a visible destination state and a recoverability explanation. Underlying storage boundaries should remain visible where they affect behavior, permissions, ownership, or security.

The key product decision is to define what “local” means in the UI. The current code distinguishes the `.cybermanju` vault, attached/scoped storage providers, disks backing the vault, cloud providers, and host file access. These are not interchangeable. Avoid calling all of them “local files” until the UI can explain the difference.

## What the repository already provides

These observations come from the current tree; they are a code reading, not a hands-on usability test.

### Existing strengths

- `FileManager.vue` has familiar back/forward/up/home/refresh navigation, editable path breadcrumbs, filtering, global search, multiple views, file selection, and a sidebar.
- The sidebar lists the vault, disks, configured providers, and a Google Drive aggregate. Provider mounts are opened lazily from the file manager.
- Provider files and folders have a virtual `/providers/<mount>/…` path and can be browsed alongside the vault file manager.
- The code has a provider-to-provider move/copy flow and a provider-to-vault “save” path. The transfer helper uses one path for files and recursively copied folder trees.
- Sync configuration includes encryption-related settings such as `encrypt_before_upload` and `require_encryption`; the sync model records whether an artifact is encrypted.
- Provider capabilities and listing contracts exist in the shared types. For example, providers can list files and immediate directories, report capabilities, and optionally support chunked uploads.
- Multiple transport implementations exist (desktop Tauri, REST, and browser/WASM), so consistent behavior across transport modes is an important design constraint.

### Friction and likely causes

1. **Several concepts compete for “home.”** The UI has Vault, Vault root, disks, provider mounts, a Google Drive tab, and sync settings. The code comments describe Vault as `.cybermanju` and Google Drive as an aggregate that is “not vault yet.” That difference is real, but it asks users to understand architecture before they can find a file.
2. **Provider integration is uneven.** Google Drive receives an aggregate scope tab; other backends remain individual sidebar rows. A single file browsing model should not make one provider feel native and others feel secondary.
3. **The provider tree is virtual.** `/providers/<mountId>` routes and mount records are useful implementation details, but opaque mount IDs and route state should not leak into labels, errors, or user decisions. People need account/repository names, locations, and connection state.
4. **The meaning of “move” changes by boundary.** A move between providers is effectively a copy/verify/delete sequence; saving a remote file to the vault is a separate action; syncing a vault file may compress and encrypt it. These actions should not share an ambiguous “Move” label.
5. **A provider is not necessarily a normal filesystem.** It can hide directories, return only recursively listed files, have different naming and ownership rules, or lack rename/move/chunk support. UI affordances must reflect backend capabilities and explain when a requested operation is implemented as copy-and-delete.
6. **The app has several action surfaces.** Toolbar, context menu, provider banner, sync panel, and mobile tools can all expose related actions. The same verb and status language should be used everywhere.
7. **The visible code hints at file-listing complexity.** REST maps `list_files` by fetching `/api/files` and filtering by `parentPath`, while provider views depend on virtual file rows and mount metadata. Differences in pagination, eventual consistency, stale mounts, permissions, and errors can look like “missing files” in the UI.

These points identify likely usability risks; they do not prove which one causes a particular user’s current failure. The next step should combine this audit with reproducible scenarios and user observation.

## Product direction

### One Files workspace, with named locations

Present a predictable top-level structure:

- **Home** — recent items, pinned locations, and a small “where is my data?” explainer.
- **Vault** — encrypted CyberManju-managed storage, including its backing disks where relevant.
- **This device** — host-local files, only on platforms where the app has a supported and permissioned file-system integration. If the current transport cannot browse arbitrary host paths, show “Connect a folder” or a file-picker flow instead of an empty fake root.
- **Cloud and network locations** — one row per connected account/repository, grouped by provider, with a human name and status.
- **Shared / Recent / Transfers** — task-oriented views that do not depend on remembering which provider contains an item.

Keep provider identity visible in each location and in file details. A user should always be able to answer: “Which account is this? Where is this file stored? Is this a local vault copy, a remote original, or a transfer artifact?”

Use a stable `Location` concept in the UI and API layer, distinct from a path string. A location should carry a stable ID, display name, kind (vault, host folder, cloud account/repo, removable disk), provider ID, root path, capabilities, connection/permission state, and last successful refresh. A file identity should be scoped to its location so equal paths across providers cannot collide.

### Consistent browsing

- Use the same listing layout for Vault, host-local, and cloud locations: breadcrumb, list/grid controls, sorting, search/filter, selection, loading, empty, disconnected, permission-denied, and retry states.
- Show folders first and retain the current path, sort, view, and selection state appropriately when switching locations.
- Use provider-specific icons and names as secondary information, not as the only indication of location.
- Make the current location explicit in the breadcrumb and in a compact location selector. Avoid having a Google Drive-only tab teach users that providers behave differently.
- Clearly separate “search this folder,” “search this location,” and “search everywhere.” Show scope in the search box and result rows.
- Support paging/virtualized rendering for large remote listings and preserve sort semantics across pages. A list of thousands of files should not silently truncate or become slow.
- Show modified time, file size, type, sync/encryption state, and availability consistently. If a provider does not supply a field, show “Not provided,” not a misleading empty value.
- Add pinned/favorite locations and recent locations so users do not need to repeatedly expand a long provider list.

### Better provider navigation

- Group connections by provider type, but identify each by the account or repository name (for example, “Google Drive · personal” or “GitHub · photos repo”). Do not label multiple configured accounts merely “Google Drive.”
- Show connection and permission state inline: Connected, Needs sign-in, Permission needed, Offline, Refreshing, or Error. Provide a direct repair action.
- Keep the sidebar collapsible and make provider groups expandable. Persist user pin/order choices.
- When adding a connection, offer “Connect account,” “Choose repository/folder,” and a visible confirmation of the root that will be browsable. Avoid asking users to configure sync parameters before they understand the location.
- When switching providers, preserve the current source selection if useful and offer a clear “Open destination” or second-pane action.
- Treat the root of each provider as a first-class place. Empty roots should include a useful explanation and connection/permission diagnostic rather than just “Empty folder.”

### Transfers should explain what happens

Create a central **Transfer** action with explicit choices rather than overloading “Move”:

- **Copy** — keep the source and create a destination copy.
- **Move** — copy, verify, then remove the source only after successful verification and confirmation of destination availability.
- **Save to Vault** — create a vault-managed copy; optionally remove the source only after an explicit choice.
- **Upload to provider** — send local/vault content to the selected provider.
- **Download to device** — save a remote item to a chosen host folder, when platform permissions allow.

For a transfer dialog:

1. Show source name, location/account, item count, total known size, and whether folders include descendants.
2. Let the user choose a destination account/location and browse its folders inside the dialog. Make the chosen destination path visible before starting.
3. State whether the operation is server-side or travels through this device/app. Estimate whether the transfer may take time or consume local temporary storage.
4. Explain overwrite/conflict options with examples: keep both, replace, skip, or ask for each conflict. Never silently overwrite.
5. Show encryption choice and resulting destination state (see below).
6. Provide progress by file and total, pause/cancel where possible, retry failed items, and preserve a durable transfer history.
7. At completion, report counts for completed, skipped, and failed items and provide links to the destination and detailed errors.

Cross-provider “move” must be honest about the underlying sequence. If the app copies bytes to the destination and deletes the source after verification, label the operation as “Move (copy, verify, then delete source)” with a confirmation. If source deletion is unsupported or denied, keep the source and clearly report “Copied; source was not deleted.” Do not claim an atomic move across independent providers.

Provide two-pane mode on desktop as an optional power-user path: source on one side, destination on the other, with keyboard copy/move shortcuts and drag-and-drop. Keep the transfer dialog as the consistent accessible path and the primary mobile experience.

### Make encryption understandable and hard to misconfigure

Place encryption in the transfer flow rather than hiding it only in provider settings:

- Use clear choices such as **Encrypt before upload** and **Upload without app encryption**. Default according to the user’s security preference and existing account policy; do not silently downgrade when encryption cannot be performed.
- For a required-encryption location, fail closed if no usable key/passphrase is available. Explain the exact next action (unlock vault, create/recover a key, or choose another destination).
- Show a persistent badge in listings and transfer history: Encrypted by CyberManju, Provider-native encryption, or Not encrypted. Never imply that TLS or a provider’s at-rest encryption equals client-side encryption.
- Explain what metadata remains visible to the provider: file name, folder structure, size, and timestamps. If name obfuscation is enabled, explain the trade-off for browsing and recovery.
- Before decrypting, show where plaintext will be written, who can access that destination, and whether an existing file will be replaced. Decrypt to a temporary or user-chosen destination; do not silently expose plaintext in the vault or provider.
- Show a recovery check: confirm that the user has a key/recovery method before the only accessible copy is moved or deleted.
- Distinguish encrypted container files from ordinary files in rows, previews, search, and transfer actions. A file that cannot be decrypted should show a useful “locked / key required” state, not a generic parse or download failure.

Treat encryption as a data-handling state machine, not merely a checkbox: selected source → key available → encrypted artifact created → uploaded → remote bytes verified → metadata recorded → optional source removal. Surface every failure boundary and only report success when the intended state is true.

## Information architecture proposal

```text
Files
├── Home
├── Recent
├── Starred
├── Vault
│   ├── Vault root
│   └── Backing disks (advanced / expandable)
├── This device (only when supported and permissioned)
└── Locations
    ├── Google Drive
    │   ├── account label
    │   └── account label
    ├── GitHub
    │   └── repository label
    └── Other providers
Transfers
├── Active
└── History
```

“Sync” remains a separate capability for ongoing replication and policies. Users should not need to understand sync setup just to browse a provider or transfer a file once. Link advanced sync configuration from the location and transfer areas.

## Proposed delivery roadmap

### Phase 0 — Reproduce and measure the broken experience

Before redesign implementation, capture exact failures on desktop, web/REST, and Pages/WASM where applicable. Use the same fixture files and provider accounts. For each case record selected location, visible path, request/IPC call, backend response, error, and displayed result.

Test these scenarios:

1. Open the local vault root and one nested folder; verify folders and files, refresh, and navigate back/up.
2. Browse an attached/scoped local folder if supported; compare with vault files and clearly identify which is which.
3. Connect two accounts of the same provider and a Git-based provider; browse roots, nested directories, and an empty folder.
4. Test a large listing, unusual names, duplicate names, non-ASCII paths, inaccessible items, and a disconnected account.
5. Copy one file and one nested folder between two providers; then test move semantics, conflicts, partial failure, cancellation, and retry.
6. Upload plaintext with encryption enabled, required encryption without an unlocked key, and explicit plaintext upload. Download and decrypt to a chosen destination.
7. Repeat core listing and transfer cases on narrow/mobile layouts and keyboard-only navigation.

Use this to distinguish UI discoverability problems from data correctness/API problems. Fix missing or incorrect listing semantics before investing in visual polish.

### Phase 1 — Establish the location and file identity contracts

- Define location metadata and capabilities once; use it in Tauri, REST, and WASM transports.
- Normalize file rows to include stable location ID, provider ID, canonical path, item ID/locator, file kind, size/date availability, and capability flags.
- Make provider pagination/cursors, sorting, search scope, directory listing, and error states explicit.
- Ensure list errors are not converted into empty folders. Distinguish empty, loading, unsupported, disconnected, permission denied, and failed states.
- Define transfer semantics for files/folders, copy/move, verification, conflict handling, and source deletion. Reuse the same operation state model across transports.
- Avoid exposing OAuth credentials or secret material in client models, errors, logs, and history.

### Phase 2 — Build one coherent browser

- Unify Vault, provider, and supported host-local navigation under the same location selector and list component.
- Replace the special Google Drive scope behavior with a provider group and account-level browsing while retaining a useful aggregate/search view if needed.
- Add location-aware breadcrumbs, state indicators, retry actions, empty-state guidance, pinned locations, and explicit search scope.
- Normalize row actions by capability, with disabled explanations when unavailable.
- Establish mobile layouts that prioritize location selection, current path, selection count, and move/copy actions.

### Phase 3 — Make transfer and encryption first-class

- Ship a destination picker and transfer queue with copy/move/save/upload/download distinctions.
- Add safe conflict resolution, per-file progress, resumability where backends permit, verification, cancellation, and retry.
- Put encryption/decryption and key readiness into the transfer flow; show final encrypted/plaintext state.
- Add activity/history with source, destination, operation, outcome, and recoverable error details.
- Add two-pane desktop mode and optional drag-and-drop only after the explicit transfer path is robust.

### Phase 4 — Validate usability and harden edge cases

- Run short task-based sessions with new users and existing users. Ask them to locate a file, identify where it lives, move a folder, upload encrypted content, and recover from a disconnected provider.
- Measure task completion, wrong-destination rate, confusion about encryption state, recovery success, and time-to-completion.
- Review keyboard navigation, screen-reader announcements, focus behavior, touch target sizes, contrast, and responsive layout.
- Exercise transport parity and provider-specific capability combinations in CI.

## Acceptance criteria for the future work

### Browsing

- A new user can tell the difference between the vault, a disk, a host folder, and each cloud account without reading technical documentation.
- Every connected location is reachable from the same Files navigation model, including multiple accounts of one provider.
- A folder that is empty is distinguishable from a location that failed to load or needs permission.
- Refreshing or navigating does not silently lose the current provider/account context.
- Large directories load progressively without silent truncation; search indicates and honors its scope.
- File rows show their location and encryption state in detail/inspector views.

### Transfers

- Copy never deletes the source. Move never deletes it until destination write and integrity verification succeed.
- The user sees the source, destination, operation, conflict behavior, and encryption state before execution.
- Partial success is reported per item and can be retried without repeating successful items.
- Folder transfers preserve relative paths; destination collisions never silently overwrite.
- Transfer outcomes are understandable after navigation or app restart when the operation contract promises durable job tracking.

### Encryption

- Required encryption cannot silently fall back to plaintext.
- A transfer reports whether the resulting remote bytes are encrypted by CyberManju.
- Decryption always names the plaintext destination before writing.
- Users can identify key-required/locked content and find the next step to unlock or recover it.

### Accessibility and consistency

- Core navigation and transfer work with keyboard and touch; focus is visible and dialogs manage focus correctly.
- Progress and completion are programmatically announced without stealing focus.
- Desktop, REST/web, and WASM transports use equivalent labels, state meanings, and error explanations.
- Provider-specific limitations are disclosed at the action point, not discovered after data transfer begins.

## Technical and product risks to resolve

- **“Local” ambiguity:** The current `.cybermanju` vault and host filesystem are different. Scope the first version honestly to the capabilities of each runtime.
- **Provider semantics:** Google Drive, Git repositories, scoped storage, and future providers have different folder, ownership, shortcut, rename, and delete behavior. Model capabilities and item kinds explicitly.
- **Cross-provider move safety:** Independent providers cannot generally provide atomic transactions. Copy/verify/delete and compensation logic must be visible and robust.
- **Encryption and temporary plaintext:** Transfers may stage content locally. Document where temporary bytes exist, secure cleanup behavior, and how interrupted jobs recover.
- **Provider-native documents:** Some providers have document types without ordinary downloadable file bytes. Decide whether to export, link/open in provider, or label unsupported.
- **Metadata leakage:** Encryption of file contents may still reveal names, sizes, folder paths, and timestamps. The user-facing protection claim must match implementation.
- **Permissions and ownership:** A user may see a shared item but lack delete or move rights, or cross-tenant ownership transfer may be impossible. Preserve source and explain the limitation.
- **Transport parity:** Browser/WASM cannot assume native filesystem access. Present an honest picker/permission model rather than promising identical capabilities.
- **Duplicate identity and stale listings:** A path is not a globally unique ID. Use provider identity and remote locator, handle renames, and invalidate stale cache after operations.

## Research references

- Apple Human Interface Guidelines, [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars): use sidebars for top-level collections, group deep hierarchy with disclosure controls, allow hiding/customization, and adapt when space is limited.
- Google Drive Help, [Organize your files in Google Drive](https://support.google.com/drive/answer/2375091?hl=en): move actions depend on permissions. This supports checking and explaining capability before a transfer, rather than treating every visible item as freely movable.
- W3C, [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/wcag/): use as the baseline for focus, target size, status announcements, and accessible operation flows.
- Microsoft, [Files app overview via Windows Central](https://www.windowscentral.com/software-apps/windows-11/how-to-get-started-with-the-files-app-on-windows-11-to-replace-file-explorer): a useful market example of familiar navigation controls, tabs, split panes, common toolbar actions, preview/details, and multiple storage locations in one file manager. This is secondary coverage, so use it as a product-pattern example, not a normative specification.

## Recommended first implementation slice

Start with the smallest change that improves both correctness and comprehension:

1. Define and display explicit location identity and state on every listing (Vault, disk, device folder, provider/account).
2. Replace ambiguous provider “Move” with a clear Copy/Move/Save to Vault transfer dialog that shows source and destination and safe copy-verify-delete semantics.
3. Make loading, empty, permission, disconnected, and error states visibly distinct; ensure list failures never appear as an empty directory.
4. Put encryption status and key readiness in that same transfer flow, and fail closed for locations configured to require encryption.

This slice addresses the central complaint—finding files and moving them safely—without requiring a full redesign before users can benefit.
