# Native Android widgets: UI integration contract

This foundation hosts installed third-party Android widgets with `AppWidgetHost` and real `AppWidgetHostView` children. It does not render RemoteViews as Vue/HTML, implement the Vue gallery, control other apps’ windows, intercept system gestures, or replace Android Recents. Housaky owns the app picker, gallery, workspace/overview gestures and first-party visuals; this bridge is the native provider-host boundary only.

## Invoke contract

Call the Tauri command `android_widget_command` with `{ action, payload }` from the bundled `main` window only. There is no REST or agent-tool route. Desktop/web callers receive `unsupported:` rather than fake data. Payloads must be JSON objects under 64 KiB. Successful responses contain `{ ok: true, action, viewport: { widthDp, heightDp }, ... }`; failures reject with a prefixed string.

| Action | Payload | Result / behavior |
| --- | --- | --- |
| `providers` | `{}` | `providers`: installed current-profile providers with `provider`, `label`, `minWidthDp`, `minHeightDp`, `resizeMode`, `configurable`. Component strings are opaque IDs; gallery labels are plain text, never HTML. |
| `list` | `{}` | `widgets`: persisted entries including `appWidgetId`, `placementId`, provider, state, dimensions and any saved workspace/bounds; `providerAvailable` reports whether the platform currently has the binding. |
| `add` | confirmation fields plus `{provider, placementId}` | Allocates exactly one ID and journals it before launching the explicit Android bind-approval/configuration flow. Returns `appWidgetId`; inspect `list` for pending/ready state. `placementId` is unique and must remain stable across retries. |
| `configure` | confirmation plus `{appWidgetId}` | Explicitly reopens the provider’s configuration. One pending operation at a time. No configuration activity means the existing widget remains ready. |
| `layout` | `{appWidgetId, visible, xDp, yDp, widthDp, heightDp, workspaceId}` | For `visible:true`, attaches/positions a native view, validates viewport/provider limits, informs provider of size, persists logical workspace/position/size. For `visible:false`, hides that widget; bounds are not required. Only ready owned IDs can attach. |
| `hide` | `{}` | Hides every native widget and stops host updates. Use for gallery, menus, overview, scrolling/zoom animations, workspace changes and leaving Home. |
| `remove` | confirmation plus `{appWidgetId}` | Detaches the view, deletes the Android ID and removes persisted placement. |
| `cancel` | confirmation plus `{appWidgetId}` | Cancels a pending initial add and deletes its ID. Canceling reconfiguration restores the existing widget instead of deleting it. |

Confirmation fields are `{ userInitiated: true, expiresAt: Date.now() + 4000 }`, created immediately inside the trusted UI user handler. They are an attestation by trusted local UI, not an unforgeable browser gesture or a substitute for Android’s approval screen. All actions additionally require a focused, unlocked foreground Activity. Do not retry a timeout mutation automatically: its result can be uncertain. Recover by stable `placementId` using `list` before offering a new explicit action.

## State and lifecycle

States are `binding`, `configuring`, and `ready`. Only one binding/configuration can be pending. Bind denial, canceled initial configuration and launch failures delete allocated IDs. The returned ID and provider are checked against the journal; unrelated/stale callbacks cannot select another widget. Existing reconfiguration cancellation preserves its ID. The generated MainActivity forwards every result to Tauri/plugins before the host observes its own recorded request code.

IDs, provider component, request code, pending phase, placement ID and last logical bounds live in app-private preferences. They survive Activity recreation/process restart; native views do not. A restarted pending flow is observable in `list`; do not reopen bind/configuration automatically. If Android never returns a result, offer explicit Cancel. The host removes platform IDs without journal entries when it can enumerate host IDs (Android 8/API 26+). Android 7/API 24–25 can clean an empty host; an allocation interrupted before its first journal write while other saved widgets exist cannot be individually enumerated on those OS versions.

Pause immediately hides native views and stops listening. Destroy also releases native view references and the lifecycle observer; it never deletes committed IDs. Resume intentionally does not reveal stale views: the UI must re-measure and issue `layout` only for the active persisted workspace, on focus/visibility restoration. Missing/uninstalled providers are marked unavailable rather than silently remapped; offer removal to clean their IDs. Reboot, profile availability and real provider behavior still need device validation.

## Geometry and animation

Bounds are **dp relative to `android.R.id.content`**, not screen pixels and not automatically WebView CSS coordinates. `viewport` reports that native content viewport. The UI must align its Home canvas with this viewport, account for insets/content offsets, and convert measured CSS coordinates to dp using the matching viewport dimensions. Test edge-to-edge/cutouts, navigation modes, WebView viewport scaling, rotation and density. Do not assume `devicePixelRatio` alone accounts for page zoom or content offsets.

Native children sit in a non-clickable FrameLayout above the WebView within the Activity. Only widget child hit regions receive widget touch; this requires **no new system-overlay permission**. The widget’s own RemoteViews/PendingIntent handles its provider-native interaction. It must not be covered by a transparent DOM element expecting to intercept native touch. Conversely the native view must be hidden before displaying a DOM modal or gallery above it.

Never stream overview/drag animation frames into `layout`: final placement writes are synchronous to preserve crash-safe IDs/placement. Hide before animations; render a first-party noninteractive placeholder or explicit unavailable-preview card in the Vue overview, then attach the actual view only once animation settles. Do not claim a live DOM preview of a third-party RemoteViews widget. During continuous scroll/workspace motion, keep hosts hidden until the final visible layout. Native interactive content is not a transformable Vue texture.

## Build and validation

`scripts/android-configure.sh` invokes the idempotent `scripts/android-widgets.py` installer after existing native services. The installer copies the Kotlin source, merges the targeted provider visibility query and `BIND_APPWIDGET` permission, protects the JNI entrypoint from R8, and adds a result-routing block. Unknown custom result overrides or broken markers fail closed for a deliberate merge. Existing HOME/WebView/voice callbacks and manifest comments are preserved.

Commands:

```sh
python3 -m unittest discover -s tests/python -p 'test_android_widgets*.py' -v
cargo test -p cybermanju-launcher --lib widgets
npx vitest run tests/frontend/android-home-configure.test.ts tests/frontend/android-home-activity.test.ts tests/frontend/android-voice-services.test.ts
```

The Kotlin source is also compiled against an actual Android SDK during this change. JVM test doubles validate host decisions but do not replace emulator/physical-provider testing. Required device checks: bind allow/deny; mandatory and optional configuration; rotation/process death while approval is open; provider removal/update; per-workspace hide/show; native widget clicks; all densities/insets; keyboard/modal coverage; update listening and cleanup; and ensuring Android system gestures/Recents remain under OS control.

Official contracts: [Build a widget host](https://developer.android.com/develop/ui/views/appwidgets/host), [AppWidgetHost APIs](https://developer.android.com/reference/android/appwidget/AppWidgetHost).
