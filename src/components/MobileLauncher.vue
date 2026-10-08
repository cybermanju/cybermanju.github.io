<!-- CyberManju OS — mobile launcher (iOS-style home for phones).
  //
  // Base layer of the mobile desktop: status bar (clock + net + vault),
  // search, 4-column neon app grid, and a 4-slot dock. Opening an app slides
  // a fullscreen sheet over this grid; closing all windows returns here.
  // Perf: solid tiles (no backdrop-filter), transform-only press states,
  // content-visibility on the grid. -->
<template>
  <div
    ref="rootRef"
    class="mla"
    role="main"
    aria-label="CyberManju home"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
  >
    <div class="mla-scan" aria-hidden="true" />

    <div class="mla-status">
      <span class="mla-clock">{{ clock }}</span>
      <span class="mla-net" :class="{ off: !online }">
        <span class="mla-dot" />{{ online ? 'ONLINE' : 'OFFLINE' }}
      </span>
      <span class="mla-vault">{{ store.disks.length }} VAULT{{ store.disks.length === 1 ? '' : 'S' }}</span>
    </div>

    <div class="mla-hello">
      <p class="mla-eyebrow">CYBERMANJU OS · {{ dateStr }}</p>
      <h1 class="mla-title">GHOSTLINE<span class="mla-caret">_</span></h1>
    </div>

    <!-- First-run nudge: no vault partitions yet → one tap to create them. -->
    <button
      v-if="store.disks.length === 0"
      class="mla-cta"
      type="button"
      @click="open('storage')"
    >
      <AppIcon name="solar:diskette-bold" :size="16" />
      <span>No vaults yet — create your first partition</span>
    </button>

    <label class="mla-search">
      <AppIcon name="solar:magnifier-bold" :size="15" />
      <input
        ref="searchRef"
        v-model="query"
        class="mla-search-input"
        type="search"
        placeholder="Search apps…"
        aria-label="Search apps"
        autocomplete="off"
        @keyup.esc="query = ''"
      />
    </label>

    <div class="mla-grid">
      <button
        v-for="app in filtered"
        :key="app.panel"
        class="mla-app"
        type="button"
        :aria-label="`Open ${app.label}${app.hint ? ` — ${app.hint}` : ''}`"
        :title="app.hint ?? app.label"
        @click="open(app.panel)"
      >
        <span class="mla-tile" :class="{ danger: app.danger }">
          <AppIcon :name="app.icon" :size="24" />
          <span v-if="app.badge" class="mla-badge">{{ app.badge }}</span>
          <span v-if="app.dot" class="mla-live" aria-hidden="true" />
        </span>
        <span class="mla-name">{{ app.label }}</span>
      </button>
    </div>
    <p v-if="filtered.length === 0" class="mla-empty">No apps match “{{ query }}”. <button class="mla-link" type="button" @click="query = ''">Clear search</button></p>

    <div class="mla-dock" role="navigation" aria-label="Favorite apps">
      <button
        v-for="app in dock"
        :key="app.panel"
        class="mla-dock-btn"
        type="button"
        :aria-label="`Open ${app.label}`"
        @click="open(app.panel)"
      >
        <AppIcon :name="app.icon" :size="22" />
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
const rootRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)

let timer: ReturnType<typeof setInterval> | null = null

function tickClock() {
  try {
    const now = new Date()
    clock.value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    dateStr.value = now
      .toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
      .toUpperCase()
  } catch {
    clock.value = ''
    dateStr.value = ''
  }
}

function onOnline() { online.value = true }
function onOffline() { online.value = false }

/** iOS pull-down: a downward drag from the top of home focuses search. */
let touchY: number | null = null
function onTouchStart(e: TouchEvent) {
  touchY = e.touches[0]?.clientY ?? null
}
function onTouchMove(e: TouchEvent) {
  if (touchY == null) return
  const y = e.touches[0]?.clientY ?? touchY
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
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
})

interface App {
  panel: PanelType
  label: string
  icon: string
  danger?: boolean
  badge?: string
  dot?: boolean
  hint?: string
}

/** Badges cap at 99+ so phone-sized pills never blow out. */
function count(n: number): string {
  if (!n) return ''
  return n > 99 ? '99+' : String(n)
}

const apps = computed<App[]>(() => [
  { panel: 'files', label: 'Files', icon: 'solar:folder-bold', badge: count(store.files.length), hint: 'Browse + manage files' },
  { panel: 'search', label: 'Search', icon: 'solar:magnifier-bold', hint: 'Full-text search' },
  { panel: 'agent', label: 'Agent', icon: 'solar:bot-bold', dot: store.activeAgentJob?.status === 'running', hint: 'AI assistant' },
  { panel: 'storage', label: 'Vaults', icon: 'solar:diskette-bold', badge: count(store.disks.length), hint: 'Vault partitions + disks' },
  { panel: 'accounts', label: 'Accounts', icon: 'solar:user-circle-bold', hint: 'Providers + users' },
  { panel: 'terminal', label: 'Terminal', icon: 'solar:file-terminal-bold', hint: 'cybsh shell' },
  { panel: 'editor', label: 'Code', icon: 'solar:file-code-bold', hint: 'Code studio' },
  { panel: 'sync', label: 'Sync', icon: 'solar:refresh-bold', hint: 'Provider sync jobs' },
  { panel: 'map', label: 'Map', icon: 'solar:map-bold', hint: 'GPS-tagged files' },
  { panel: 'collections', label: 'Library', icon: 'solar:library-bold', hint: 'Collections + favorites' },
  { panel: 'settings', label: 'Settings', icon: 'solar:settings-bold', hint: 'Theme + transport' },
  { panel: 'trash', label: 'Trash', icon: 'solar:trash-bin-trash-bold', danger: true, badge: count(store.trashItems.length), hint: 'Deleted files' },
])

