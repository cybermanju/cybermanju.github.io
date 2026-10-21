# Android native clipboard bridge

The native bridge is registered as `android_clipboard_command` in Tauri and is not exposed as a REST route or agent tool. It uses the Activity classloader, JNI, and `CybermanjuClipboard.dispatch(Activity,String,String):String`. The generated-project installer copies the Kotlin class and preserves its entrypoint under R8.

## UI contract (Housaky)

Call only from a trusted, explicit copy/cut/paste click, keyboard shortcut, or native-menu action. Check the trusted event **before any await**. Do not call from startup, watchers, focus handlers, background tasks, timers, clipboard availability probes, or polling. The bridge does not change the existing UI or bypass Android's native context menu.

```ts
// Example invocation shape, not a background helper:
const result = await invoke('android_clipboard_command', {
  action: 'copy', // 'cut' or 'paste'
  payload: {
    userInitiated: true,
    expiresAt: Date.now() + 4000,
    text: selectedText, // REQUIRED for copy/cut; OMIT entirely for paste
  },
})
```

`userInitiated` is the trusted UI's attestation, not cryptographic proof of a browser gesture. The native bridge additionally requires the bundled main WebView origin (configured dev origin allowed only in debug builds), an unlocked foreground Activity with window focus, and a fresh timestamp. `expiresAt` must be an integer Unix timestamp in milliseconds, strictly later than now and no later than now + 5000 at validation; it is checked again on the Android UI thread.

Copy/cut accept **1–65,536 UTF-8 bytes**, preserve whitespace and Unicode, and return `{ ok: true, action: 'copy' | 'cut', written: true }`. Clips are plain text, have an empty label, and are marked sensitive to suppress supported Android clipboard previews. No source field content is read by the native layer.

Paste accepts no `text` property and returns `{ ok: true, action: 'paste', text: string }`. It reads the first clipboard item's plain text only after the explicit action, rejects URI/Intent items, never coerces or resolves content URIs, and rejects text over 65,536 UTF-8 bytes. Empty text may be returned, whereas an absent/denied clipboard rejects.

## Cut and editor safety

Native `cut` only writes the selected text. It does **not** delete DOM or native field contents and is not an atomic transaction with the editor. Capture selection and source value at the user action, keep them while awaiting, and delete only after `written === true` **and** revalidating the same connected, editable target, value and selection. If the user changes the selection/value, preserve the new content. On error/timeout/ambiguous outcome, never delete and never retry automatically.

For paste, capture the intended editable target/selection, then revalidate before insertion and dispatch the editor's normal input event. Do not insert into a different field that gained focus during the await. Do not implicitly copy/cut password fields. Explicit secret-copy actions may use the bridge, but never log payloads, clipboard results or field contents.

## Errors and privacy

Tauri rejects with a fixed-content prefixed string: `auth:` (missing explicit action, wrong origin, locked/unfocused), `conflict:` (expired request or UI-thread timeout with uncertain outcome), `invalid:` (shape/size), `not_found:` (empty/unavailable clipboard), `unsupported:` (unknown action, non-text clip, non-Android build), `unavailable:` (platform failure), or `integrity:` (malformed native acknowledgment). Platform exception messages/content are not returned. Keep the selection on every rejection.

There is no clipboard listener, cache, persistence, analytics, content logging, auto-clear timer, accessibility dependency or additional Android permission. Existing web clipboard helpers and secret auto-clear behavior are unchanged and are not wired into this endpoint.

## Verification

Rust unit tests cover action/schema/gesture attestation/expiry/UTF-8 bounds and honest off-Android refusal. Python tests cover installer idempotence, R8 retention and positive/negative DEX fixtures; CI checks actual release APK JNI symbols. Kotlin can be compiled against an Android SDK without a device. These checks do not prove real clipboard access, context-menu integration, focus/lock behavior, OEM compatibility, or UI selection mutation on a physical Android device. A device smoke-test skip is not a pass.
