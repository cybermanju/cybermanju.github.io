<!-- CyberManju OS — Persistent, app-local Home workspaces. Not Android Recents. -->
<!-- Role: app-local Home UI only. Integrates: Vue and bounded persisted workspace state. -->
<template>
  <section ref="root" class="home-studio" :class="{ 'motion-reduced': motion.reduced.value, 'is-editing': editing, 'is-overview': overview, 'screen-enter-next': screenMotion === 'next', 'screen-enter-previous': screenMotion === 'previous' }" data-ui-layout-ignore data-shell-gesture-exclude @pointerdown.capture="emptyPress.newPointer" @click.capture="homeClick" :inert="props.blocked" tabindex="0" @keydown="workspaceKeys" aria-label="Personal home workspaces" @touchstart.stop.passive="touchStart" @touchmove.stop="touchMove" @touchend.stop="touchEnd" @touchcancel.stop="cancelTouch">
    <div class="studio-surface" :inert="!!picker">
    <div class="studio-heading">
      <div><span class="studio-kicker">SCREEN {{ activeIndex + 1 }} / {{ state.pages.length }}</span><h2>{{ activePage.title }}</h2></div>
      <div class="studio-tools"><button ref="overviewButton" type="button" :aria-pressed="overview" aria-controls="home-screen-overview" aria-label="Overview of home screens" @click="toggleOverview"><AppIcon name="solar:widget-bold" :size="20" /></button><button type="button" :aria-pressed="editing" @click="toggleEditing">{{ editing ? 'Done' : 'Edit' }}</button><button ref="addButton" class="studio-add" type="button" aria-label="Add apps or widgets to home" @click="openPicker('apps')"><span aria-hidden="true">+</span></button></div>
    </div>
    <p class="studio-status" role="status">{{ message }}</p>
    <Teleport to="body"><div class="native-suspend-alert" :class="{ 'has-error': suspendError }" role="alert" aria-live="assertive" aria-atomic="true">{{ suspendError }}</div></Teleport>
    <div class="studio-stage">
    <section v-if="overview" id="home-screen-overview" class="overview-surface" aria-label="Home screen overview">
      <div class="overview-bar"><strong>Screen overview</strong><button type="button" :disabled="state.pages.length >= MAX_WORKSPACES" @click="newScreen">+ New screen</button><button type="button" aria-label="Zoom out overview" @click="zoom = Math.max(.65, zoom - .15)">−</button><span>{{ Math.round(zoom * 100) }}%</span><button type="button" aria-label="Zoom in overview" @click="zoom = Math.min(1.4, zoom + .15)">+</button><button type="button" @click="zoom = 1; panX = 0; panY = 0">Reset</button><button type="button" @click="closeOverview">Done</button></div>
      <p class="studio-hint">Home screens only, not Android Recents. Touch adaptation: tap a screen, use its move menu, or pan / pinch with two fingers here.</p>
      <div class="eagle-viewport">
        <div class="eagle-canvas" :style="{ '--overview-card-min': `${Math.round(128 * zoom)}px`, transform: `translate(${panX}px, ${panY}px)` }">
          <article v-for="(page, index) in state.pages" :key="page.id" class="eagle-card" :class="{ current: page.id === state.activeId, 'drop-ready': dragging && page.id !== dragging.from }" :data-workspace-id="page.id">
            <button class="eagle-select" type="button" :aria-label="`Go to ${page.title}, screen ${index + 1}, ${page.items.length} items`" :aria-current="page.id === state.activeId ? 'page' : undefined" @click="selectScreen(index)"><HomeWorkspacePreview :items="page.items" :icon-for="itemIcon" :image-for="appImage" /></button>
            <details v-if="page.items.length" class="eagle-move-list"><summary :aria-label="`Move items from screen ${index + 1}`"><AppIcon name="solar:menu-dots-bold" :size="18" /></summary><div class="eagle-items"><button v-for="item in page.items" :key="item.id" class="eagle-chip" type="button" :aria-label="`Move ${itemTitle(item)}; use Edit on home for keyboard move controls`" :title="itemTitle(item)" @pointerdown="beginDrag($event, item, page.id)" @pointerup="finishDrag" @pointercancel="dragging = null"><AppIcon :name="itemIcon(item)" :size="16" /></button></div></details>
          </article>
        </div>
      </div>
    </section>
    <div class="studio-home" :inert="overview" :aria-hidden="overview || undefined">
      <div v-if="editing" class="screen-tools"><button type="button" :disabled="state.pages.length >= MAX_WORKSPACES" @click="newScreen">+ New screen</button><label class="grid-control">Columns<select v-model.number="activePage.columns"><option v-for="n in 8" :key="n" :value="n" :disabled="n < 2">{{ n }}</option></select></label><label class="grid-control">Rows<select v-model.number="activePage.rows"><option v-for="n in 8" :key="n" :value="n" :disabled="n < 2">{{ n }}</option></select></label><button type="button" :aria-pressed="editing" @click="toggleEditing">Done</button><button type="button" @click="openPicker('widgets')">Widget library</button></div>
      <HomeDefaultRoleAction v-if="editing" :before-request="suspendHome" />
      <label v-if="editing" class="screen-name">Screen name<input v-model="activePage.title" maxlength="40" aria-label="Screen name" /></label>
        <div v-for="page in visitedPages" v-show="page.id === state.activeId" :key="page.id" class="workspace-content" tabindex="0" aria-label="Home screen canvas" :inert="page.id !== state.activeId"
          @pointerdown="emptyPress.down" @pointermove="emptyPress.move" @pointerleave="emptyPress.cancel" @pointerup="emptyPress.cancel" @pointercancel="emptyPress.cancel"
          @touchstart.passive="emptyPress.touch" @contextmenu="emptyPress.context" @click.capture="emptyPress.click">
          <slot v-if="page.id === state.pages[0]?.id" name="home-tools" />
          <div v-if="!page.items.length" class="empty-orbit"><h3>Your space</h3><p>Hold empty space to add an app or widget.</p><button type="button" @click="openPicker('apps')">+ Add an item</button></div>
          <div class="workspace-apps" v-if="page.items.some(i => i.kind === 'app')" :style="{ gridTemplateColumns: `repeat(${page.columns || 4}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${page.rows || 4}, minmax(84px, auto))` }"><article v-for="item in page.items.filter(i => i.kind === 'app')" :key="item.id" class="workspace-app" :class="{ 'app-pressed': pressItem?.id === item.id, 'app-dragging': appDrag?.id === item.id }"><button class="workspace-launch" :data-item-id="item.id" type="button" :aria-label="`Open ${itemTitle(item)}; hold for options`" @pointerdown="appPointerDown($event, item, page.id)" @pointermove="appPointerMove" @pointerup="appPointerUp($event, item, page.id)" @pointercancel="cancelAppGesture" @contextmenu.prevent="openAppMenu(item, page.id, $event.clientX, $event.clientY)" @click="appClick(item)"><span class="workspace-app-icon"><img v-if="appFor(item.ref)?.image" :src="appFor(item.ref)?.image" alt="" /><AppIcon v-else :name="itemIcon(item)" :size="32" /></span><span>{{ itemTitle(item) }}</span></button><div v-if="editing" class="item-edit"><button type="button" :aria-label="`Customize ${itemTitle(item)}`" @click="customize(item.ref)">Style</button><button type="button" :aria-label="`Remove ${itemTitle(item)} from screen`" @click="removeItem(item)">×</button><label :aria-label="`Move ${itemTitle(item)} to screen`"><select :value="activePage.id" :aria-label="`Move ${itemTitle(item)} to screen`" @change="moveItem(item, ($event.target as HTMLSelectElement).value)"><option v-for="p in state.pages" :key="p.id" :value="p.id">{{ p.title }}</option></select></label></div></article></div>
          <div class="workspace-widgets" :style="{ gridTemplateColumns: `repeat(${page.columns || 4}, minmax(0, 1fr))` }"><article v-for="item in page.items.filter(i => i.kind === 'widget')" :key="item.id" class="workspace-widget" :class="{ 'native-home-card': isNative(item) }"><header><span><AppIcon :name="itemIcon(item)" :size="16" />{{ itemTitle(item) }}</span><button v-if="editing" type="button" :aria-label="`Remove ${itemTitle(item)}`" @click="removeItem(item)">×</button></header><template v-if="isNative(item)"><p class="native-state" role="status">{{ nativeState(item) }}</p><div :data-native-placement="item.id" class="native-widget-slot" :style="{ height: nativeHeight(item) + 'px', width: nativeWidth(item) }"><AppIcon name="solar:widget-bold" :size="28" /><span>Android widget · native view</span><small>No live DOM preview. Hidden during scrolling, menus and Eagle view.</small></div><p v-if="nativeHome.placementMessages.value[item.id]" class="studio-hint" role="status">{{ nativeHome.placementMessages.value[item.id] }}</p><div class="native-actions"><button type="button" @click="checkNative">Check status</button><button v-if="nativeRecord(item)?.state === 'ready'" type="button" :disabled="native.busy.value || !nativeRecord(item)?.providerAvailable" @click="configureNative(item)">Configure</button><button v-else-if="nativeRecord(item)" type="button" :disabled="native.busy.value" @click="removeNative(item, true)">Cancel setup</button></div><label v-if="editing" class="widget-move">Width (dp)<input type="number" :min="nativeMinWidth(item)" max="640" step="20" :value="Number(item.data?.widthDp || 280)" @change="resizeNativeWidth(item, ($event.target as HTMLInputElement).value)" /></label><label v-if="editing" class="widget-move">Height (dp)<input type="number" :min="nativeMinimum(item)" max="640" step="20" :value="Number(item.data?.heightDp || 180)" @change="resizeNative(item, ($event.target as HTMLInputElement).value)" /></label></template><HomeLocalWidget v-else :item="item" :app-id="widgetFor(item.ref)?.appId" @update="item.data = $event" @open="launch" /><label v-if="editing" class="widget-move">Move to<select :value="activePage.id" :aria-label="`Move ${itemTitle(item)} to screen`" @change="moveItem(item, ($event.target as HTMLSelectElement).value)"><option v-for="p in state.pages" :key="p.id" :value="p.id">{{ p.title }}</option></select></label></article></div>
          <p v-if="editing" class="studio-hint">Removing an app only unpins it. Removing an Android widget also deletes its host placement, not the app. Move tiles using the screen selector or Eagle view.</p>
        </div>
      <nav class="screen-nav" aria-label="Home screen navigation">
        <div class="orb-navigator" :class="{ 'orb-active': orbActive }" @pointerdown="orbPointerDown" @pointermove="orbPointerMove" @pointerup="orbPointerEnd" @pointercancel="orbPointerCancel" @pointerleave="orbPointerLeave">
          <button v-for="direction in orbDirections" :key="direction.id" class="orb-direction" :class="`orb-direction-${direction.id}`" type="button" :disabled="!orbCanNavigate(direction.dx, direction.dy)" :aria-label="direction.id === 'n' ? 'Next home screen' : direction.id === 's' ? 'Previous home screen' : `${orbStep(direction.dx, direction.dy) > 0 ? 'Next' : 'Previous'} home screen, swipe ${direction.label}`" @click="navigateOrb(direction.dx, direction.dy)">{{ direction.arrow }}</button>
          <div class="orb-core" role="img" :aria-label="`Home screen ${activeIndex + 1} of ${state.pages.length}. Swipe in any direction to switch screens.`">
            <svg class="orb-art" viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">
              <defs><clipPath id="orb-mask"><path d="M20 4h24v4h8v8h4v32h-4v8h-8v4H20v-4h-8v-8H8V16h4V8h8z"/></clipPath></defs>
              <g clip-path="url(#orb-mask)"><rect width="64" height="64" fill="#080808"/><path d="M20 6h22v4h8v8h4v12H40v-6h-8v-6h-8v-6h-6z" fill="#fff"/><path d="M10 32h10v-8h8v8h8v8h8v8h10v8H42v4H20v-4h-8v-8h-2z" fill="#bdbdbd"/><path d="M14 18h8v8h-8zm28 20h8v8h-8zM26 10h6v6h-6zm-8 28h6v6h-6z" fill="#050505"/><path d="M20 4h24v4h8v8h4v32h-4v8h-8v4H20v-4h-8v-8H8V16h4V8h8z" fill="none" stroke="#fff" stroke-opacity=".82" stroke-width="2"/></g>
            </svg>
            <span class="orb-screen-count">{{ activeIndex + 1 }}<i>/{{ state.pages.length }}</i></span>
            <span class="orb-sheen" aria-hidden="true" />
          </div>
        </div>
        <span class="orb-caption" aria-hidden="true">ORBITAL SCREEN SELECTOR · 8 DIRECTIONS</span>
      </nav>
      <p class="studio-hint gesture-hint">Swipe any direction between screens · Three fingers up: Home overview · Alt+O · Hold empty space to add</p>
    </div>
    </div>
    </div>
    <Teleport to="body"><div v-if="appMenu" class="app-menu-backdrop" @pointerdown.self="closeAppMenu"><section class="app-menu" role="menu" :style="{ left: `${appMenu.x}px`, top: `${appMenu.y}px` }" :aria-label="`${itemTitle(appMenu.item)} options`" @pointerdown.stop><div class="app-menu-heading"><span class="workspace-app-icon"><AppIcon :name="itemIcon(appMenu.item)" :size="24" /></span><strong>{{ itemTitle(appMenu.item) }}</strong><button type="button" aria-label="Close app options" @click="closeAppMenu">×</button></div><button role="menuitem" @click="runMenuAction('open')">Open</button><button role="menuitem" @click="runMenuAction('customize')">Switch icon / style</button><label class="app-menu-rename">Rename<input v-model="appMenu.item.data!.label" maxlength="40" aria-label="App name" @change="saveAppRename" /></label><div class="app-menu-move"><span>Move to</span><button v-for="screen in state.pages" :key="screen.id" role="menuitem" :disabled="screen.id === appMenu.pageId || screen.items.length >= MAX_ITEMS_PER_WORKSPACE" @click="moveFromMenu(screen.id)">{{ screen.title }}</button></div><button class="app-menu-remove" role="menuitem" @click="removeFromMenu">Remove from screen</button></section></div></Teleport>
    <div v-if="picker" class="studio-veil" @click.self="closePicker" @keydown="dialogKeys">
      <section ref="dialog" class="studio-picker" role="dialog" aria-modal="true" aria-labelledby="home-picker-title" tabindex="-1">
        <header class="picker-title"><div><h2 id="home-picker-title">Add to {{ activePage.title }}</h2></div><button type="button" aria-label="Close add to home" @click="closePicker">×</button></header>
        <div class="picker-tabs" role="group" aria-label="Personalization categories"><button v-for="tab in (['apps', 'widgets'] as const)" :key="tab" type="button" :aria-pressed="picker === tab" @click="picker = tab">{{ tab === 'apps' ? 'Apps' : 'Widgets' }}</button></div>
        <label class="picker-search"><AppIcon name="solar:magnifier-bold" :size="18" /><input v-model="pickerQuery" type="search" :placeholder="picker === 'apps' ? 'Find an app to pin…' : 'Find your next widget…'" aria-label="Search add to home library" /></label><p class="studio-hint">Adding to {{ activePage.title }} · {{ activePage.items.length }} / {{ MAX_ITEMS_PER_WORKSPACE }} items</p>
        <div v-if="picker === 'apps'" class="picker-list"><button v-for="app in pickerApps" :key="app.id" type="button" :disabled="hasItem('app', app.id)" @click="add('app', app.id)"><img v-if="app.id.startsWith('android:') && app.image" class="picker-app-icon" :src="app.image" :alt="''" decoding="async" /><AppIcon v-else :name="app.icon" :size="23" /><span><strong>{{ app.label }}</strong><small>{{ app.id.startsWith('android:') ? 'Android app shortcut' : 'CyberManju app' }}</small></span><span>{{ hasItem('app', app.id) ? 'Added' : '+' }}</span></button><p v-if="!pickerApps.length">No matching apps.</p><p v-if="androidApps.status.value === 'error'" role="status">Android apps could not be loaded. Open All apps to retry.</p></div>
        <template v-else-if="picker === 'widgets'"><div class="widget-filters" role="group" aria-label="Widget integration types"><button v-for="type in (['All types', 'CyberManju', 'Android widgets', 'Service concepts'] as const)" :key="type" type="button" :aria-pressed="widgetType === type" @click="widgetType = type">{{ type }}</button></div><div class="widget-filters"><button v-for="category in categories" :key="category" type="button" :aria-pressed="widgetCategory === category" @click="widgetCategory = category">{{ category }}</button></div><p class="studio-hint">Local tools work now. App cards open apps. Android providers use the native host with Android approval; connected service concepts remain separate.</p>
          <section v-if="widgetType === 'Android widgets' || widgetType === 'All types'" class="native-library" aria-label="Installed Android widget providers"><div class="native-library-heading"><strong>Installed Android widgets</strong><button type="button" :disabled="native.busy.value || native.status.value === 'loading' || !native.supported" @click="checkNative(true)">Refresh providers</button></div><p v-if="!native.supported" class="studio-hint">Available only in the native Android app, not in this browser or desktop build.</p><p v-else-if="native.status.value === 'unsupported'" class="studio-hint">This Android build does not expose the widget host.</p><p v-else-if="native.status.value === 'loading'" role="status">Checking Android providers…</p><p v-else-if="native.status.value === 'ready' && !native.providers.value.length" class="studio-hint">No installed widget providers were found. Install a widget-capable app, then refresh.</p><p v-if="native.error.value" class="studio-hint" role="status">{{ native.error.value }}</p><p class="studio-hint">Android RemoteViews keep their provider theme, not the Home theme. Layout and Android bindings are saved separately; use Check status and Saved Android placements to reconcile interrupted setup. RemoteViews interactions belong to each provider. Android may ask you to allow or configure a widget. One setup at a time; no automatic retry after a timeout.</p><div class="picker-list"><article v-for="provider in filteredNativeProviders" :key="provider.provider"><AppIcon name="solar:widget-bold" :size="23" /><span><strong>{{ provider.label }}</strong><small>Minimum {{ Math.ceil(provider.minWidthDp) }} × {{ Math.ceil(provider.minHeightDp) }} dp · {{ provider.configurable ? 'configuration supported' : 'provider-managed' }}</small></span><button type="button" :aria-label="`Add Android widget ${provider.label}`" :disabled="native.busy.value || native.status.value !== 'ready' || nativePending || activePage.items.length >= MAX_ITEMS_PER_WORKSPACE" @click="addNative(provider)">+</button></article></div><div v-if="native.records.value.length" class="native-saved"><h3>Saved Android placements</h3><article v-for="record in native.records.value" :key="record.appWidgetId"><span><strong>{{ nativeLabel(record.provider) }}</strong><small>{{ record.state }}{{ record.state === 'ready' && !record.providerAvailable ? ' · provider unavailable' : '' }}</small></span><button v-if="!placementExists(record.placementId)" type="button" :disabled="native.busy.value" @click="restoreNative(record)">Restore here</button><button type="button" :disabled="native.busy.value" @click="removeNativeRecord(record)">{{ record.state === 'ready' ? 'Remove' : 'Cancel setup' }}</button></article></div></section><div class="picker-list widget-library"><article v-for="widget in pickerWidgets" :key="widget.id"><AppIcon :name="widget.icon" :size="23" /><span><strong>{{ widget.title }}</strong><small>{{ widget.description }}</small><em>{{ widget.kind === 'local' ? 'On-device · ready' : widget.kind === 'app-link' ? 'App shortcut · ready' : widget.kind === 'native' ? 'Reference · find installed providers above' : 'Concept · not connected' }}</em><a v-if="widget.sourceUrl" :href="widget.sourceUrl" target="_blank" rel="noopener noreferrer">Inspiration ↗</a></span><button type="button" :aria-label="`Add ${widget.title} widget`" :disabled="!widgetReady(widget) || hasItem('widget', widget.id)" @click="add('widget', widget.id)">{{ hasItem('widget', widget.id) ? 'Added' : widgetReady(widget) ? '+' : 'Later' }}</button></article><p v-if="!pickerWidgets.length">No matching widgets.</p></div></template>

        <p class="picker-feedback" role="status">{{ message }}</p>
      </section>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import HomeLocalWidget from '@/components/HomeLocalWidget.vue'
