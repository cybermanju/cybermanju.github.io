<!-- CyberManju OS — MobileLauncher (src/components/MobileLauncher.vue). -->
<!-- Role: Vue desktop UI: windows, panels, overlays. -->
<!-- Exports: module root (see items below). -->
<!-- Integrates: @/…, vue. -->
<!-- Contracts: none special (pure logic; errors bubble to caller). -->
<template>
  <div
    ref="rootRef"
    class="mla"
    :class="[{ 'with-app-nav': hasOpenWindows }, `theme-${themeId}`]"
    role="main"
    aria-label="CyberManju home"
    @click.stop
    @pointerdown.capture="onLauncherPointerDown"
    @touchstart.capture.passive="onTouchStart"
    @touchmove.capture="onTouchMove"
    @touchend.capture="onTouchEnd"
    @touchcancel.capture.passive="cancelLauncherTouch"
    @contextmenu.capture="tapActivation.context"
    @click.capture="onLauncherClickCapture"
  >
    <header data-ui-layout-ignore class="mla-home-toolbar" aria-label="Home tools">
      <button class="mla-mini-btn" type="button" aria-controls="home-search-tools" title="Focus search" @click="toggleSearchTools"><AppIcon name="solar:magnifier-bold" :size="19" /><span>Search</span></button>
      <div class="mla-toolbar-actions">
        <button class="mla-mini-btn" type="button" aria-label="Notifications" @click="openMessages('system')"><AppIcon name="solar:bell-bold" :size="19" /><span v-if="sysUnread" class="mla-count">{{ sysUnread > 99 ? '99+' : sysUnread }}</span></button>
        <button v-if="msgHub.supported" class="mla-mini-btn" type="button" aria-label="Messages" @click="openMessages('messages')"><AppIcon name="solar:chat-round-dots-bold" :size="19" /><span v-if="msgHub.unread.value" class="mla-count">{{ msgHub.unread.value }}</span></button>
        <button class="mla-mini-btn" type="button" @click="openDrawer" aria-label="Open all apps">All apps</button>
      </div>
    </header>
    <HomeWorkspaceStudio ref="workspaceStudio" :apps="workspaceApps" :initial-ids="orderedApps.map(app => app.panel)" :blocked="hasOpenWindows || launcher.drawerOpen || launcher.messagesOpen || !!customHome || searchToolsOpen || !!query.trim()" @open="open($event as PanelType)" @customize="customizeWorkspaceApp">
      <template #home-tools>
        <section id="home-search-tools" class="mla-search-tools" aria-label="Search and commands" @focusin="activateSearchTools" @focusout="onSearchToolsBlur">
          <OmniSearchPanel ref="searchRef" home :before-open="hideNative" class="mla-unified-search" />
        </section>
      </template>
    </HomeWorkspaceStudio>
    <nav data-ui-layout-ignore v-if="dock.length" class="mla-dock" aria-label="Favorite apps">
      <button v-for="app in dock" :key="app.panel" class="mla-dock-btn" type="button"
        @pointerdown="onHomePressStart(app, $event)" @pointermove="onHomePressMove" @pointerup="onHomePressEnd" @pointerleave="onHomePressEnd" @pointercancel="onHomePressEnd"
        @contextmenu.prevent="onHomeContextMenu(app)" :aria-label="`Open ${homeName(app)}`" :title="homeName(app)" @click="open(app.panel)">
        <span class="mla-dock-icon"><img v-if="homeTile(app).kind === 'image'" class="mla-photo" :src="homeTile(app).src" alt="" draggable="false" /><AppIcon v-else :name="homeTile(app).src" :size="23" /></span>
        <span v-if="isPanelOpen(app.panel)" class="mla-dock-indicator" aria-hidden="true" />
      </button>
    </nav>

    <!-- Gaveta de Apps: swipe up from the bottom (or tap All apps). -->
    <AppDrawer :reveal-progress="drawerProgress" :built-in-apps="apps" />

    <!-- Messages hub: top-right icon (header tray on open apps, floating
      button above on home). -->
    <MessagesHub />

    <!-- Home tile customization (click-and-hold a tile). -->
    <div v-if="customHome" class="mla-custom-veil" @click.self="customHome = null">
      <div class="mla-custom" role="dialog" aria-label="Customize home tile">
        <strong class="mla-custom-title">{{ homeName(customHome) }}</strong>
        <span class="mla-custom-sub">{{ customHome.hint ?? customHome.label }}</span>
        <label class="mla-custom-row">
          <span class="mla-custom-label">Name</span>
          <input
            v-model="homeAliasDraft"
            class="mla-custom-input"
            type="text"
            maxlength="48"
            placeholder="Custom name"
            aria-label="Custom tile name"
          />
        </label>
        <div class="mla-custom-row">
          <span class="mla-custom-label">Icon</span>
          <div class="mla-custom-icon-row">
            <span class="mla-tile sm has-photo" v-if="customHomeTile.kind === 'image'">
              <img class="mla-photo" :src="customHomeTile.src" alt="" draggable="false" />
            </span>
            <button class="mla-mini-btn" type="button" @click="pickHomeGallery">
              <AppIcon name="solar:folder-bold" :size="15" /> Gallery
            </button>
            <input
              ref="homeFileRef"
              type="file"
              accept="image/*"
              class="mla-file"
              aria-label="Pick a custom icon from the gallery"
              @change="onHomeGalleryFile"
            />
          </div>
        </div>
        <div class="mla-custom-actions">
          <button class="mla-mini-btn" type="button" @click="editWorkspace">Edit screen</button>
          <button class="mla-mini-btn" type="button" @click="moveHomeCustom(-1)">← Move</button>
          <button class="mla-mini-btn" type="button" @click="moveHomeCustom(1)">Move →</button>
          <button class="mla-mini-btn" type="button" @click="hideHomeCustom">Hide</button>
        </div>
        <div class="mla-custom-actions">
          <button class="mla-mini-btn" type="button" :disabled="!launcher.favorites.includes(customHome.panel) && launcher.favorites.length >= 6" @click="launcher.toggleFavorite(customHome.panel)">{{ launcher.favorites.includes(customHome.panel) ? 'Remove from dock' : 'Add to dock' }}</button>
          <template v-if="launcher.favorites.includes(customHome.panel)">
            <button class="mla-mini-btn" type="button" aria-label="Move favorite earlier" @click="moveFavorite(-1)">Dock ←</button>
            <button class="mla-mini-btn" type="button" aria-label="Move favorite later" @click="moveFavorite(1)">Dock →</button>
          </template>
        </div>
        <div class="mla-custom-actions">
          <button class="mla-mini-btn primary" type="button" @click="saveHomeCustom">Save</button>
          <button class="mla-mini-btn" type="button" @click="resetHomeCustom">Reset</button>
          <button class="mla-mini-btn" type="button" @click="customHome = null">Close</button>
        </div>
        <p v-if="homeMsg" class="mla-custom-msg" role="status">{{ homeMsg }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import HomeWorkspaceStudio from '@/components/HomeWorkspaceStudio.vue'
import OmniSearchPanel from '@/components/OmniSearchPanel.vue'
import AppDrawer from '@/components/AppDrawer.vue'
import MessagesHub from '@/components/MessagesHub.vue'
import { moveHomeOrder } from '@/utils/homeLayout'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useHomeTapActivation } from '@/composables/useHomeTapActivation'
import { useLauncherWorkspaceGestures } from '@/composables/useLauncherWorkspaceGestures'
import { useTheme } from '@/composables/useTheme'
import { useAppStore } from '@/stores/app'
import { useLauncherStore } from '@/stores/launcher'
import { useAndroidApps } from '@/composables/useAndroidApps'
import { useMessages } from '@/composables/useMessages'
import { useNotifications } from '@/composables/useNotifications'
import { useWindowManager } from '@/composables/useWindowManager'
import {
  fileToLauncherIcon,
  launcherKeyForPanel,
} from '@/utils/launcher'
import type { PanelType } from '@/types'

