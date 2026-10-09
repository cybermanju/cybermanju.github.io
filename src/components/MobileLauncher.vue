<template>
  <div
    ref="rootRef"
    class="mla"
    :class="{ 'with-app-nav': hasOpenWindows }"
    role="main"
    aria-label="CyberManju home"
    @click.stop
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
  >
    <div class="mla-status">
      <span class="mla-clock">{{ clock }}</span>
      <span class="mla-status-right">
        <span class="mla-net" :class="{ off: !online }">
          <span class="mla-dot" />{{ online ? 'Online' : 'Offline' }}
        </span>
        <span class="mla-vault-count">{{ store.disks.length }} vault{{ store.disks.length === 1 ? '' : 's' }}</span>
      </span>
    </div>

    <header class="mla-hello">
      <p class="mla-eyebrow">{{ dateStr }}</p>
      <h1 class="mla-title">{{ greeting }}</h1>
      <p class="mla-subtitle">Your private space, ready when you are.</p>
    </header>

    <section class="mla-widgets" aria-label="At a glance">
      <button class="mla-widget vault-widget" type="button" @click="open('storage')">
        <span class="mla-widget-icon vault-widget-icon"><AppIcon name="solar:shield-check-bold" :size="19" /></span>
        <span class="mla-widget-copy">
          <span class="mla-widget-label">Private vaults</span>
          <strong>{{ store.disks.length ? `${store.disks.length} ready` : 'Set up your first' }}</strong>
        </span>
        <AppIcon class="mla-widget-arrow" name="solar:arrow-right-bold" :size="14" />
      </button>
      <button class="mla-widget sync-widget" type="button" @click="open('sync')">
        <span class="mla-widget-icon sync-widget-icon"><AppIcon name="solar:refresh-bold" :size="19" /></span>
        <span class="mla-widget-copy">
          <span class="mla-widget-label">Connected sources</span>
          <strong>{{ store.syncConfigs.length }} provider{{ store.syncConfigs.length === 1 ? '' : 's' }}</strong>
        </span>
        <AppIcon class="mla-widget-arrow" name="solar:arrow-right-bold" :size="14" />
      </button>
    </section>

    <label class="mla-search">
      <AppIcon name="solar:magnifier-bold" :size="17" />
      <input
        ref="searchRef"
        v-model="query"
        class="mla-search-input"
        type="search"
        placeholder="Search apps"
        aria-label="Search apps"
        autocomplete="off"
        @keyup.esc="query = ''"
      />
      <kbd v-if="!query" class="mla-search-hint">⌄</kbd>
      <button v-else class="mla-search-clear" type="button" aria-label="Clear search" @click="query = ''">
        <AppIcon name="solar:close-circle-bold" :size="17" />
      </button>
    </label>

    <div class="mla-grid" aria-label="Apps">
      <button
        v-for="app in filtered"
        :key="app.panel"
        class="mla-app"
        type="button"
        :aria-label="`Open ${app.label}${app.hint ? ` — ${app.hint}` : ''}`"
        :title="app.hint ?? app.label"
        @click="open(app.panel)"
      >
        <span class="mla-tile" :style="{ '--app-tint': app.tint }">
          <AppIcon :name="app.icon" :size="25" />
          <span v-if="app.badge" class="mla-badge">{{ app.badge }}</span>
          <span v-if="app.dot" class="mla-live" aria-hidden="true" />
        </span>
        <span class="mla-name">{{ app.label }}</span>
      </button>
    </div>
    <p v-if="filtered.length === 0" class="mla-empty">
      No apps match “{{ query }}”.
      <button class="mla-link" type="button" @click="query = ''">Clear</button>
    </p>

    <div class="mla-dock" role="navigation" aria-label="Favorite apps">
      <button
        v-for="app in dock"
        :key="app.panel"
        class="mla-dock-btn"
        type="button"
        :aria-label="`Open ${app.label}`"
        :title="app.label"
        @click="open(app.panel)"
      >
        <span class="mla-dock-icon" :style="{ '--app-tint': app.tint }">
          <AppIcon :name="app.icon" :size="23" />
        </span>
        <span v-if="isPanelOpen(app.panel)" class="mla-dock-indicator" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import type { PanelType } from '@/types'

const store = useAppStore()
const wm = useWindowManager()
const query = ref('')
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const clock = ref('')
const dateStr = ref('')
const greeting = ref('')
const rootRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const hasOpenWindows = computed(() => wm.windows.value.some(window => !window.minimized))
let timer: ReturnType<typeof setInterval> | null = null

function tickClock() {
  try {
    const now = new Date()
    clock.value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    dateStr.value = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    const hour = now.getHours()
    greeting.value = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  } catch {
    clock.value = ''
    dateStr.value = ''
  }
}

function onOnline() { online.value = true }
function onOffline() { online.value = false }