const dockApps: PanelType[] = ['files', 'agent', 'terminal', 'settings']
const dock = computed(() => apps.value.filter(a => dockApps.includes(a.panel)))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return apps.value
  return apps.value.filter(a => a.label.toLowerCase().includes(q))
})

function open(panel: PanelType) {
  if (store.currentPanel === 'landing') store.currentPanel = 'files'
  wm.open(panel)
  try {
    ;(navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(8)
  } catch { /* no haptics */ }
}
</script>

<style scoped>
.mla {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding:
    calc(10px + env(safe-area-inset-top, 0px))
    16px
    calc(150px + env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background:
    radial-gradient(60% 34% at 50% -6%, color-mix(in srgb, var(--ui-accent) 14%, transparent), transparent 70%),
    radial-gradient(50% 30% at 88% 100%, color-mix(in srgb, var(--ui-danger) 10%, transparent), transparent 70%),
    var(--ui-bg);
  overscroll-behavior: contain;
}

/* scanlines — absolute (never escapes home), one static gradient, GPU-cheap */
.mla-scan {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0 3px,
    rgba(0, 0, 0, 0.22) 3px 4px
  );
  opacity: 0.5;
}

.mla-status {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--ui-font-mono);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: var(--ui-text-3);
}
.mla-clock { color: var(--ui-text); font-size: 12px; }
.mla-net { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-accent); }
.mla-net.off { color: var(--ui-danger); }
.mla-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
.mla-vault { margin-left: auto; }

.mla-hello { margin-top: 2px; }
.mla-eyebrow {
  margin: 0;
  font-family: var(--ui-font-mono);
  font-size: 10px;
  letter-spacing: 0.34em;
  color: var(--ui-text-3);
}
.mla-title {
  margin: 0;
  font-size: 30px;
  font-weight: 900;
  letter-spacing: 0.06em;
  color: var(--ui-text);
  text-shadow: 0 0 18px color-mix(in srgb, var(--ui-accent) 45%, transparent);
}
.mla-caret { color: var(--ui-accent); animation: mla-blink 1.1s steps(1) infinite; }
@keyframes mla-blink { 50% { opacity: 0; } }

.mla-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  min-height: 48px;
  border-radius: 12px;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-surface);
  color: var(--ui-text-3);
}
.mla-search-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: var(--ui-text);
  font-family: inherit;
  font-size: 16px;
}

.mla-cta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 10px 14px;
  border-radius: 14px;
  border: 1px dashed color-mix(in srgb, var(--ui-accent) 55%, transparent);
  background: color-mix(in srgb, var(--ui-accent) 8%, transparent);
  color: var(--ui-text);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 0 16px color-mix(in srgb, var(--ui-accent) 14%, transparent);
}
.mla-cta:active { transform: scale(0.98); }
.mla-link {
  background: none;
  border: none;
  color: var(--ui-accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
  padding: 8px;
}

.mla-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px 8px;
  content-visibility: auto;
  contain-intrinsic-size: auto 420px;
}
.mla-app {
  background: none;
  border: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 4px 2px;
  min-height: 76px;
  transition: transform 120ms ease-out;
}
.mla-app:active { transform: scale(0.9); }
.mla-tile {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: 16px;
  color: var(--ui-accent);
  background: color-mix(in srgb, var(--ui-accent) 10%, var(--ui-surface));
  border: 1px solid color-mix(in srgb, var(--ui-accent) 40%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--ui-accent) 18%, transparent);
}
.mla-tile.danger {
  color: var(--ui-danger);
  background: color-mix(in srgb, var(--ui-danger) 10%, var(--ui-surface));
  border-color: color-mix(in srgb, var(--ui-danger) 45%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--ui-danger) 20%, transparent);
}
.mla-name {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ui-text-2);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mla-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 900;
  background: var(--ui-danger);
  color: #fff;
}
.mla-live {
  position: absolute;
  bottom: -3px;
  left: 50%;
  transform: translateX(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ui-accent);
  box-shadow: 0 0 10px var(--ui-accent);
  animation: mla-blink 1.1s steps(1) infinite;
}
.mla-empty { text-align: center; font-size: 12px; color: var(--ui-text-3); }

.mla-dock {
  /* Sticky (not fixed): stays pinned above the bottom nav while the grid
     scrolls underneath, and never escapes the home stacking context. */
  position: sticky;
  bottom: calc(66px + env(safe-area-inset-bottom, 0px));
  margin-top: auto;
  margin-left: -4px;
  margin-right: -4px;
  z-index: 2;
  display: flex;
  gap: 8px;
  justify-content: space-around;
  padding: 10px 12px;
  border-radius: 22px;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-surface);
}
.mla-dock-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  border-radius: 14px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ui-text-2);
  cursor: pointer;
  transition: transform 120ms ease-out;
}
.mla-dock-btn:active { transform: scale(0.9); border-color: var(--ui-border-strong); color: var(--ui-accent); }

@media (prefers-reduced-motion: reduce) {
  .mla-caret, .mla-live { animation: none; }
  .mla-app, .mla-dock-btn { transition: none; }
}
</style>