import HomeDefaultRoleAction from '@/components/HomeDefaultRoleAction.vue'
import HomeWorkspacePreview from '@/components/HomeWorkspacePreview.vue'
import { useMotion } from '@/composables/useMotion'
import { useHomeEmptyPress } from '@/composables/useHomeEmptyPress'
import { useHomeTouchSafety } from '@/composables/useHomeTouchSafety'
import { useAndroidApps } from '@/composables/useAndroidApps'
import { useHomeNativeWidgets } from '@/composables/useHomeNativeWidgets'
import { widgetConfirmation, type NativeWidgetProvider, type NativeWidgetRecord } from '@/composables/useAndroidWidgets'
import { homeWidgetCatalog } from '@/data/homeWidgetCatalog'
import { HOME_WORKSPACE_KEY, MAX_ITEMS_PER_WORKSPACE, MAX_WORKSPACES, normalizeHomeState, createHomeWorkspace, addHomeItem, moveHomeItem, removeHomeItem, classifyHomeGesture, type HomeItem } from '@/utils/homeWorkspaces'
type HomeApp = { id: string; label: string; icon: string; image?: string }
const props = defineProps<{ apps: HomeApp[]; initialIds: string[]; blocked?: boolean }>()
const emit = defineEmits<{ open: [id: string]; customize: [id: string] }>()
const androidApps = useAndroidApps()
const motion = useMotion()
const message = ref('')
const suspendError = ref('')
function load() { try { return JSON.parse(localStorage.getItem(HOME_WORKSPACE_KEY) || 'null') } catch { return null } }
const state = ref(normalizeHomeState(load(), props.initialIds))
const overview = ref(false), editing = ref(false), zoom = ref(1), panX = ref(0), panY = ref(0)
const screenMotion = ref<'next' | 'previous' | null>(null)
let screenMotionTimer: ReturnType<typeof setTimeout> | null = null
const root = ref<HTMLElement>(), dialog = ref<HTMLElement>(), addButton = ref<HTMLButtonElement>(), overviewButton = ref<HTMLButtonElement>()
const activeIndex = computed(() => Math.max(0, state.value.pages.findIndex(p => p.id === state.value.activeId)))
const activePage = computed(() => state.value.pages[activeIndex.value]!)
const orbDirections = [
  { id: 'nw', label: 'northwest', arrow: '↖', dx: -1, dy: -1 }, { id: 'n', label: 'up', arrow: '↑', dx: 0, dy: -1 }, { id: 'ne', label: 'northeast', arrow: '↗', dx: 1, dy: -1 },
  { id: 'w', label: 'left', arrow: '←', dx: -1, dy: 0 }, { id: 'e', label: 'right', arrow: '→', dx: 1, dy: 0 },
  { id: 'sw', label: 'southwest', arrow: '↙', dx: -1, dy: 1 }, { id: 's', label: 'down', arrow: '↓', dx: 0, dy: 1 }, { id: 'se', label: 'southeast', arrow: '↘', dx: 1, dy: 1 },
] as const
const orbActive = ref(false)
let orbStart: { x: number; y: number; pointerId: number } | null = null
// Lazily retain visited canvases: local widgets, focus timers and scroll positions survive navigation.
const visitedIds = ref(new Set([state.value.activeId]))
watch(() => state.value.activeId, id => { visitedIds.value = new Set([...visitedIds.value, id]) }, { flush: 'sync' })
const visitedPages = computed(() => state.value.pages.filter(page => visitedIds.value.has(page.id)))
const allApps = computed<HomeApp[]>(() => [...props.apps, ...androidApps.apps.value.map(a => ({ id: `android:${a.packageName}`, label: a.label, icon: 'solar:widget-bold', image: a.iconBase64 || undefined }))])
function appFor(id: string) { return allApps.value.find(a => a.id === id) }
function appImage(id: string) { return appFor(id)?.image }
function widgetFor(id: string) { return homeWidgetCatalog.find(w => w.id === id) }
function isNative(item: HomeItem) { return item.kind === 'widget' && item.ref.startsWith('native:') }
function itemTitle(item: HomeItem) { if (item.data?.label) return String(item.data.label); if (isNative(item)) return nativeLabel(nativeRecord(item)?.provider || String(item.data?.provider || '')); return item.kind === 'app' ? appFor(item.ref)?.label || 'Unavailable app' : widgetFor(item.ref)?.title || 'Unavailable widget' }
function itemIcon(item: HomeItem) { if (item.data?.icon) return String(item.data.icon); if (isNative(item)) return 'solar:widget-bold'; return (item.kind === 'app' ? appFor(item.ref)?.icon : widgetFor(item.ref)?.icon) || 'solar:widget-bold' }
watch(state, value => { try { localStorage.setItem(HOME_WORKSPACE_KEY, JSON.stringify(value)) } catch { message.value = 'Storage unavailable — changes last only for this session.' } }, { deep: true, immediate: true })
async function navigate(index: number, epoch = gestureEpoch) {
  if (props.blocked || epoch !== gestureEpoch || index < 0 || !await suspendHome() || props.blocked || epoch !== gestureEpoch) return
  if (index >= state.value.pages.length) {
    const last = state.value.pages[state.value.pages.length - 1]
    // Keep a single empty extension screen. Swiping onward from that empty
    // screen never creates a chain of blank screens.
    if (last?.items.length === 0 || !createHomeWorkspace(state.value)) return
  }
  const page = state.value.pages[index]
  if (page && page.id !== state.value.activeId) {
    const direction = index > activeIndex.value ? 'next' : 'previous'
    if (!motion.reduced.value) {
      screenMotion.value = null
      if (screenMotionTimer) clearTimeout(screenMotionTimer)
      await nextTick()
      screenMotion.value = direction
      screenMotionTimer = setTimeout(() => { screenMotion.value = null; screenMotionTimer = null }, 320)
    }
    state.value.activeId = page.id
    message.value = ''
  }
}
function orbStep(dx: number, dy: number) { return Math.abs(dx) >= Math.abs(dy) && dx !== 0 ? (dx < 0 ? 1 : -1) : dy < 0 ? 1 : -1 }
function orbCanNavigate(dx: number, dy: number) { const step = orbStep(dx, dy); return !props.blocked && !editing.value && !picker.value && !overview.value && activeIndex.value + step >= 0 && activeIndex.value + step < state.value.pages.length }
function navigateOrb(dx: number, dy: number) { if (!orbCanNavigate(dx, dy)) return; void navigate(activeIndex.value + orbStep(dx, dy)) }
function orbPointerDown(event: PointerEvent) {
  if (!(event.target as HTMLElement).closest('.orb-core') || !event.isPrimary || event.button !== 0) return
  orbStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
  orbActive.value = true
  clearOrbLight(event.currentTarget as HTMLElement)
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function orbPointerMove(event: PointerEvent) {
  if (!orbStart || event.pointerId !== orbStart.pointerId) return
  const light = event.currentTarget as HTMLElement
  const x = Math.max(-18, Math.min(18, event.clientX - orbStart.x)) * .35
  const y = Math.max(-18, Math.min(18, event.clientY - orbStart.y)) * .35
  light.style.setProperty('--orb-x', `${x.toFixed(1)}px`)
  light.style.setProperty('--orb-y', `${y.toFixed(1)}px`)
}
function orbPointerEnd(event: PointerEvent) {
  if (!orbStart || event.pointerId !== orbStart.pointerId) return
  const dx = event.clientX - orbStart.x, dy = event.clientY - orbStart.y
  const moved = Math.hypot(dx, dy) >= 14
  orbStart = null; orbActive.value = false; clearOrbLight(event.currentTarget as HTMLElement)
  if (moved && Math.max(Math.abs(dx), Math.abs(dy)) >= 14) navigateOrb(dx, dy)
}
function clearOrbLight(element: HTMLElement) { element.style.removeProperty('--orb-x'); element.style.removeProperty('--orb-y') }
function orbPointerCancel(event: PointerEvent) { orbStart = null; orbActive.value = false; clearOrbLight(event.currentTarget as HTMLElement) }
function orbPointerLeave(event: PointerEvent) { if (!orbStart) clearOrbLight(event.currentTarget as HTMLElement) }
async function launch(id: string) { const epoch = gestureEpoch; if (props.blocked || !await suspendHome('Could not safely hide native widgets. Unlock and return to this app, then try again. No app was opened.') || props.blocked || epoch !== gestureEpoch) return; if (id.startsWith('android:')) { try { await androidApps.openApp(id.slice(8)) } catch { message.value = 'This Android app is unavailable. Try refreshing All apps.' } } else if (props.apps.some(app => app.id === id)) emit('open', id); else message.value = 'This app is unavailable. Open All apps to choose another.' }
async function customize(id: string) { if (props.blocked || !await suspendHome()) return; if (!id.startsWith('android:')) emit('customize', id); else message.value = 'Customize Android apps in All apps.' }
function hasItem(kind: HomeItem['kind'], id: string) { return activePage.value.items.some(i => i.kind === kind && i.ref === id) }
function add(kind: HomeItem['kind'], id: string) { const item = { id: globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, ref: id }; if (hasItem(kind, id)) return; message.value = addHomeItem(state.value, activePage.value.id, item) ? 'Added to this screen.' : `This screen is full (${MAX_ITEMS_PER_WORKSPACE} items). Choose another screen.` }
async function removeItem(item: HomeItem) { if (isNative(item)) { await removeNative(item); return } removeHomeItem(state.value, activePage.value.id, item.id); message.value = 'Removed from this screen.' }
async function moveItem(item: HomeItem, target: string) { if (!await suspendHome()) return; message.value = moveHomeItem(state.value, item.id, activePage.value.id, target) ? 'Moved to screen.' : 'Could not move: destination is full or already contains this item.' }
const appMenu = ref<{ item: HomeItem; pageId: string; x: number; y: number } | null>(null)
const pressItem = ref<{ item: HomeItem; pageId: string; x: number; y: number; pointerId: number } | null>(null)
const appDrag = ref<{ id: string; pageId: string; x: number; y: number } | null>(null)
let appPressTimer: ReturnType<typeof setTimeout> | null = null, suppressAppClick = false
function appPointerDown(event: PointerEvent, item: HomeItem, pageId: string) { if (!event.isPrimary || event.button !== 0 || editing.value || props.blocked) return; cancelAppGesture(); pressItem.value = { item, pageId, x: event.clientX, y: event.clientY, pointerId: event.pointerId }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); appPressTimer = setTimeout(() => { if (!pressItem.value) return; suppressAppClick = true; openAppMenu(item, pageId, event.clientX, event.clientY); pressItem.value = null }, 520) }
function appPointerMove(event: PointerEvent) { if (pressItem.value && event.pointerId === pressItem.value.pointerId && Math.hypot(event.clientX - pressItem.value.x, event.clientY - pressItem.value.y) > 12) { const press = pressItem.value; if (appPressTimer) clearTimeout(appPressTimer); appPressTimer = null; pressItem.value = null; suppressAppClick = true; appDrag.value = { id: press.item.id, pageId: press.pageId, x: press.x, y: press.y }; return } if (appMenu.value && appMenu.value.item.id === (event.currentTarget as HTMLElement).dataset.itemId && Math.hypot(event.movementX, event.movementY) > 12) { const menu = appMenu.value; closeAppMenu(); appDrag.value = { id: menu.item.id, pageId: menu.pageId, x: event.clientX, y: event.clientY } } }
function appPointerUp(event: PointerEvent, item: HomeItem, pageId: string) { if (appPressTimer) clearTimeout(appPressTimer); appPressTimer = null; if (pressItem.value?.pointerId === event.pointerId) { pressItem.value = null; return } if (!appDrag.value || appDrag.value.id !== item.id) return; const drag = appDrag.value; appDrag.value = null; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.workspace-app')?.querySelector<HTMLElement>('.workspace-launch'); const targetId = target?.dataset.itemId; const targetItem = activePage.value.items.find(candidate => candidate.id === targetId); const from = state.value.pages.find(p => p.id === drag.pageId); if (from && targetItem && targetItem.id !== item.id) { const sourceIndex = from.items.findIndex(candidate => candidate.id === item.id), targetIndex = from.items.findIndex(candidate => candidate.id === targetItem.id); if (sourceIndex >= 0 && targetIndex >= 0) { const [moving] = from.items.splice(sourceIndex, 1); from.items.splice(targetIndex, 0, moving!) } } setTimeout(() => { suppressAppClick = false }, 0) }
function cancelAppGesture() { if (appPressTimer) clearTimeout(appPressTimer); appPressTimer = null; pressItem.value = null; appDrag.value = null }
function appClick(item: HomeItem) { if (suppressAppClick) { suppressAppClick = false; return } if (editing.value) void customize(item.ref); else void launch(item.ref) }
function openAppMenu(item: HomeItem, pageId: string, x: number, y: number) { const width = 240, height = 330; appMenu.value = { item, pageId, x: Math.max(12, Math.min(x, window.innerWidth - width - 12)), y: Math.max(12, Math.min(y, window.innerHeight - height - 12)) }; if (!item.data) item.data = {} }
function closeAppMenu() { appMenu.value = null }
function runMenuAction(action: 'open' | 'customize') { const id = appMenu.value?.item.ref; closeAppMenu(); if (id) { if (action === 'open') void launch(id); else void customize(id) } }
function saveAppRename() { message.value = 'App name updated.' }
function moveFromMenu(target: string) { const menu = appMenu.value; if (!menu) return; const from = state.value.pages.find(p => p.id === menu.pageId); if (from && moveHomeItem(state.value, menu.item.id, menu.pageId, target)) message.value = 'App moved to screen.'; else message.value = 'Could not move app to that screen.'; closeAppMenu() }
function removeFromMenu() { const menu = appMenu.value; if (!menu) return; removeHomeItem(state.value, menu.pageId, menu.item.id); message.value = 'App removed from this screen.'; closeAppMenu() }
const picker = ref<'apps' | 'widgets' | null>(null), pickerQuery = ref(''), widgetCategory = ref('All'), widgetType = ref('All types')
const nativeHome = useHomeNativeWidgets(root, state, () => overview.value || editing.value || !!picker.value || !!props.blocked)
const native = nativeHome.bridge
async function suspendHome(failureMessage = 'Could not safely hide native widgets. Unlock and return to this app, then try again.') {
  // Keep the live region mounted and empty for a beat so identical failures
  // from consecutive, explicit user retries are announced again.
  suspendError.value = ''
  await nextTick()
  try {
    const ok = await nativeHome.suspend()
    if (ok) suspendError.value = ''
    else suspendError.value = failureMessage
    return ok
  } catch {
    suspendError.value = failureMessage
    return false
  }
}
let previousFocus: HTMLElement | null = null
async function openPicker(tab: 'apps' | 'widgets') { if (props.blocked) return; previousFocus = document.activeElement as HTMLElement; if (!await suspendHome()) return; picker.value = tab; pickerQuery.value = ''; message.value = ''; if (androidApps.supported) void androidApps.refresh().catch(() => {}); await nextTick(); dialog.value?.focus() }
async function closePicker() { picker.value = null; await nextTick(); if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus(); else addButton.value?.focus() }
function dialogKeys(event: KeyboardEvent) { if (event.key === 'Escape') { event.stopPropagation(); closePicker(); return } if (event.key !== 'Tab') return; const nodes = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]') || []); const first = nodes[0], last = nodes[nodes.length - 1]; if (!first || !last) return; if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last.focus() } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first.focus() } }
const pickerApps = computed(() => allApps.value.filter(a => a.label.toLowerCase().includes(pickerQuery.value.toLowerCase())))
const filteredNativeProviders = computed(() => native.providers.value.filter(p => p.label.toLowerCase().includes(pickerQuery.value.toLowerCase())))
const nativePending = computed(() => native.records.value.some(r => r.state !== 'ready'))
const categories = computed(() => ['All', ...new Set(homeWidgetCatalog.map(w => w.category))])
const pickerWidgets = computed(() => homeWidgetCatalog.filter(w => (widgetType.value === 'All types' || widgetType.value === 'CyberManju' && ['local', 'app-link'].includes(w.kind) || widgetType.value === 'Android widgets' && w.kind === 'native' || widgetType.value === 'Service concepts' && w.kind === 'concept') && (widgetCategory.value === 'All' || w.category === widgetCategory.value) && `${w.title} ${w.description}`.toLowerCase().includes(pickerQuery.value.toLowerCase())))
function widgetReady(widget: typeof homeWidgetCatalog[number]) { return ['clock', 'notes', 'counter', 'pixel-pet', 'focus', 'checklist'].includes(widget.id) && widget.kind === 'local' || widget.kind === 'app-link' && !!widget.appId && props.apps.some(a => a.id === widget.appId) }
const emptyPress = useHomeEmptyPress(() => { void openPicker('apps') }, () => !props.blocked && !picker.value && !overview.value)
function workspaceKeys(event: KeyboardEvent) {
  if (props.blocked || picker.value || event.isComposing || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable],.workspace-widget')) return
  if (event.key === 'Escape') { if (editing.value || overview.value) { event.preventDefault(); event.stopPropagation() }; editing.value = false; if (overview.value) void closeOverview(); return }
  if (event.altKey && event.key.toLowerCase() === 'o') { event.preventDefault(); event.stopPropagation(); void toggleOverview(); return }
  if ((event.target as HTMLElement).closest('button,a')) return
  if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); void openPicker('apps'); return }
  if (overview.value || editing.value || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
  const index = ['ArrowRight', 'ArrowDown'].includes(event.key) ? activeIndex.value + 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? activeIndex.value - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? state.value.pages.length - 1 : null
  if (index !== null) { event.preventDefault(); event.stopPropagation(); void navigate(index) }
}
async function closeOverview() { if (!await suspendHome()) return; overview.value = false; resetTouch(); await nextTick(); overviewButton.value?.focus({ preventScroll: true }) }
async function selectScreen(index: number) { if (props.blocked || !await suspendHome()) return; await navigate(index); await closeOverview() }