/** A downward gesture from the top edge focuses the app search, like system search. */
let touchY: number | null = null
function onTouchStart(event: TouchEvent) {
  touchY = event.touches[0]?.clientY ?? null
}
function onTouchMove(event: TouchEvent) {
  if (touchY == null) return
  const y = event.touches[0]?.clientY ?? touchY
  const root = rootRef.value
  if (y - touchY > 72 && (root?.scrollTop ?? 0) <= 0 && document.activeElement !== searchRef.value) {
    touchY = null
    searchRef.value?.focus()
    return
  }
  if (Math.abs(y - touchY) > 10) touchY = null
}

onMounted(() => {
  tickClock()
  timer = setInterval(tickClock, 20_000)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  void store.fetchDisks().catch(() => {})
  void store.fetchTrashItems().catch(() => {})
  void store.fetchSyncConfigs().catch(() => {})
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
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
  { panel: 'agent', label: 'Agent', icon: 'solar:bot-bold', tint: '#8b5ad8', dot: store.activeAgentJob?.status === 'running', hint: 'AI assistant' },
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

const dockApps: PanelType[] = ['files', 'agent', 'terminal', 'settings']
const dock = computed(() => apps.value.filter(app => dockApps.includes(app.panel)))
const filtered = computed(() => {
  const term = query.value.trim().toLowerCase()
  return term ? apps.value.filter(app => app.label.toLowerCase().includes(term)) : apps.value
})

function isPanelOpen(panel: PanelType): boolean {
  return wm.windows.value.some(window => window.panelType === panel && !window.minimized)
}

function open(panel: PanelType) {
  if (store.currentPanel === 'landing') store.currentPanel = 'files'
  wm.open(panel)
  try {
    ;(navigator as Navigator & { vibrate?: (pattern: number) => boolean }).vibrate?.(8)
  } catch { /* optional haptic feedback */ }
}
</script>

<style scoped>
.mla {
  --mla-nav-height: 66px;
  position: absolute;
  inset: 0;
  z-index: 0;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 12px 20px 150px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  background:
    radial-gradient(ellipse at 8% 0%, color-mix(in srgb, var(--ui-accent) 25%, transparent), transparent 42%),
    radial-gradient(ellipse at 100% 38%, rgba(183, 151, 255, 0.16), transparent 42%),
    linear-gradient(160deg, var(--ui-bg), color-mix(in srgb, var(--ui-bg) 88%, #c9d9ff));
  color: var(--ui-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", var(--ui-font), sans-serif;
}

.mla-status,
.mla-status-right,
.mla-net {
  display: flex;
  align-items: center;
}
.mla-status {
  justify-content: space-between;
  min-height: 20px;
  color: var(--ui-text-2);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.mla-clock { font-variant-numeric: tabular-nums; }
.mla-status-right { gap: 12px; color: var(--ui-text-3); font-weight: 500; }
.mla-net { gap: 6px; }
.mla-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ui-success); box-shadow: 0 0 10px color-mix(in srgb, var(--ui-success) 55%, transparent); }
.mla-net.off .mla-dot { background: var(--ui-danger); box-shadow: none; }
.mla-vault-count { padding-left: 11px; border-left: 1px solid var(--ui-border-strong); }

.mla-hello { margin: 2px 0 -2px; }
.mla-eyebrow { margin: 0 0 4px; color: var(--ui-text-3); font-size: 13px; font-weight: 550; text-transform: capitalize; }
.mla-title { margin: 0; font-size: clamp(29px, 8vw, 36px); line-height: 1.08; font-weight: 750; letter-spacing: -0.045em; }
.mla-subtitle { margin: 7px 0 0; color: var(--ui-text-3); font-size: 13px; font-weight: 450; }

.mla-widgets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.mla-widget {
  min-width: 0;
  min-height: 76px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 10px;
  border: 1px solid color-mix(in srgb, var(--ui-border-strong) 64%, transparent);
  border-radius: 20px;
  background: color-mix(in srgb, var(--ui-surface) 66%, transparent);
  color: var(--ui-text);
  text-align: left;
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.07), inset 0 1px rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
  cursor: pointer;
  transition: transform 140ms ease, background 140ms ease;
}
.mla-widget:active { transform: scale(0.97); background: var(--ui-surface-2); }
.mla-widget-icon { flex: 0 0 34px; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 12px; color: #fff; }
.vault-widget-icon { background: linear-gradient(145deg, #63b5ff, #3974dc); }
.sync-widget-icon { background: linear-gradient(145deg, #58d5bd, #188f95); }
.mla-widget-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.mla-widget-label { color: var(--ui-text-3); font-size: 10px; line-height: 1.2; font-weight: 600; white-space: nowrap; }
.mla-widget-copy strong { overflow: hidden; color: var(--ui-text); font-size: 12px; line-height: 1.15; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.mla-widget-arrow { flex: 0 0 auto; color: var(--ui-text-3); opacity: 0.72; }

.mla-search {
  min-height: 49px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 13px;
  border: 1px solid color-mix(in srgb, var(--ui-border-strong) 58%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--ui-surface) 72%, transparent);
  color: var(--ui-text-3);
  box-shadow: 0 5px 18px rgba(16, 24, 40, 0.045);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.mla-search:focus-within { border-color: color-mix(in srgb, var(--ui-accent) 62%, var(--ui-border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 13%, transparent); }
.mla-search-input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: var(--ui-text); font: inherit; font-size: 16px; }
.mla-search-input::placeholder { color: var(--ui-text-3); opacity: 0.9; }
.mla-search-hint { color: var(--ui-text-3); font-family: inherit; font-size: 16px; font-weight: 600; opacity: 0.62; }
.mla-search-clear { width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--ui-surface-2); color: var(--ui-text-3); cursor: pointer; }

.mla-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 19px 7px;
  content-visibility: auto;
  contain-intrinsic-size: auto 400px;
}
.mla-app {
  min-width: 0;
  min-height: 88px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 2px 1px;
  border: 0;
  border-radius: 20px;
  background: transparent;
  cursor: pointer;
  transition: transform 140ms cubic-bezier(.2,.8,.2,1);
  -webkit-tap-highlight-color: transparent;
}
.mla-app:active { transform: scale(0.91); }
.mla-tile {
  position: relative;
  width: clamp(55px, 16vw, 64px);
  height: clamp(55px, 16vw, 64px);
  display: grid;
  place-items: center;
  overflow: visible;
  border: 1px solid rgba(255, 255, 255, 0.30);
  border-radius: 21px;
  background: linear-gradient(145deg, color-mix(in srgb, var(--app-tint) 72%, #fff), var(--app-tint) 76%);
  color: #fff;
  box-shadow: 0 8px 18px color-mix(in srgb, var(--app-tint) 23%, transparent), inset 0 1px rgba(255,255,255,.36);
}
.mla-tile::after { position: absolute; inset: 0; border-radius: inherit; content: ''; background: linear-gradient(140deg, rgba(255,255,255,.20), transparent 60%); pointer-events: none; }
.mla-tile :deep(svg) { position: relative; z-index: 1; filter: drop-shadow(0 1px 1px rgba(0,0,0,.10)); }
.mla-name { max-width: 100%; overflow: hidden; color: var(--ui-text-2); font-size: 11px; line-height: 1.2; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 10px color-mix(in srgb, var(--ui-bg) 70%, transparent); }
.mla-badge { position: absolute; z-index: 2; top: -6px; right: -7px; min-width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; padding: 0 5px; border: 1.5px solid var(--ui-bg); border-radius: 11px; background: #f2475e; color: #fff; font-size: 10px; font-weight: 800; box-shadow: 0 2px 5px rgba(0,0,0,.14); }
.mla-live { position: absolute; z-index: 2; bottom: -4px; left: 50%; width: 9px; height: 9px; transform: translateX(-50%); border: 2px solid var(--ui-bg); border-radius: 50%; background: #35c980; }
.mla-empty { margin: 4px 0; color: var(--ui-text-3); text-align: center; font-size: 13px; }
.mla-link { padding: 7px; border: 0; background: none; color: var(--ui-accent); font: inherit; font-weight: 650; cursor: pointer; }

.mla-dock {
  position: sticky;
  bottom: calc(var(--mla-nav-height) + env(safe-area-inset-bottom, 0px));
  z-index: 2;
  display: flex;
  justify-content: space-around;
  gap: 7px;
  margin: auto -3px 0;
  padding: 9px 11px 7px;
  border: 1px solid color-mix(in srgb, var(--ui-border-strong) 62%, transparent);
  border-radius: 27px;
  background: color-mix(in srgb, var(--ui-surface) 61%, transparent);
  box-shadow: 0 12px 35px rgba(16, 24, 40, .12), inset 0 1px rgba(255,255,255,.2);
  backdrop-filter: blur(24px) saturate(1.45);
  -webkit-backdrop-filter: blur(24px) saturate(1.45);
}
.mla:not(.with-app-nav) { padding-bottom: 96px; }
.mla:not(.with-app-nav) .mla-dock { bottom: 0; }
.mla-dock-btn { position: relative; flex: 1; min-width: 0; min-height: 58px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 18px; background: transparent; cursor: pointer; transition: transform 130ms ease; -webkit-tap-highlight-color: transparent; }
.mla-dock-btn:active { transform: scale(.9); }
.mla-dock-icon { width: 47px; height: 47px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.25); border-radius: 16px; background: linear-gradient(145deg, color-mix(in srgb, var(--app-tint) 72%, #fff), var(--app-tint) 76%); color: #fff; box-shadow: 0 5px 12px color-mix(in srgb, var(--app-tint) 24%, transparent), inset 0 1px rgba(255,255,255,.28); }
.mla-dock-indicator { position: absolute; bottom: 0; left: 50%; width: 4px; height: 4px; transform: translateX(-50%); border-radius: 50%; background: var(--ui-text-2); opacity: .7; }

@media (min-width: 600px) and (max-width: 768px) {
  .mla { padding-left: 32px; padding-right: 32px; gap: 22px; }
  .mla-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 23px 12px; }
  .mla-widgets { max-width: 540px; }
  .mla-dock { max-width: 520px; align-self: center; width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .mla-app, .mla-dock-btn, .mla-widget { transition: none; }
}
</style>