const store = useAppStore()
const theme = useTheme()
const themeId = computed(() => String(theme.themeId.value))
const tapActivation = useHomeTapActivation()
function cancelHomeTap() { tapActivation.cancel(); workspaceGestures.cancel(); resetDrawerGesture() }
const wm = useWindowManager()
const launcher = useLauncherStore()
const androidApps = useAndroidApps()
const msgHub = useMessages()
// One composable instance for setup scope — instantiating it inside a
// computed would re-run it on every recompute.
const sys = useNotifications()
const sysUnread = computed(() => sys.unreadCount.value)
const workspaceStudio = ref<{ removeApp: (id: string) => void; reorderApp: (id: string, direction: -1 | 1) => void; hideNative: () => Promise<boolean>; editScreen: () => Promise<void> } | null>(null)
const query = computed({ get: () => store.searchQuery, set: (value: string) => { store.searchQuery = value } })
const rootRef = ref<HTMLElement | null>(null)
const searchRef = ref<{ focus: () => void } | null>(null)
const searchToolsOpen = ref(false)
async function toggleSearchTools() {
  if (!await hideNative()) return
  await nextTick()
  searchRef.value?.focus()
}
function activateSearchTools() {
  searchToolsOpen.value = true
  void hideNative()
}
function onSearchToolsBlur(event: FocusEvent) {
  const section = event.currentTarget as HTMLElement
  if (!section.contains(event.relatedTarget as Node | null)) searchToolsOpen.value = false
}
async function hideNative() { return await workspaceStudio.value?.hideNative() ?? true }
async function openMessages(tab: 'system' | 'messages') { if (await hideNative()) launcher.setMessagesOpen(true, tab) }
async function editWorkspace() { customHome.value = null; await workspaceStudio.value?.editScreen() }
const hasOpenWindows = computed(() => wm.windows.value.some(window => !window.minimized))
let suppressHomeClickUntil = 0
function onLauncherPointerDown(event: PointerEvent) {
  tapActivation.pointer(event)
  if (event.isPrimary && event.pointerType !== 'touch') suppressHomeClickUntil = 0
}
function onLauncherClickCapture(event: MouseEvent) {
  tapActivation.click(event)
  if (event.defaultPrevented) return
  if (event.detail === 0) return
  if ((event.target as HTMLElement | null)?.closest('.home-studio')) return
  if (Date.now() < suppressHomeClickUntil) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}
