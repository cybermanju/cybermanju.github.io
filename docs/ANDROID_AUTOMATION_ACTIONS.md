# Android automation actions (v1)

The native automation bridge is deliberately narrow: it handles one allowlisted action at a time, receives `{ request: NativeActionRequest }`, and returns a flat correlated response. It does not traverse workflows, evaluate user code, execute a shell, or invoke arbitrary packages.

## Available actions

| `actionId` | Input | Android operation | Result |
|---|---|---|---|
| `android.open_url` | `{ "url": "https://example.com" }` | Opens `ACTION_VIEW` through Android's resolver. Only HTTP/HTTPS URLs are allowed; userinfo and other schemes are rejected. | `succeeded` means `startActivity` accepted the open request, not that the user read or completed anything at the destination. |
| `android.open_map` | `{ "query": "Tokyo station" }` **or** `{ "latitude": 35.68, "longitude": 139.76, "label": "Tokyo" }` | Opens a `geo:` URI through the system resolver. Coordinates must be finite and in range. | `succeeded` means only that the map intent opened. |
| `android.dial` | `{ "phone": "+55 (19) 99914-8596" }` | Opens the dialer with `ACTION_DIAL` and a prefilled number. | `accepted` (`external:<requestId>`); it never places a call. |
| `android.share_text` | `{ "text": "...", "title": "Share" }` | Opens Android's share chooser for `text/plain`. | `accepted`; the receiver app and final send are controlled by the user. |
| `android.create_calendar_event` | `{ "title": "...", "startsAtEpochMs": 0, "endsAtEpochMs": 1, "location": "...", "description": "..." }` | Opens a calendar event insert form. It does not read or write the calendar provider directly. | `accepted`; the calendar app must save the form. |

There is no direct call, message send, event write, or background task in this v1 adapter. All three handoff actions launch UI in another app, so the bridge does not claim success for the resulting user action. Android/provider absence is returned as `failed: no_handler`.

## Boundary and request safety

- The Tauri command is registered only for the bundled `main` WebView (or its configured development origin); REST, arbitrary remote content, and secondary WebViews cannot call it.
- Actions require the Android Activity to hold window focus. A background/uncertain invocation is denied rather than raising UI unexpectedly.
- `requestId` and `idempotencyKey` must match exactly; both are opaque identifiers of at most 512 UTF-16 code units without control characters. Workflow/node/action IDs use `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`.
- `input` is at most 64 KiB serialized, JSON depth 24 and 16,384 total values. The whole request is capped at 72 KiB; responses at 64 KiB.
- Responses echo all seven correlation fields exactly. `succeeded` always includes `output` (using `null` when empty); `unknown` adds no detail beyond the echoed idempotency key.
- The native journal atomically records only the SHA-256 of the idempotency key in the app-private directory before starting any external Activity. A duplicate or interrupted claim returns `unknown` and never launches a second intent. It stores no action payload, URL, phone, text, secret, or outcome.
- The runner currently has no durable run-retention/delete lifecycle. Tombstones are not expired or pruned automatically. At 64 MiB journal size, dispatch fails closed as unavailable; retention cleanup must be added only with an explicit run lifecycle contract.

## Platform scope

This initial implementation is for Android Tauri builds. Desktop/web returns `denied: unsupported`. It does not use Android 16 AppFunctions, WorkManager, exact alarms, notification access, contacts, calendar permissions, app enumeration, arbitrary HTTP, arbitrary shell, or generic third-party app APIs. Those need separate action contracts, runtime permission/consent handling, and policy-specific limits.