const dragging = ref<{ id: string; from: string; x: number; y: number } | null>(null)
function beginDrag(event: PointerEvent, item: HomeItem, from: string) { if (event.button !== 0 || !overview.value) return; event.stopPropagation(); dragging.value = { id: item.id, from, x: event.clientX, y: event.clientY }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }
function finishDrag(event: PointerEvent) { if (!dragging.value) return; const drag = dragging.value; dragging.value = null; if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 12) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId; if (target && target !== drag.from) message.value = moveHomeItem(state.value, drag.id, drag.from, target) ? 'Tile moved.' : 'Destination is full or already contains this item.' }
let gesture: { x: number; y: number; fingers: number; lastX: number; lastY: number; distance: number; zoom: number; panX: number; panY: number; hidden: Promise<boolean>; ready: boolean; epoch: number; inOverview: boolean; moved: boolean; releasing: boolean; contacts: { id: number; x: number; y: number }[] } | null = null
const touchSafety = useHomeTouchSafety()
function homeClick(event: MouseEvent) { touchSafety.click(event); if (!event.defaultPrevented) emptyPress.click(event) }
let gestureEpoch = 0, touchCount = 0, touchBlocked = false
function center(touches: TouchList) { const points = Array.from(touches); return { x: points.reduce((a, p) => a + p.clientX, 0) / points.length, y: points.reduce((a, p) => a + p.clientY, 0) / points.length } }
function distance(touches: TouchList) { return touches.length >= 2 ? Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY) : 0 }
function excludedTouchTarget(target: EventTarget | null) { return (target as HTMLElement | null)?.closest?.('button,a,input,textarea,select,[contenteditable],[role="button"],.workspace-app,.workspace-widget,[data-native-placement],.studio-picker,.orb-navigator') }
function touchStart(event: TouchEvent) {
  touchSafety.start(event)
  // A sequence ends only after all contacts lift; never re-enroll an invalid sequence.
  const starting = touchCount === 0
  touchCount = event.touches.length
  if (starting) { gestureEpoch++; gesture = null }
  // Pointerdown precedes touchstart. A tile drag already has a Pointer owner;
  // do not erase it just because its corresponding touch event arrives.
  if (dragging.value) {
    resetTouch(touchCount !== 1 || !!props.blocked || editing.value || !!picker.value)
    return
  }
  if (touchBlocked) return
  if (props.blocked || editing.value || picker.value || dragging.value || ![1, 2, 3].includes(touchCount)) { resetTouch(); return }
  if (excludedTouchTarget(event.target) || Array.from(event.touches).some(p => excludedTouchTarget(p.target))) { resetTouch(); return }
  // Home owns the full mobile canvas, including top and side edge starts.
  // Do not exclude system-edge bands here: that made directional navigation
  // impossible when a swipe began near the bezel.
  // Allow 1 -> 2 -> 3 initial formation, but a count change after movement cancels everything.
  if (gesture && (gesture.releasing || gesture.moved || touchCount <= gesture.fingers)) { resetTouch(); return }
  if (touchCount === 1 && ((event.target as HTMLElement).closest('button,a') || overview.value)) return
  const point = center(event.touches)
  // The launcher reserves the top and bottom edge bands for search and the
  // app drawer. Do not let Home also page when either system gesture starts.
  if (touchCount === 1 && (point.y <= 140 || point.y >= window.innerHeight - 140)) return
  const current = { ...point, fingers: touchCount, lastX: point.x, lastY: point.y, distance: distance(event.touches), zoom: zoom.value, panX: panX.value, panY: panY.value, hidden: gesture?.hidden ?? suspendHome(), ready: false, epoch: gestureEpoch, inOverview: overview.value, moved: false, releasing: false, contacts: Array.from(event.touches, p => ({ id: p.identifier, x: p.clientX, y: p.clientY })) }
  gesture = current
  void current.hidden.then(ok => { if (gesture !== current || current.epoch !== gestureEpoch) return; current.ready = ok; if (!ok) resetTouch() })
}
function touchMove(event: TouchEvent) {
  touchSafety.move(event)
  touchCount = event.touches.length
  if (dragging.value) { if (touchCount !== 1) resetTouch(); return }
  if (touchBlocked) return
  if (props.blocked || !gesture || picker.value || editing.value) { resetTouch(); return }
  if (gesture.releasing || dragging.value || touchCount !== gesture.fingers || Array.from(event.touches).some(p => !gesture!.contacts.some(c => c.id === p.identifier))) { resetTouch(); return }
  const point = center(event.touches)
  gesture.lastX = point.x; gesture.lastY = point.y
  gesture.moved ||= Math.hypot(point.x - gesture.x, point.y - gesture.y) > 10
  gesture.contacts = Array.from(event.touches, p => ({ id: p.identifier, x: p.clientX, y: p.clientY }))
  // Claim only safe multi-contact sequences, even while native hide is pending.
  // Do not mistake the leading finger of a parallel swipe for a transient pinch.
  if (gesture.fingers >= 2 && event.cancelable) event.preventDefault()
  if (gesture.fingers === 2 && overview.value && gesture.ready) {
    if (event.cancelable) event.preventDefault()
    zoom.value = Math.max(.65, Math.min(1.4, gesture.zoom * distance(event.touches) / Math.max(1, gesture.distance)))
    panX.value = Math.max(-300, Math.min(300, gesture.panX + point.x - gesture.x))
    panY.value = Math.max(-300, Math.min(300, gesture.panY + point.y - gesture.y))
  } else if (gesture.ready && classifyHomeGesture(point.x - gesture.x, point.y - gesture.y, gesture.fingers) && event.cancelable) event.preventDefault()
}
function currentGesture(current: NonNullable<typeof gesture>) { return current.epoch === gestureEpoch && !props.blocked && !picker.value && !editing.value && !dragging.value }
async function touchEnd(event: TouchEvent) {
  touchSafety.end(event)
  touchCount = event.touches.length
  if (gesture?.releasing && [...Array.from(event.touches), ...Array.from(event.changedTouches || [])].some(point => {
    const contact = gesture!.contacts.find(c => c.id === point.identifier)
    return !contact || Math.hypot(point.clientX - contact.x, point.clientY - contact.y) > 10
  })) { resetTouch(); return }
  if (gesture && !gesture.releasing) {
    // Include a coalesced final move, using stable contact identities.
    for (const point of Array.from(event.changedTouches || [])) {
      const contact = gesture.contacts.find(c => c.id === point.identifier)
      if (!contact) { resetTouch(); return }
      contact.x = point.clientX; contact.y = point.clientY
    }
    gesture.lastX = gesture.contacts.reduce((sum, c) => sum + c.x, 0) / gesture.fingers
    gesture.lastY = gesture.contacts.reduce((sum, c) => sum + c.y, 0) / gesture.fingers
    const [a, b] = gesture.contacts
    if (gesture.fingers === 2 && !gesture.inOverview && Math.abs(Math.hypot(a!.x - b!.x, a!.y - b!.y) - gesture.distance) > Math.max(24, gesture.distance * .15)) { resetTouch(); return }
  }
  if (touchCount) {
    // Real fingers lift separately. Freeze an already-qualified swipe until all
    // contacts lift; movement, re-addition or cancel during this phase aborts it.
    if (!gesture || !classifyHomeGesture(gesture.lastX - gesture.x, gesture.lastY - gesture.y, gesture.fingers) || Array.from(event.touches).some(p => !gesture!.contacts.some(c => c.id === p.identifier))) { resetTouch(); return }
    gesture.releasing = true
    return
  }
  touchBlocked = false
  const current = gesture
  gesture = null
  if (!current || !await current.hidden || !currentGesture(current) || current.inOverview !== overview.value) return
  if (current.fingers === 2 && current.inOverview) { nativeHome.schedule(); return }
  const action = classifyHomeGesture(current.lastX - current.x, current.lastY - current.y, current.fingers)
  if (action === 'overview-open') {
    if (!await suspendHome() || !currentGesture(current)) return
    overview.value = true
  }
  if (action === 'overview-close') overview.value = false
  if (!overview.value && action === 'next') await navigate(activeIndex.value + 1, current.epoch)
  if (!overview.value && action === 'previous') await navigate(activeIndex.value - 1, current.epoch)
  if (!currentGesture(current)) return
  dragging.value = null
  nativeHome.schedule()
}
function cancelTouch(event: TouchEvent) { touchSafety.cancel(event); touchCount = event.touches.length; resetTouch() }
function resetTouch(cancelDrag = true) { gestureEpoch++; gesture = null; if (cancelDrag) dragging.value = null; touchBlocked = touchCount > 0 }
function invalidateTouch() { touchSafety.cancel(); resetTouch() }
function importHomeState() { state.value = normalizeHomeState(load(), props.initialIds); overview.value = false; editing.value = false }
onMounted(() => { window.addEventListener('blur', invalidateTouch); document.addEventListener('visibilitychange', invalidateTouch); window.addEventListener('cybermanju:home-workspaces-import', importHomeState); if (androidApps.supported) void androidApps.refresh().catch(() => {}) })
function removeApp(id: string) { for (const page of state.value.pages) { const item = page.items.find(i => i.kind === 'app' && i.ref === id); if (item) removeHomeItem(state.value, page.id, item.id) } }
function reorderApp(id: string, direction: -1 | 1) { const items = activePage.value.items; const from = items.findIndex(i => i.kind === 'app' && i.ref === id); const target = from + direction; if (from < 0 || target < 0 || target >= items.length) return; const [item] = items.splice(from, 1); items.splice(target, 0, item!) }
async function newScreen() { if (!await suspendHome()) return; const hadEmptyExtension = state.value.pages[state.value.pages.length - 1]?.items.length === 0; message.value = createHomeWorkspace(state.value) ? (hadEmptyExtension ? 'Opened the empty screen.' : 'New screen saved on this device.') : '24-screen limit reached.'; overview.value = false }
async function toggleOverview() { resetTouch(); if (props.blocked || !await suspendHome()) return; if (overview.value) await closeOverview(); else { editing.value = false; overview.value = true } }
async function toggleEditing() { if (await suspendHome()) { overview.value = false; editing.value = !editing.value } }
function nativeLabel(provider: string) { return native.providers.value.find(p => p.provider === provider)?.label || 'Android widget' }
function nativeRecord(item: HomeItem) { return native.records.value.find(r => r.placementId === item.id) }
function nativeState(item: HomeItem) { const record = nativeRecord(item); if (!native.supported) return 'Native Android app required.'; if (native.status.value === 'unsupported') return 'Widget host unavailable in this build.'; if (!record) return 'No saved binding found. Check status; remove this placeholder if setup was denied.'; if (record.state !== 'ready') return `${record.state === 'binding' ? 'Waiting for Android approval' : 'Waiting for provider configuration'} — finish or cancel setup.`; return record.providerAvailable ? 'Ready · native interaction when fully visible and settled.' : 'Provider unavailable. Reinstall the provider or remove this placement.' }
function nativeMinimum(item: HomeItem) { return Math.ceil(native.providers.value.find(p => p.provider === (nativeRecord(item)?.provider || item.data?.provider))?.minHeightDp || 1) }
function nativeHeight(item: HomeItem) { const ratio = native.viewport.value ? native.viewport.value.heightDp / innerHeight : 1; const height = Number(item.data?.heightDp || nativeMinimum(item)); return Math.max(1, (Number.isFinite(height) ? height : nativeMinimum(item)) / Math.max(.1, ratio)) }
function nativeMinWidth(item: HomeItem) { return Math.max(1, Math.ceil(native.providers.value.find(p => p.provider === (nativeRecord(item)?.provider || item.data?.provider))?.minWidthDp || 1)) }
function nativeWidth(item: HomeItem) { const width = Number(item.data?.widthDp); const ratio = native.viewport.value ? native.viewport.value.widthDp / innerWidth : 1; return Number.isFinite(width) && width > 0 ? `${width / Math.max(.1, ratio)}px` : '100%' }
function resizeNativeWidth(item: HomeItem, value: string) { const width = Number(value); if (!Number.isFinite(width)) return; item.data = { ...item.data, widthDp: Math.max(nativeMinWidth(item), Math.min(640, width)) }; nativeHome.schedule() }
function resizeNative(item: HomeItem, value: string) { const height = Number(value); if (!Number.isFinite(height)) return; item.data = { ...item.data, heightDp: Math.max(nativeMinimum(item), Math.min(640, height)) }; nativeHome.schedule() }
function placementExists(id: string) { return state.value.pages.some(p => p.items.some(i => i.id === id)) }
async function checkNative(includeProviders: boolean | Event = false) { if (!await suspendHome()) return; await native.refresh(includeProviders === true); nativeHome.schedule(true) }
async function addNative(provider: NativeWidgetProvider) {
  const confirmation = widgetConfirmation()
  if (native.busy.value || nativePending.value || native.status.value !== 'ready') return
  const id = globalThis.crypto?.randomUUID?.() || `native-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const item: HomeItem = { id, kind: 'widget', ref: `native:${id}`, data: { provider: provider.provider, label: provider.label.slice(0, 200), heightDp: Math.max(1, Math.ceil(provider.minHeightDp)), widthDp: Math.max(1, Math.ceil(provider.minWidthDp)) } }
  if (!addHomeItem(state.value, activePage.value.id, item)) { message.value = 'This screen is full.'; return }
  const ok = await native.mutate('add', { provider: provider.provider, placementId: id }, confirmation)
  message.value = ok ? 'Android setup started. Complete approval/configuration, then check status.' : 'Setup result needs review. Check saved placements; no add was repeated.'
}
async function configureNative(item: HomeItem) { const confirmation = widgetConfirmation(), record = nativeRecord(item); if (!record || !await suspendHome()) return; await native.mutate('configure', { appWidgetId: record.appWidgetId }, confirmation); nativeHome.schedule(true) }
async function removeNative(item: HomeItem, cancel = false) {
  const confirmation = widgetConfirmation()
  if (!await suspendHome() || !await native.refresh()) return
  const record = nativeRecord(item)
  if (record) { await native.mutate(cancel || record.state !== 'ready' ? 'cancel' : 'remove', { appWidgetId: record.appWidgetId }, confirmation); if (native.records.value.some(r => r.placementId === item.id)) { message.value = 'Placement remains saved. Check status before another action.'; return } }
  for (const page of state.value.pages) removeHomeItem(state.value, page.id, item.id)
  message.value = 'Android placement removed.'
}
async function removeNativeRecord(record: NativeWidgetRecord) { const confirmation = widgetConfirmation(); if (!await suspendHome()) return; await native.mutate(record.state === 'ready' ? 'remove' : 'cancel', { appWidgetId: record.appWidgetId }, confirmation); if (!native.records.value.some(r => r.placementId === record.placementId)) for (const page of state.value.pages) removeHomeItem(state.value, page.id, record.placementId) }
function restoreNative(record: NativeWidgetRecord) { const item: HomeItem = { id: record.placementId, kind: 'widget', ref: `native:${record.placementId}`, data: { provider: record.provider, label: nativeLabel(record.provider).slice(0, 200), heightDp: Math.max(1, record.heightDp || 180), widthDp: Math.max(1, record.widthDp || 280) } }; message.value = addHomeItem(state.value, activePage.value.id, item) ? 'Saved placement restored to this screen.' : 'Cannot restore: this screen is full or placement already exists.' }
async function editScreen() { if (await suspendHome()) editing.value = true }
defineExpose({ removeApp, reorderApp, hideNative: suspendHome, editScreen })
watch(() => [props.blocked, picker.value, editing.value], () => invalidateTouch(), { flush: 'sync' })
onUnmounted(() => { if (screenMotionTimer) clearTimeout(screenMotionTimer); window.removeEventListener('blur', invalidateTouch); document.removeEventListener('visibilitychange', invalidateTouch); window.removeEventListener('cybermanju:home-workspaces-import', importHomeState); invalidateTouch() })
</script>
<style scoped>
.home-studio { --hw-bg: var(--ui-bg); --hw-surface: var(--ui-surface); --hw-text: var(--ui-text); --hw-muted: var(--ui-text-3); --hw-accent: var(--ui-accent); --hw-line: var(--ui-border); color: var(--hw-text); background: transparent; border: 0; border-radius: 0; padding: 8px 0 0; width: 100%; height: 100%; min-width: 0; min-height: 0; position: relative; flex: 1 1 0; display: flex; flex-direction: column; box-sizing: border-box; }
.studio-surface { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; overscroll-behavior: contain; }
.is-editing .workspace-content { flex: 1 0 180px; }
.studio-heading, .screen-tools, .screen-nav, .studio-status, .gesture-hint, .screen-name, .overview-bar { flex-shrink: 0; }
.studio-status:empty { display: none; }
.workspace-content { flex: 1 1 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.workspace-apps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-content: start; gap: 10px 4px; }
.grid-control { display: inline-flex; align-items: center; gap: 5px; color: var(--hw-muted); font-size: 11px; }.grid-control select { min-height: 38px; border: 1px solid var(--hw-line); border-radius: 9px; color: var(--hw-text); background: var(--hw-surface); }
.workspace-app { min-width: 0; position: relative; }
.workspace-launch { width: 100%; min-width: 0; min-height: 84px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 6px; padding: 5px 3px; border: 0; border-radius: 14px; color: var(--hw-text); background: transparent; text-align: center; overflow: hidden; -webkit-tap-highlight-color: transparent; }
.workspace-launch { touch-action: none; transition: transform .18s cubic-bezier(.2,.8,.2,1), filter .18s ease; }.app-pressed .workspace-launch { transform: scale(.92); filter: brightness(1.18); }.app-dragging .workspace-launch { transform: scale(1.12) rotate(-3deg); filter: drop-shadow(0 14px 18px #0008); z-index: 3; }
.workspace-app-icon { width: 52px; height: 52px; flex: 0 0 auto; display: grid; place-items: center; overflow: hidden; border: 1px solid var(--hw-line); border-radius: 16px; color: var(--hw-accent); background: var(--hw-surface); }
.workspace-app-icon img { display: block; width: 100%; height: 100%; object-fit: cover; }
.workspace-launch>span:last-child { display: block; width: 100%; overflow: hidden; color: var(--hw-text); font-size: 11px; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
.app-menu-backdrop { position: fixed; inset: 0; z-index: 12000; background: transparent; }.app-menu { position: fixed; width: min(240px, calc(100vw - 24px)); max-height: min(420px, calc(100dvh - 24px)); overflow: auto; padding: 10px; border: 1px solid color-mix(in srgb, var(--ui-border) 68%, white); border-radius: 22px; color: var(--ui-text); background: color-mix(in srgb, var(--ui-surface) 76%, transparent); backdrop-filter: blur(26px) saturate(1.5); -webkit-backdrop-filter: blur(26px) saturate(1.5); box-shadow: 0 18px 60px #0006, inset 0 1px #ffffff36; transform-origin: top left; animation: app-menu-in .2s cubic-bezier(.2,.8,.2,1) both; }.app-menu button,.app-menu-rename { display: flex; width: 100%; min-height: 42px; align-items: center; gap: 10px; padding: 9px 11px; border: 0; border-radius: 12px; color: inherit; background: transparent; text-align: left; font-size: 13px; }.app-menu button:active { background: color-mix(in srgb, var(--ui-accent) 22%, transparent); transform: scale(.98); }.app-menu-heading { display: flex; align-items: center; gap: 10px; padding: 4px 4px 10px; border-bottom: 1px solid var(--ui-border); margin-bottom: 5px; }.app-menu-heading strong { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.app-menu-heading button { width: 38px; min-height: 38px; justify-content: center; font-size: 22px; }.app-menu-rename { display: grid; grid-template-columns: 1fr; gap: 5px; color: var(--ui-text-2); }.app-menu-rename input { width: 100%; min-height: 36px; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--ui-border); border-radius: 10px; color: var(--ui-text); background: color-mix(in srgb, var(--ui-bg) 70%, transparent); }.app-menu-move { display: grid; gap: 2px; padding-top: 6px; border-top: 1px solid var(--ui-border); }.app-menu-move>span { padding: 5px 10px; color: var(--ui-text-2); font-size: 11px; }.app-menu-move button { min-height: 36px; padding-left: 18px; }.app-menu-remove { color: #ff7878 !important; border-top: 1px solid var(--ui-border) !important; margin-top: 4px; }@keyframes app-menu-in { from { opacity: 0; transform: translateY(8px) scale(.96); } to { opacity: 1; transform: none; } }
.workspace-widgets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 10px; }
.workspace-widget { min-width: 0; overflow: hidden; padding: 10px; border: 1px solid var(--hw-line); border-radius: 14px; color: var(--hw-text); background: var(--hw-surface); }
.workspace-widget>header { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; font-weight: 650; }
.workspace-widget>header>span { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.native-widget-slot { display: grid; place-items: center; gap: 6px; margin-top: 8px; padding: 10px; box-sizing: border-box; border: 1px dashed var(--hw-line); border-radius: 10px; color: var(--hw-muted); text-align: center; }
.native-widget-slot small { font-size: 10px; }
.native-actions,.item-edit { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.native-actions button,.item-edit button,.item-edit select { min-height: 36px; padding: 6px 8px; border: 1px solid var(--hw-line); border-radius: 8px; color: var(--hw-text); background: var(--hw-bg); font-size: 11px; }
.widget-move { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 7px; font-size: 10px; color: var(--hw-muted); }
.widget-move input,.widget-move select { width: 72px; min-height: 32px; border: 1px solid var(--hw-line); border-radius: 7px; color: var(--hw-text); background: var(--hw-bg); }
.native-suspend-alert { position: fixed; z-index: 10000; left: 16px; right: 16px; bottom: max(16px, env(safe-area-inset-bottom)); padding: 14px 16px; color: #fff; background: #8b1e1e; border: 2px solid #fff; border-radius: 10px; box-shadow: 0 4px 18px #0008; font: 600 14px/1.5 system-ui, sans-serif; }
.native-suspend-alert:not(.has-error) { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.home-studio:focus-visible, .workspace-content:focus-visible { outline: 2px solid var(--hw-accent); outline-offset: -2px; }


.home-studio button,.home-studio input,.home-studio select { font: inherit; }.home-studio button { cursor: pointer; }.home-studio button:disabled { opacity: .5; cursor: default; }.home-studio button:focus-visible,.home-studio input:focus-visible,.home-studio select:focus-visible,.home-studio textarea:focus-visible { outline: 3px solid var(--hw-accent); outline-offset: 3px; }
.studio-heading,.studio-tools,.screen-tools,.overview-bar,.screen-nav,.picker-title,.picker-tabs { display: flex; align-items: center; gap: 8px; }.studio-heading,.picker-title { justify-content: space-between; }.studio-heading h2,.picker-title h2 { font-size: 20px; margin: 5px 0 0; letter-spacing: -.04em; overflow-wrap: anywhere; }.studio-kicker { color: var(--hw-accent); font-size: 10px; letter-spacing: .16em; font-weight: 700; }.studio-status,.studio-hint { color: var(--hw-muted); font-size: 11px; line-height: 1.6; margin: 10px 0; }
.studio-tools button,.screen-tools button,.overview-bar button,.screen-nav button,.picker-title>button,.picker-tabs button,.widget-filters button { color: var(--hw-text); background: var(--hw-surface); border: 1px solid var(--hw-line); border-radius: 12px; min-width: 44px; min-height: 44px; padding: 8px 12px; }.studio-tools .studio-add { background: var(--hw-accent); color: var(--ui-on-accent); font-size: 30px; line-height: 1; border-color: transparent; }.screen-tools { justify-content: space-between; margin-bottom: 14px; }.screen-tools button { font-size: 12px; }.screen-name { display: grid; gap: 6px; margin: 10px 0; font-size: 12px; }.screen-name input { color: inherit; border: 1px solid var(--hw-line); background: var(--hw-surface); padding: 10px; border-radius: 8px; }
.screen-nav { position: relative; flex: 0 0 auto; flex-direction: column; justify-content: center; gap: 4px; margin-top: 4px; padding-bottom: 2px; }
.orb-navigator { --orb-x: 0px; --orb-y: 0px; display: grid; grid-template-columns: 42px 86px 42px; grid-template-rows: 42px 86px 42px; align-items: center; justify-items: center; touch-action: none; user-select: none; }
.orb-direction { z-index: 2; display: grid; place-items: center; min-width: 42px !important; min-height: 42px !important; padding: 0 !important; color: #f4f4f4 !important; background: #080808 !important; border: 1px solid #777 !important; border-radius: 3px !important; font: 700 17px/1 ui-monospace, monospace !important; box-shadow: inset 1px 1px #fff4, inset -2px -2px #000; }
.orb-direction:disabled { opacity: .28; }
.orb-direction:not(:disabled):active { color: #000 !important; background: #fff !important; transform: translateY(1px); }
.orb-direction:focus-visible { outline: 2px solid #fff !important; outline-offset: 2px; }
.orb-direction-nw { grid-area: 1 / 1; }.orb-direction-n { grid-area: 1 / 2; }.orb-direction-ne { grid-area: 1 / 3; }.orb-direction-w { grid-area: 2 / 1; }.orb-direction-e { grid-area: 2 / 3; }.orb-direction-sw { grid-area: 3 / 1; }.orb-direction-s { grid-area: 3 / 2; }.orb-direction-se { grid-area: 3 / 3; }
.orb-core { grid-area: 2 / 2; position: relative; width: 82px; height: 82px; display: grid; place-items: center; overflow: hidden; isolation: isolate; color: #fff; background: #050505; border: 2px solid #eee; outline: 2px solid #111; box-shadow: 0 0 0 3px #777, 0 0 22px #fff3, inset 0 0 16px #fff5; image-rendering: pixelated; touch-action: none; animation: orb-rest 5.4s ease-in-out infinite; }
.orb-art,.orb-sheen { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.orb-art { z-index: 0; }
.orb-sheen { z-index: 1; background: radial-gradient(ellipse at 50% 30%, #fff9, #fff0 28%), repeating-linear-gradient(0deg, #fff0 0 3px, #fff2 3px 4px); mix-blend-mode: screen; opacity: .76; transform: translate(var(--orb-x), var(--orb-y)); transition: transform 90ms linear, opacity 150ms ease; }
.orb-sheen::after { content: ''; position: absolute; inset: -35% -80%; background: linear-gradient(105deg, transparent 44%, #fff0 47%, #fffa 50%, #fff2 52%, transparent 57%); opacity: .55; transform: translateX(-18%); animation: orb-wet-glint 6.2s cubic-bezier(.4,0,.2,1) infinite; }
.orb-screen-count { position: relative; z-index: 2; display: flex; align-items: baseline; padding: 3px 5px; color: #fff; background: #050505df; border: 1px solid #fff9; box-shadow: 2px 2px #000; font: 800 20px/1 ui-monospace, monospace; text-shadow: 1px 1px #000; }
.orb-screen-count i { margin-left: 2px; font-size: 9px; font-style: normal; }
.orb-active .orb-core { animation-play-state: paused; box-shadow: 0 0 0 3px #fff, 0 0 25px #fff8, inset 0 0 18px #fff9; }
.orb-active .orb-sheen { opacity: 1; }
.orb-active .orb-sheen::after { animation-duration: 1.4s; opacity: .85; }
.orb-caption { color: var(--hw-muted); font: 600 8px/1.2 ui-monospace, monospace; letter-spacing: .14em; text-align: center; }
@keyframes orb-rest { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-1px) scale(1.012); } }
@keyframes orb-wet-glint { 0%,18% { transform: translateX(-18%); opacity: .2; } 55% { opacity: .72; } 82%,100% { transform: translateX(18%); opacity: .25; } }
.motion-reduced .orb-core,.motion-reduced .orb-sheen::after { animation: none !important; }
.gesture-hint { text-align: center; margin-bottom: 0; }
.empty-orbit { text-align: center; padding: 25px 6px; }.empty-orbit h3 { font-size: 17px; margin: 18px 0 8px; }.empty-orbit p { font-size: 12px; line-height: 1.7; color: var(--hw-muted); }.empty-orbit button { color: var(--ui-on-accent); background: var(--hw-accent); min-height: 44px; padding: 12px 18px; border: 0; border-radius: 12px; }
.studio-stage,.studio-home { display: flex; flex-direction: column; flex: 1; min-height: 0; }.studio-stage { position: relative; }.studio-heading>div:first-child { min-width: 0; }.studio-tools { flex-shrink: 0; }
.picker-list>button .picker-app-icon { width: 30px; height: 30px; flex: 0 0 30px; object-fit: contain; border-radius: 7px; }
.home-studio.screen-enter-next .studio-home { animation: home-screen-next 280ms var(--ui-ease-spring) both; }
.home-studio.screen-enter-previous .studio-home { animation: home-screen-previous 280ms var(--ui-ease-spring) both; }
.is-overview .studio-home { opacity: .35; pointer-events: none; user-select: none; }
.overview-surface { position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; min-height: 0; padding: 12px; border: 1px solid var(--hw-line); border-radius: 20px; background: var(--hw-bg); isolation: isolate; box-sizing: border-box; overflow: auto; }
/* One bounded blur layer intentionally opts into the global mobile no-blur policy.
   Static shader-like light field: no canvas, render loop, captures or WebGL dependency. */
.overview-surface::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; border-radius: inherit; opacity: .14; background: radial-gradient(ellipse at 5% 0%,var(--hw-accent),transparent 54%),radial-gradient(ellipse at 100% 90%,var(--hw-accent),transparent 60%); }
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .overview-surface { background: color-mix(in srgb,var(--hw-bg) 78%,transparent); backdrop-filter: blur(12px) saturate(110%) !important; -webkit-backdrop-filter: blur(12px) saturate(110%) !important; } }
@supports not (background: color-mix(in srgb,black 50%,transparent)) { .overview-surface { background: var(--hw-bg); } }
.overview-surface>.studio-hint { color: var(--ui-text-2,var(--hw-text)); }
.overview-bar { flex-wrap: wrap; font-size: 12px; }.overview-bar strong { margin-right: auto; }
.eagle-viewport { animation: eagle-open 240ms cubic-bezier(.2,.8,.2,1); flex: 1 1 120px; min-height: 80px; overflow: auto; border-radius: 12px; padding: 8px; overscroll-behavior: contain; }
.eagle-canvas { display: grid; grid-template-columns: repeat(auto-fill,minmax(min(100%,var(--overview-card-min,128px)),1fr)); align-items: start; gap: 16px; transform-origin: top left; transition: transform 180ms ease; }
.eagle-card { min-width: 0; border: 1px solid var(--hw-line); background: var(--hw-surface); border-radius: 18px; padding: 10px; box-shadow: 0 8px 25px #00000012; transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease; }.eagle-card.current { border-color: var(--hw-accent); box-shadow: 0 0 0 1px var(--hw-accent); }.eagle-card.drop-ready { border-style: dashed; }.eagle-card:focus-within { outline: 2px solid var(--hw-accent); outline-offset: 3px; }
@media(hover:hover) and (pointer:fine) { .eagle-card:hover { transform: translateY(-2px); border-color: var(--hw-accent); box-shadow: 0 12px 28px #00000024; } }
.eagle-select { display: block; text-align: left; color: inherit; width: 100%; background: none; border: 0; padding: 4px; min-height: 110px; border-radius: 10px; }
.eagle-move-list summary { display: grid; place-items: center; cursor: pointer; min-height: 44px; color: var(--hw-muted); border-radius: 8px; list-style: none; }.eagle-move-list summary::-webkit-details-marker { display: none; }.eagle-move-list summary:focus-visible { outline: 2px solid var(--hw-accent); }.eagle-items { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; border-top: 1px solid var(--hw-line); padding-top: 6px; }.eagle-items:empty { display: none; }
.eagle-chip { touch-action: none; display: grid; place-items: center; min-width: 44px; min-height: 44px; color: var(--hw-accent); background: var(--hw-bg); border: 1px solid var(--hw-line); border-radius: 10px; padding: 5px; }

.studio-veil { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: flex-end; justify-content: center; background: #030711b8; padding: 12px; padding-bottom: max(12px,env(safe-area-inset-bottom)); }.studio-picker { color: var(--hw-text); background: var(--hw-bg); border: 1px solid var(--hw-line); width: min(640px,100%); max-height: 85dvh; overflow: auto; border-radius: 24px; padding: 20px; box-sizing: border-box; overscroll-behavior: contain; }.picker-title { margin-bottom: 18px; position: sticky; top: -20px; z-index: 2; background: var(--hw-bg); padding: 12px 0; }.picker-tabs { margin-bottom: 14px; }.picker-tabs button { flex: 1; font-size: 12px; }.picker-tabs button[aria-pressed=true],.widget-filters button[aria-pressed=true] { border-color: var(--hw-accent); color: var(--hw-accent); }.picker-search { display: flex; align-items: center; gap: 10px; background: var(--hw-surface); border: 1px solid var(--hw-line); padding: 10px 12px; border-radius: 12px; }.picker-search input::placeholder { color: var(--hw-muted); opacity: 1; }.picker-search input { width: 100%; min-width: 0; background: none; border: 0; color: inherit; min-height: 28px; }.picker-list { display: grid; gap: 8px; }.picker-list>button,.picker-list>article { display: flex; align-items: center; gap: 12px; padding: 12px; color: inherit; background: var(--hw-surface); border: 1px solid var(--hw-line); border-radius: 12px; text-align: left; min-height: 64px; }.picker-list>button>span:nth-child(2),.picker-list>article>span { display: grid; gap: 4px; flex: 1; min-width: 0; }.picker-list strong { font-size: 13px; }.picker-list small { font-size: 11px; line-height: 1.5; color: var(--hw-muted); }.picker-list em { font-size: 10px; color: var(--hw-accent); font-style: normal; }.picker-list a { color: var(--hw-accent); font-size: 11px; padding: 8px 0; }.picker-list article>button { align-self: center; min-width: 44px; min-height: 44px; border: 1px solid var(--hw-line); border-radius: 10px; color: var(--hw-accent); background: var(--hw-bg); }.widget-filters { display: flex; overflow: auto; gap: 6px; margin: 14px 0; }.widget-filters button { flex: 0 0 auto; white-space: nowrap; font-size: 11px; }.picker-feedback { color: var(--hw-accent); min-height: 16px; font-size: 12px; }
@media(max-width:380px) { .home-studio { padding: 4px 0 0; }.workspace-widgets { grid-template-columns: 1fr; }.studio-picker { padding: 14px; }.studio-heading h2 { font-size: 18px; }.workspace-app-icon { width: 46px; height: 46px; }.eagle-canvas { gap: 8px; }.eagle-card { padding: 7px; } }
@media(max-width:599px) { .workspace-app-icon { width: 60px; height: 60px; border-radius: 18px; }.workspace-launch { min-height: 92px; font-size: 12px !important; } }
@media(max-width:380px) { .workspace-app-icon { width: 46px; height: 46px; }.workspace-apps { grid-template-columns: repeat(3, minmax(0, 1fr)); }.workspace-widgets { grid-template-columns: minmax(0, 1fr); } }
@media(min-width:600px) { .workspace-apps { grid-template-columns: repeat(5,minmax(0,1fr)); gap: 24px 12px; }.workspace-widgets { grid-template-columns: repeat(3,minmax(0,1fr)); } }
@media(max-height:600px) { .gesture-hint { display: none; }.studio-heading h2 { font-size: 16px; } }
@keyframes eagle-open { from { opacity: 0; transform: scale(.9); } to { opacity: 1; transform: scale(1); } }
@keyframes home-screen-next { from { opacity: .65; transform: translate3d(18px, 0, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
@keyframes home-screen-previous { from { opacity: .65; transform: translate3d(-18px, 0, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
.motion-reduced .eagle-canvas,.motion-reduced .eagle-card { transition: none; } .motion-reduced .eagle-card:hover { transform: none; }.motion-reduced .eagle-viewport,.motion-reduced .studio-home { animation: none !important; }
@media(prefers-reduced-motion:reduce) { .eagle-canvas,.eagle-card { transition: none; }.eagle-viewport { animation: none; }.eagle-card:hover { transform: none; } }
@media(prefers-reduced-motion:reduce) { .orb-core,.orb-sheen::after { animation: none !important; transition: none !important; } }
@media(prefers-reduced-transparency:reduce), (prefers-contrast:more) { .overview-surface { background: var(--hw-bg); backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }.overview-surface::before { display: none; } }
@media(forced-colors:active) { .overview-surface { background: Canvas; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }.overview-surface::before { display: none; }.eagle-card.current { border: 2px solid Highlight; }.eagle-card:focus-within { outline-color: Highlight; }.is-overview .studio-home { opacity: 0; } }
</style>