const drawerProgress = ref(0)
let drawerFrame = 0
let pendingDrawerProgress = 0
function queueDrawerProgress(progress: number) {
  pendingDrawerProgress = progress
  if (drawerFrame) return
  drawerFrame = requestAnimationFrame(() => { drawerFrame = 0; drawerProgress.value = pendingDrawerProgress })
}
function resetDrawerGesture() {
  if (drawerFrame) cancelAnimationFrame(drawerFrame)
  drawerFrame = 0
  drawerProgress.value = 0
}
// Capture observes one-finger workspace gestures before the Home surface stops
// bubbling. Multitouch, controls, widgets, edit/overview and content scroll stay
// with their original owners; the app-wide Pointer recognizer remains excluded.
const workspaceGestures = useLauncherWorkspaceGestures({
  blocked: () => hasOpenWindows.value || launcher.drawerOpen || searchToolsOpen.value || !!query.value.trim() || !!customHome.value || launcher.messagesOpen,
  openDrawer: () => { void openDrawer() },
  openSearch: () => { void toggleSearchTools() },
  progress: value => { if (value === 0) resetDrawerGesture(); else queueDrawerProgress(value) },
  suppressClick: () => { suppressHomeClickUntil = Date.now() + 800 },
})
function onTouchStart(event: TouchEvent) { tapActivation.start(event); workspaceGestures.start(event) }
function onTouchMove(event: TouchEvent) { tapActivation.move(event); workspaceGestures.move(event) }
function onTouchEnd(event: TouchEvent) { tapActivation.end(event); workspaceGestures.end(event) }
function cancelLauncherTouch(event: TouchEvent) { tapActivation.cancel(event); workspaceGestures.cancel(event); resetDrawerGesture() }
onUnmounted(cancelHomeTap)
function handleMsgVisible() {
  if (document.visibilityState !== 'visible') return
  // `refresh()` early-returns on a cached 'ready' — force so returning to the
  // app actually updates the badge.
  if (msgHub.supported) void msgHub.refresh(true).catch(() => {})
  // Resume hook (existing visibility listener): the system uninstall sheet
  // backgrounds the app, so re-list while the drawer is on screen instead of
  // leaving uninstalled rows stale.
  if (launcher.drawerOpen && androidApps.supported) {
    void androidApps.refresh(true).catch(() => {})
  }
}

