// CyberManju OS — UI Layout Composable API (src/composables/useUiLayout.ts).
// Role: Provide the app-facing API for the global UI layout runtime.
// Exports: installUiLayout, edit/reset event names, safe storage helpers and controls.
// Integrates: App-level layout plugin, global toolbar and home layout hooks.
// Contracts: Device-local persistence only; runtime installation is explicitly owned by the app root.
export { enterUiLayout, exitUiLayout, getUiLayoutEntities, installUiLayout, readUiLayout, requestUiLayoutSwap, resetUiLayout, UI_LAYOUT_EVENT, UI_LAYOUT_MODE_EVENT, UI_LAYOUT_RESET_EVENT, UI_LAYOUT_STORAGE_KEY, UI_LAYOUT_SWAP_EVENT, validateUiLayout } from '../utils/uiLayout'
export { UI_LAYOUT_MODE_RESIZE, UI_LAYOUT_SIZE_STORAGE_KEY, readUiLayoutSizes, validateUiLayoutSizes } from '../utils/uiLayout'
export type { UiLayoutEntity, UiLayoutMap, UiLayoutOffset, UiLayoutSwapRequest, UiLayoutSize, UiLayoutSizeMap } from '../utils/uiLayout'