onMounted(() => {
  window.addEventListener('blur', cancelHomeTap)
  document.addEventListener('visibilitychange', cancelHomeTap)
  void store.fetchDisks().catch(() => {})
  void store.fetchTrashItems().catch(() => {})
  void store.fetchSyncConfigs().catch(() => {})
  // Silent badge feed for the top-right messages icon (stored mirror only).
  if (msgHub.supported) {
    void msgHub.refresh().catch(() => {})
    document.addEventListener('visibilitychange', handleMsgVisible)
  }
})

onUnmounted(() => {
  onHomePressEnd()
  window.removeEventListener('blur', cancelHomeTap)
  document.removeEventListener('visibilitychange', cancelHomeTap)
  document.removeEventListener('visibilitychange', handleMsgVisible)
})

interface LauncherApp {
  panel: PanelType
  label: string
  icon: string
  tint: string
  badge?: string
  dot?: boolean
  hint?: string
}

function count(value: number): string {
  if (!value) return ''
  return value > 99 ? '99+' : String(value)
}

const apps = computed<LauncherApp[]>(() => [
  { panel: 'files', label: 'Files', icon: 'solar:folder-bold', tint: '#3984e8', badge: count(store.files.length), hint: 'Browse and manage files' },
  { panel: 'search', label: 'Search', icon: 'solar:magnifier-bold', tint: '#727be8', hint: 'Full-text search' },
  { panel: 'agent', label: 'Agents', icon: 'solar:bot-bold', tint: '#8b5ad8', dot: store.activeAgentJob?.status === 'running', hint: 'Agents, profiles and conversations' },
  { panel: 'shortcuts', label: 'Shortcuts', icon: 'solar:code-bold', tint: '#697ad8', hint: 'Editor visual de ações e condições' },
  { panel: 'storage', label: 'Vaults', icon: 'solar:diskette-bold', tint: '#2198c3', badge: count(store.disks.length), hint: 'Private vaults and disks' },
  { panel: 'accounts', label: 'Accounts', icon: 'solar:user-circle-bold', tint: '#38a87b', hint: 'Providers and users' },
  { panel: 'terminal', label: 'Terminal', icon: 'solar:file-terminal-bold', tint: '#4c596b', hint: 'cybsh shell' },
  { panel: 'editor', label: 'Code', icon: 'solar:file-code-bold', tint: '#df7b38', hint: 'Code studio' },
  { panel: 'sync', label: 'Sync', icon: 'solar:refresh-bold', tint: '#159ba0', hint: 'Provider sync jobs' },
  { panel: 'map', label: 'Map', icon: 'solar:map-bold', tint: '#4b9a5a', hint: 'GPS-tagged files' },
  { panel: 'collections', label: 'Library', icon: 'solar:library-bold', tint: '#d45d96', hint: 'Collections and favorites' },
  { panel: 'settings', label: 'Settings', icon: 'solar:settings-bold', tint: '#65758c', hint: 'Theme and transport' },
  { panel: 'trash', label: 'Trash', icon: 'solar:trash-bin-trash-bold', tint: '#d74a61', badge: count(store.trashItems.length), hint: 'Deleted files' },
])


/** Home springboard merged with launcher overrides (`os:<panel>` keys):
 * hidden tiles drop out, ordered slots come first, the rest label-sort. */
const orderedApps = computed<LauncherApp[]>(() => {
  const rows = apps.value.map((app) => {
    const key = launcherKeyForPanel(app.panel)
    const ov = launcher.overrides[key]
    return { app, key, ov, order: typeof ov?.order === 'number' ? ov.order : -1 }
  }).filter((r) => !r.ov?.hidden)
  rows.sort((a, b) => {
    const ao = a.order >= 0 ? a.order : Number.MAX_SAFE_INTEGER
    const bo = b.order >= 0 ? b.order : Number.MAX_SAFE_INTEGER
    if (ao !== bo) return ao - bo
    return a.app.label.toLowerCase().localeCompare(b.app.label.toLowerCase())
  })
  return rows.map((r) => r.app)
})

const workspaceApps = computed(() => apps.value.map(app => ({ id: app.panel, label: homeName(app), icon: app.icon, image: homeTile(app).kind === 'image' ? homeTile(app).src : undefined })))
function customizeWorkspaceApp(id: string) { const app = apps.value.find(app => app.panel === id); if (app) openHomeCustom(app) }

/** Display name honoring the rename override. */
function homeName(app: LauncherApp): string {
  const alias = (launcher.overrides[launcherKeyForPanel(app.panel)]?.alias ?? '').trim()
  return alias || app.label
}

/** Display icon honoring the gallery-icon override. */
function homeTile(app: LauncherApp): { kind: 'icon' | 'image'; src: string } {
  const custom = (launcher.overrides[launcherKeyForPanel(app.panel)]?.customIcon ?? '').trim()
  if (custom) return { kind: 'image', src: custom }
  return { kind: 'icon', src: app.icon }
}

const dock = computed(() => launcher.favorites.flatMap(panel => {
  const app = orderedApps.value.find(app => app.panel === panel)
  return app ? [app] : []
}))
function isPanelOpen(panel: PanelType): boolean {
  return wm.windows.value.some(window => window.panelType === panel && !window.minimized)
}

async function open(panel: PanelType) {
  if (contextMenuFired) {
    // The contextmenu already opened the customize sheet for this gesture —
    // swallow the click that follows instead of launching the app under it.
    contextMenuFired = false
    return
  }
  if (longPressedHome) {
    longPressedHome = false
    return
  }
  if (!apps.value.some(app => app.panel === panel) || !await hideNative()) return
  if (store.currentPanel === 'landing') store.currentPanel = 'files'
  wm.open(panel)
  try {
    ;(navigator as Navigator & { vibrate?: (pattern: number) => boolean }).vibrate?.(8)
  } catch { /* optional haptic feedback */ }
}

async function openDrawer() {
  if (!await hideNative()) return
  launcher.setDrawer(true)
  if (androidApps.supported) void androidApps.refresh().catch(() => {})
}

// ── Click-and-hold customization for home tiles ────────────────
// Rename / gallery icon / move / hide / reset, stored per `os:<panel>`.
let homePressTimer: ReturnType<typeof setTimeout> | null = null
let longPressedHome = false
/** Android WebView fires `contextmenu` at ~500ms — BEFORE the 550ms
 * long-press timer. Without this flag a release in the 500-550ms window lets
 * the follow-up `click` run `open()` and launch the app under the sheet. */
let contextMenuFired = false
const customHome = ref<LauncherApp | null>(null)
const homeAliasDraft = ref('')
const homeMsg = ref('')
/** Staged gallery icon for the open sheet — component-local only; the store
 * deep-watch would persist `launcher.setIcon` instantly. `saveHomeCustom()`
 * is the single commit point (closing without Save discards it). */
const homeIconDraft = ref('')
const homeFileRef = ref<HTMLInputElement | null>(null)

/** Sheet preview: the staged gallery icon wins over the stored override. */
const customHomeTile = computed(() => {
  const staged = homeIconDraft.value.trim()
  if (staged) return { kind: 'image' as const, src: staged }
  return customHome.value
    ? homeTile(customHome.value)
    : { kind: 'icon' as const, src: 'solar:settings-bold' }
})

async function openHomeCustom(app: LauncherApp) {
  if (!await hideNative()) return
  customHome.value = app
  homeAliasDraft.value = launcher.overrides[launcherKeyForPanel(app.panel)]?.alias ?? ''
  homeMsg.value = ''
  homeIconDraft.value = ''
}

let homePressStart: { x: number; y: number } | null = null
function onHomePressStart(app: LauncherApp, e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  homePressStart = { x: e.clientX, y: e.clientY }
  longPressedHome = false
  contextMenuFired = false
  if (homePressTimer) clearTimeout(homePressTimer)
  homePressTimer = setTimeout(() => {
    longPressedHome = true
    try {
      ;(navigator as Navigator & { vibrate?: (pattern: number) => boolean }).vibrate?.(15)
    } catch { /* optional */ }
    openHomeCustom(app)
  }, 550)
}

function onHomePressMove(e: PointerEvent) {
  if (homePressStart && Math.hypot(e.clientX - homePressStart.x, e.clientY - homePressStart.y) > 10) onHomePressEnd()
}
function onHomePressEnd() {
  homePressStart = null
  if (homePressTimer) {
    clearTimeout(homePressTimer)
    homePressTimer = null
  }
}

/** Right-click / Android touch long-press: `contextmenu` arrives at ~500ms,
 * before the 550ms timer — cancel the timer (so it cannot arm
 * `longPressedHome` for the next click) and flag the gesture as consumed. */
function onHomeContextMenu(app: LauncherApp) {
  if (homePressTimer) {
    clearTimeout(homePressTimer)
    homePressTimer = null
  }
  longPressedHome = false
  // Native touch long-press and mouse hold share the same icon sheet;
  // Arrange home inside it is the only entry into mobile layout editing.
  contextMenuFired = true
  openHomeCustom(app)
}

function homeKey(app: LauncherApp): string {
  return launcherKeyForPanel(app.panel)
}

function saveHomeCustom() {
  const app = customHome.value
  if (!app) return
  const key = homeKey(app)
  // Staged icon commits here too — the sheet closes below, so the confirmation
  // leaves with it as a transient toast (the in-sheet `homeMsg` line could
  // never render once `customHome` is null).
  if (homeIconDraft.value) launcher.setIcon(key, homeIconDraft.value)
  launcher.rename(key, homeAliasDraft.value)
  launcher.pinToEnd(key)
  store.notifySuccess(`Saved “${homeName(app)}”.`)
  customHome.value = null
}

function pickHomeGallery() {
  homeFileRef.value?.click()
}

async function onHomeGalleryFile(e: Event) {
  const input = e.target as HTMLInputElement | null
  const file = input?.files?.[0]
  const app = customHome.value
  if (!file || !app) return
  try {
    const url = await fileToLauncherIcon(file)
    // Staged only — `saveHomeCustom()` commits it (closing discards).
    homeIconDraft.value = url
    homeMsg.value = 'Gallery icon staged — Save to keep it.'
  } catch (err) {
    store.notifyError('Could not read that image', err)
  } finally {
    if (input) input.value = ''
  }
}

function moveHomeCustom(dir: -1 | 1) {
  const app = customHome.value
  if (!app) return
  workspaceStudio.value?.reorderApp(app.panel, dir)
  homeMsg.value = dir < 0 ? 'Moved earlier.' : 'Moved later.'
}

function moveFavorite(direction: -1 | 1) {
  if (!customHome.value) return
  launcher.setFavorites(moveHomeOrder(launcher.favorites, customHome.value.panel, direction))
  homeMsg.value = 'Dock favorites updated.'
}

function hideHomeCustom() {
  const app = customHome.value
  if (!app) return
  launcher.hide(homeKey(app), true)
  workspaceStudio.value?.removeApp(app.panel)
  store.notifySuccess(`${homeName(app)} hidden — use + to add it again`)
  customHome.value = null
}

function resetHomeCustom() {
  const app = customHome.value
  if (!app) return
  launcher.reset(homeKey(app))
  customHome.value = null
}

</script>

<style scoped>
.mla { position: absolute; inset: 0; z-index: 0; isolation: isolate; display: flex; flex-direction: column; gap: 8px; width: 100%; height: 100%; min-width: 0; min-height: 0; box-sizing: border-box; overflow: hidden; padding: 8px 16px max(12px, env(safe-area-inset-bottom, 0px)); background: var(--ui-bg); color: var(--ui-text); font-family: var(--ui-font); }
.mla.with-app-nav { padding-bottom: calc(66px + env(safe-area-inset-bottom, 0px)); }
.mla-home-toolbar, .mla-toolbar-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mla-home-toolbar { flex-shrink: 0; }
.mla-mini-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 44px; min-height: 44px; padding: 8px 12px; color: var(--ui-text); background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 12px; cursor: pointer; font: inherit; font-size: 12px; }
.mla button:focus-visible, .mla input:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.mla-search-tools { position: relative; z-index: 2; flex: 0 0 auto; align-self: stretch; width: 100%; min-width: 0; display: grid; gap: 10px; }
.mla-search-tools .mla-unified-search { min-width: 0; width: 100%; padding: 0; box-sizing: border-box; }
.mla-unified-search :deep(.omni-col) { position: static; width: 100%; min-width: 0; }
/* Results float over the workspace without squeezing its app grid. */
.mla-unified-search :deep(.omni-drop) { position: absolute; inset: 100% 0 auto; z-index: 3; box-sizing: border-box; }
.mla-search-tools :deep(.home-command) { width: 100%; box-sizing: border-box; }
@media (max-width: 520px) {
  .mla-home-toolbar { flex-wrap: wrap; }
  .mla-toolbar-actions { margin-left: auto; }
  .mla-search-tools { gap: 8px; }
  .mla-unified-search :deep(.omni-bar__hint) { display: none; }
}
.mla-count { color: var(--ui-accent); font-size: 11px; }
.mla-dock { display: flex; flex-shrink: 0; justify-content: center; align-self: center; gap: clamp(4px, 2vw, 14px); max-width: 100%; padding: 6px 10px; box-sizing: border-box; border-radius: 20px; background: var(--ui-surface); border: 1px solid var(--ui-border); }
.mla-dock-btn { position: relative; width: 44px; min-height: 44px; padding: 0; display: grid; place-items: center; border: 0; background: transparent; color: var(--ui-text); cursor: pointer; }
.mla-dock-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; overflow: hidden; }
.mla-photo { width: 100%; height: 100%; object-fit: cover; }
.mla-dock-indicator { position: absolute; bottom: 0; width: 4px; height: 4px; background: var(--ui-accent); border-radius: 50%; }
@media (max-width: 768px) {
  .mla { height: 100%; }
  .mla-search-tools, .mla-search-tools :deep(.home-command), .mla-search-tools :deep(.omni-bar) { max-width: none; }
  .mla-dock-icon { width: 42px; height: 42px; }
  .mla-dock-btn :deep(svg) { width: 28px; height: 28px; }
}
.mla.theme-flat-amoled { background: #000; }
.mla.theme-flat-amoled .mla-dock { background: transparent; }
.mla.theme-modern-glass { background: var(--ui-ambient-background, var(--ui-glass)); }
.mla.theme-modern-glass .mla-dock { background: var(--ui-glass); backdrop-filter: blur(var(--ui-blur, 0px)) saturate(var(--ui-saturate, 1)); }


.mla-photo {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  display: block;
}

/* Home tile customization sheet. */
.mla-custom-veil {
  position: fixed;
  inset: 0;
  z-index: 9500;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: color-mix(in srgb, var(--ui-bg-deep) 55%, transparent);
}

/* Home tile customization sheet — capped so landscape phones (short
   viewport) scroll the sheet instead of clipping Save/Close off-screen. */
.mla-custom {
  width: min(480px, 100vw);
  max-height: min(68dvh, 560px);
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  border-radius: 20px 20px 0 0;
  border: 1px solid var(--ui-border-strong);
  border-bottom: 0;
  background: color-mix(in srgb, var(--ui-surface) 92%, var(--ui-bg));
  color: var(--ui-text);
}

.mla-custom-title {
  font-size: 16px;
}

.mla-custom-sub {
  margin-top: -8px;
  color: var(--ui-text-3);
  font-size: 12px;
}

.mla-custom-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mla-custom-label {
  flex: 0 0 52px;
  color: var(--ui-text-3);
  font-size: 12px;
  font-weight: 600;
}

.mla-custom-input {
  flex: 1;
  min-width: 0;
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 14px;
}

.mla-custom-icon-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.mla-file {
  display: none;
}

.mla-custom-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mla-mini-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--ui-border-strong);
  border-radius: 12px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.mla-mini-btn.primary {
  background: var(--ui-accent);
  border-color: var(--ui-accent);
  color: var(--ui-on-accent);
}

.mla-custom-msg {
  margin: 0;
  color: var(--ui-text-3);
  font-size: 12px;
}

@media (max-width: 380px) { .mla { padding-inline: 8px; }.mla-dock { gap: 2px; padding-inline: 4px; } }
@media (prefers-reduced-motion: reduce) { .mla *, .mla *::before { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
</style>
