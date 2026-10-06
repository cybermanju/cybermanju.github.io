<template>
  <header class="top-menu-bar">
    <div class="tmb-left">
      <button class="app-logo" type="button" @click="store.currentPanel = 'landing'">
        <span class="logo-mark"><AppIcon name="solar:diskette-bold" :size="14" /></span>
        <span class="logo-brand">CYBERMANJU</span>
        <span class="logo-drive">DRIVE</span>
      </button>

      <nav class="menu-items" ref="menuRef">
        <div
          v-for="item in menuStructure"
          :key="item.id"
          class="menu-item"
          :class="{ open: openMenu === item.id }"
          role="button"
          tabindex="0"
          :aria-expanded="openMenu === item.id"
          aria-haspopup="menu"
          @click="toggleMenu(item.id)"
          @keydown.enter.prevent="toggleMenu(item.id)"
          @keydown.space.prevent="toggleMenu(item.id)"
          @mouseenter="hoverMenu(item.id)"
        >
          <span class="menu-label">{{ item.label }}</span>
          <Transition name="menu">
            <div v-if="openMenu === item.id" class="menu-dropdown ui-shine">
              <template v-for="sub in item.children" :key="sub.id">
                <div v-if="sub.divider" class="menu-divider" />
                <button
                  v-else
                  class="menu-dropdown-item"
                  type="button"
                  @click.stop="executeMenuItem(sub)"
                >
                  <span class="mdi-icon"><AppIcon :name="sub.icon" :size="14" /></span>
                  <span class="mdi-label">{{ sub.label }}</span>
                  <span v-if="sub.shortcut" class="mdi-shortcut">{{ sub.shortcut }}</span>
                  <span v-if="sub.checked" class="mdi-check"><AppIcon name="solar:check-circle-bold" :size="13" /></span>
                </button>
              </template>
            </div>
          </Transition>
        </div>
      </nav>
    </div>

    <div class="tmb-center">
      <div class="search-wrap" :class="{ searching: store.isSearching, focused: searchFocused }">
        <AppIcon name="solar:magnifer-bold" :size="13" class="search-icon" />
        <input
          v-model="store.searchQuery"
          class="search-input"
          type="text"
          placeholder="Search files…"
          aria-label="Search files"
          title="Search files (Ctrl+F) — Enter to search, Esc to clear"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
          @keyup.enter="handleSearch"
          @keyup.esc="clearSearch"
        />
        <span v-if="store.isSearching" class="search-cursor" aria-hidden="true" />
        <span v-else-if="searchQueryShort" class="search-hint">ENTER</span>
      </div>
    </div>

    <div class="tmb-right">
      <div class="sys-tray">
        <button
          class="tray-icon"
          :class="{ active: store.encryptionStatus.isEncrypted }"
          type="button"
          @click="wm.open('encryption')"
          :title="`Encryption: ${store.encryptionStatus.isEncrypted ? 'ON' : 'OFF'}`"
        >
          <AppIcon :name="store.encryptionStatus.isEncrypted ? 'solar:shield-check-bold' : 'solar:shield-bold'" :size="14" />
        </button>

        <button
          class="tray-icon"
          :class="{ active: store.compressedFiles.length > 0 }"
          type="button"
          @click="wm.open('compression')"
          :title="`Compression: ${store.compressedFiles.length} files`"
        >
          <AppIcon name="solar:archive-bold" :size="14" />
        </button>

        <button
          class="tray-icon"
          :class="{ active: store.activeAccount }"
          type="button"
          @click="wm.open('accounts')"
          :title="store.activeAccount?.name || 'No account'"
        >
          <AppIcon name="solar:user-circle-bold" :size="14" />
        </button>

        <button
          class="tray-icon"
          type="button"
          title="Cycle theme"
          @click="theme.cycleTheme()"
        >
          <AppIcon :name="theme.mode.value === 'light' ? 'solar:sun-bold' : 'solar:moon-bold'" :size="14" />
        </button>

        <button
          class="tray-icon"
          :class="{ active: store.matrixRainEnabled }"
          type="button"
          @click="store.matrixRainEnabled = !store.matrixRainEnabled"
          title="Toggle background effects"
        >
          <AppIcon name="solar:widget-bold" :size="14" />
        </button>

        <button
          class="tray-icon"
          type="button"
          @click="store.commandPaletteOpen = true"
          title="Command Palette"
        >
          <AppIcon name="solar:command-bold" :size="14" />
        </button>

        <button
          class="tray-icon"
          type="button"
          @click="wm.open('accounts')"
          :title="store.currentUser ? `Signed in — ${store.currentUser.username}` : 'Accounts — OAuth sign-in, .cybermanju disk'"
        >
          <AppIcon name="solar:login-2-bold" :size="14" />
        </button>
      </div>

      <div class="tmb-separator" />

      <button class="clock" type="button" @click="openDateInfo">
        <span class="clock-time">{{ timeStr }}</span>
        <span class="clock-date">{{ dateStr }}</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import { useTheme } from '@/composables/useTheme'

const store = useAppStore()
const wm = useWindowManager()
const theme = useTheme()
const searchQueryShort = computed(() => store.searchQuery.trim().length > 0)

const searchFocused = ref(false)

const timeStr = ref('')
const dateStr = ref('')
let clockTimer: ReturnType<typeof setInterval> | null = null

function updateClock() {
  const now = new Date()
  timeStr.value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  dateStr.value = now.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

onMounted(() => {
  updateClock()
  clockTimer = setInterval(updateClock, 1000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})

const openMenu = ref<string | null>(null)
const menuRef = ref<HTMLElement | null>(null)

interface MenuItem {
  id: string
  label?: string
  icon?: string
  shortcut?: string
  checked?: boolean
  divider?: true
  action?: () => void
}

interface MenuGroup {
  id: string
  label: string
  children: MenuItem[]
}

const menuStructure = computed<MenuGroup[]>(() => [
  {
    id: 'file',
    label: 'File',
    children: [
      { id: 'new-folder', label: 'New Folder', icon: 'solar:add-folder-bold', shortcut: 'Ctrl+N', action: () => { store.createFolderPromptOpen = true } },
      { id: 'upload', label: 'Upload Files', icon: 'solar:upload-bold', action: () => { window.dispatchEvent(new CustomEvent('cybermanju:upload')) } },
      { id: 'div1', divider: true },
      { id: 'open-terminal', label: 'Open Terminal (cybsh)', icon: 'solar:file-terminal-bold', shortcut: 'Ctrl+`', action: () => { wm.open('terminal') } },
      { id: 'open-tasks', label: 'Tasks (ps/top)', icon: 'solar:cpu-bold', action: () => { wm.open('processes') } },
      { id: 'open-disks', label: 'Disks & Volume', icon: 'solar:flash-drive-bold', action: () => { wm.open('disks') } },
      { id: 'div2', divider: true },
      { id: 'settings', label: 'Settings', icon: 'solar:settings-bold', shortcut: 'Ctrl+,', action: () => { wm.open('settings') } },
      { id: 'quit', label: 'Quit', icon: 'solar:power-bold', action: () => {} },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    children: [
      { id: 'cut', label: 'Cut', icon: 'solar:scissors-bold', shortcut: 'Ctrl+X', action: () => {} },
      { id: 'copy', label: 'Copy', icon: 'solar:copy-bold', shortcut: 'Ctrl+C', action: () => {} },
      { id: 'paste', label: 'Paste', icon: 'solar:clipboard-bold', shortcut: 'Ctrl+V', action: () => {} },
      { id: 'div1', divider: true },
      { id: 'select-all', label: 'Select All', icon: 'solar:check-circle-bold', shortcut: 'Ctrl+A', action: () => { store.selectedFileIds = store.files.map(f => f.id) } },
      { id: 'deselect', label: 'Deselect', icon: 'solar:close-square-bold', action: () => { store.selectedFileIds = [] } },
    ],
  },
  {
    id: 'view',
    label: 'View',
    children: [
      { id: 'file-browser', label: 'File Browser', icon: 'solar:folder-bold', shortcut: 'Ctrl+1', action: () => { wm.open('files') } },
      { id: 'collections', label: 'Collections', icon: 'solar:library-bold', action: () => { wm.open('collections') } },
      { id: 'people', label: 'People (Faces)', icon: 'solar:face-scan-square-bold', action: () => { wm.open('faces') } },
      { id: 'map', label: 'Map View', icon: 'solar:map-bold', action: () => { wm.open('map') } },
      { id: 'code', label: 'Code Intelligence', icon: 'solar:code-square-bold', action: () => { wm.open('code') } },
      { id: 'div1', divider: true },
      { id: 'search', label: 'Search', icon: 'solar:magnifer-bold', shortcut: 'Ctrl+F', action: () => { store.searchQuery = ''; wm.open('search') } },
      { id: 'storage', label: 'Storage Dashboard', icon: 'solar:database-bold', action: () => { wm.open('storage') } },
      { id: 'sync-panel', label: 'Sync Panel', icon: 'solar:refresh-bold', action: () => { wm.open('sync') } },
      { id: 'devices', label: 'Devices & Sensors', icon: 'solar:plug-circle-bold', action: () => { wm.open('devices') } },
      { id: 'loose-groups', label: 'Loose Groups', icon: 'solar:users-group-two-rounded-bold', action: () => { wm.open('loose-groups') } },
      { id: 'style', label: 'Style Tags', icon: 'solar:tag-bold', action: () => { wm.open('style') } },
      { id: 'overlay', label: 'Overlay Dashboard', icon: 'solar:kanban-square-bold', action: () => { wm.open('webdash') } },
      { id: 'div2', divider: true },
      { id: 'minimize-all', label: 'Minimize All', icon: 'solar:minimize-square-bold', action: () => wm.minimizeAll() },
      { id: 'close-all', label: 'Close All Windows', icon: 'solar:close-circle-bold', action: () => wm.closeAll() },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    children: [
      { id: 'trash', label: 'Trash', icon: 'solar:trash-bin-trash-bold', action: () => { wm.open('trash'); store.fetchTrashItems() } },
      { id: 'activity', label: 'Activity Log', icon: 'solar:chart-bold', action: () => { wm.open('activity'); store.fetchAuditLog() } },
      { id: 'favorites', label: 'Favorites', icon: 'solar:star-bold', action: () => { wm.open('favorites') } },
      { id: 'recent', label: 'Recent Files', icon: 'solar:history-2-bold', action: () => { wm.open('recent') } },
      { id: 'div1', divider: true },
      { id: 'accounts', label: 'Account Manager', icon: 'solar:user-id-bold', action: () => { wm.open('accounts') } },
      { id: 'sync-panel-link', label: 'Provider Connections (OAuth)', icon: 'solar:link-bold', action: () => { wm.open('sync') } },
      { id: 'terminal', label: 'Terminal (cybsh)', icon: 'solar:file-terminal-bold', shortcut: 'Ctrl+`', action: () => { wm.open('terminal') } },
      { id: 'tasks', label: 'Tasks (ps/top)', icon: 'solar:cpu-bold', action: () => { wm.open('processes') } },
      { id: 'disks', label: 'Disks & Volume', icon: 'solar:flash-drive-bold', action: () => { wm.open('disks') } },
      { id: 'storage', label: 'Storage Dashboard', icon: 'solar:database-bold', action: () => { wm.open('storage') } },
      { id: 'users', label: 'User Management', icon: 'solar:users-group-rounded-bold', action: () => { wm.open('users'); store.fetchUsers() } },
      { id: 'div2', divider: true },
      { id: 'command-palette', label: 'Command Palette', icon: 'solar:command-bold', shortcut: 'Ctrl+K', action: () => { store.commandPaletteOpen = true } },
      { id: 'keyboard-shortcuts', label: 'Keyboard Shortcuts', icon: 'solar:keyboard-bold', shortcut: '?', action: () => { store.showShortcutsHelp = true } },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    children: [
      { id: 'about', label: 'About CyberManju OS', icon: 'solar:info-circle-bold', action: () => {} },
      { id: 'docs', label: 'Documentation', icon: 'solar:book-bookmark-bold', action: () => { window.open('https://github.com/cybermanju/cybermanju.github.io', '_blank') } },
      { id: 'div1', divider: true },
      { id: 'matrix', label: 'Toggle Matrix Rain', icon: 'solar:widget-bold', checked: store.matrixRainEnabled, action: () => { store.matrixRainEnabled = !store.matrixRainEnabled } },
    ],
  },
])

function toggleMenu(id: string) {
  openMenu.value = openMenu.value === id ? null : id
}

function hoverMenu(id: string) {
  if (openMenu.value !== null) {
    openMenu.value = id
  }
}

function executeMenuItem(item: MenuItem) {
  openMenu.value = null
  item.action?.()
}

function handleSearch() {
  if (store.searchQuery.trim()) {
    store.searchFiles(store.searchQuery)
    wm.open('search')
  }
}

function clearSearch() {
  store.searchQuery = ''
}

function openDateInfo() {
  wm.open('settings')
}

function handleClickOutside(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    openMenu.value = null
  }
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && openMenu.value !== null) {
    openMenu.value = null
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleEscape)
})
</script>

<style scoped>
.top-menu-bar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  background: var(--ui-glass);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  border-bottom: 1px solid var(--ui-border);
  box-shadow: 0 1px 0 var(--ui-glass-highlight), var(--ui-shadow-1);
  z-index: 100;
  position: relative;
  gap: 8px;
  -webkit-app-region: drag;
  user-select: none;
}

.tmb-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  /* Must stay visible: the menu dropdowns overflow below the 36px bar.
     `hidden` here clips them to zero height so clicks appear to do nothing. */
  overflow: visible;
  -webkit-app-region: no-drag;
}

.app-logo {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  height: 26px;
  cursor: pointer;
  border-right: 1px solid var(--ui-border);
  margin-right: 4px;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  transition: background-color var(--ui-dur-fast) var(--ui-ease-out);
}

.app-logo:hover {
  background: var(--ui-accent-softer);
}

.logo-mark {
  display: inline-flex;
  color: var(--ui-accent);
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--ui-accent) 65%, transparent));
}

.logo-brand {
  font-family: var(--ui-font);
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 1.6px;
  color: var(--ui-text);
  transition: color var(--ui-dur);
}

.app-logo:hover .logo-brand {
  color: var(--ui-accent);
}

.logo-drive {
  font-family: var(--ui-font-mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-accent);
  letter-spacing: 0.8px;
  padding: 1px 5px;
  border-radius: var(--ui-radius-xs);
  background: var(--ui-accent-softer);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 30%, transparent);
}

.menu-items {
  display: flex;
  align-items: center;
  /* Must stay visible: any non-visible overflow-x forces overflow-y to
     compute to auto/hidden and clips the absolutely-positioned dropdowns. */
  overflow: visible;
  min-width: 0;
  flex-shrink: 1;
}

.menu-items::-webkit-scrollbar {
  display: none;
}

.menu-item {
  position: relative;
  padding: 5px 10px;
  cursor: pointer;
  border-radius: var(--ui-radius-sm);
  transition: background-color var(--ui-dur-fast) var(--ui-ease-out);
}

.menu-item:hover,
.menu-item.open {
  background: var(--ui-accent-softer);
}

.menu-item:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 80%, transparent);
  outline-offset: 1px;
}

.menu-label {
  font-family: var(--ui-font);
  font-size: var(--ui-fs-sm);
  color: var(--ui-text-2);
  letter-spacing: 0.02em;
  font-weight: 550;
  transition: color var(--ui-dur-fast) var(--ui-ease-out);
}

.menu-item:hover .menu-label,
.menu-item.open .menu-label {
  color: var(--ui-text);
}

.menu-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 248px;
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-md);
  padding: 5px;
  box-shadow: var(--ui-shadow-3);
  z-index: 200;
}

.menu-dropdown::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--ui-glass-highlight) 30%, transparent);
  border-radius: var(--ui-radius-md) var(--ui-radius-md) 0 0;
  pointer-events: none;
}

.menu-dropdown-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 10px;
  font-family: var(--ui-font);
  font-size: var(--ui-fs-sm);
  color: var(--ui-text-2);
  cursor: pointer;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  text-align: left;
  transition:
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    color var(--ui-dur-fast) var(--ui-ease-out),
    transform var(--ui-dur-fast) var(--ui-ease-out);
}

.menu-dropdown-item:hover {
  background: var(--ui-accent-softer);
  color: var(--ui-text);
  transform: translateX(3px);
}

.mdi-icon {
  width: 18px;
  display: inline-flex;
  justify-content: center;
  color: var(--ui-text-3);
  transition: color var(--ui-dur-fast) var(--ui-ease-out);
}

.menu-dropdown-item:hover .mdi-icon {
  color: var(--ui-accent);
}

.mdi-label {
  flex: 1;
}

.mdi-shortcut {
  font-family: var(--ui-font-mono);
  font-size: 9.5px;
  color: var(--ui-text-faint);
  margin-left: auto;
  padding: 1px 5px;
  border-radius: var(--ui-radius-xs);
  background: color-mix(in srgb, var(--ui-text) 7%, transparent);
}

.mdi-check {
  color: var(--ui-accent);
  display: inline-flex;
}

.menu-divider {
  height: 1px;
  background: var(--ui-border);
  margin: 4px 6px;
}

/* dropdown transition */
.menu-enter-active,
.menu-leave-active {
  transition:
    opacity var(--ui-dur) var(--ui-ease-out),
    transform var(--ui-dur) var(--ui-ease-out);
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

/* ── search ───────────────────────────────────────────────────────────── */

.tmb-center {
  flex: 1;
  display: flex;
  justify-content: center;
  max-width: 420px;
  margin: 0 auto;
}

.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  background: color-mix(in srgb, var(--ui-surface) 75%, transparent);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-full);
  padding: 0 12px;
  height: 25px;
  gap: 7px;
  transition:
    border-color var(--ui-dur) var(--ui-ease-out),
    box-shadow var(--ui-dur) var(--ui-ease-out),
    background-color var(--ui-dur) var(--ui-ease-out);
}

.search-wrap:hover {
  border-color: var(--ui-border-hover);
}

.search-wrap.focused,
.search-wrap.searching {
  border-color: color-mix(in srgb, var(--ui-accent) 65%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 14%, transparent);
  background: color-mix(in srgb, var(--ui-surface-2) 85%, transparent);
}

.search-icon {
  color: var(--ui-text-3);
  flex-shrink: 0;
  transition: color var(--ui-dur);
}

.search-wrap.focused .search-icon,
.search-wrap.searching .search-icon {
  color: var(--ui-accent);
}

.search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  color: var(--ui-text);
  font-family: var(--ui-font);
  font-size: var(--ui-fs-sm);
  height: 100%;
  outline: none;
}

.search-input::placeholder {
  color: var(--ui-text-faint);
}

.search-hint {
  font-family: var(--ui-font-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--ui-text-faint);
  padding: 1px 5px;
  border-radius: var(--ui-radius-xs);
  border: 1px solid var(--ui-border);
  flex-shrink: 0;
}

.search-cursor {
  color: var(--ui-accent);
  animation: blink 0.8s step-end infinite;
  font-size: 11px;
}

@keyframes blink {
  50% { opacity: 0; }
}

/* ── tray + clock ─────────────────────────────────────────────────────── */

.tmb-right {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
}

.sys-tray {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
  max-width: 100%;
}

.sys-tray::-webkit-scrollbar {
  display: none;
}

.tray-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 27px;
  height: 24px;
  color: var(--ui-text-3);
  cursor: pointer;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  border: 1px solid transparent;
  transition:
    color var(--ui-dur-fast) var(--ui-ease-out),
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    border-color var(--ui-dur-fast) var(--ui-ease-out),
    transform var(--ui-dur-fast) var(--ui-ease-spring);
}

.tray-icon:hover {
  color: var(--ui-text);
  background: var(--ui-accent-softer);
  border-color: color-mix(in srgb, var(--ui-accent) 26%, transparent);
  transform: translateY(-1px);
}

.tray-icon.active {
  color: var(--ui-accent);
}

.tmb-separator {
  width: 1px;
  height: 18px;
  background: var(--ui-border);
  flex-shrink: 0;
}

.clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding: 2px 8px;
  cursor: pointer;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  border: 1px solid transparent;
  transition:
    background-color var(--ui-dur-fast) var(--ui-ease-out),
    border-color var(--ui-dur-fast) var(--ui-ease-out);
}

.clock:hover {
  background: var(--ui-accent-softer);
  border-color: color-mix(in srgb, var(--ui-accent) 26%, transparent);
}

.clock-time {
  font-family: var(--ui-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--ui-text);
  line-height: 1.2;
}

.clock-date {
  font-family: var(--ui-font-mono);
  font-size: 8.5px;
  color: var(--ui-text-3);
  line-height: 1.2;
}

@media (max-width: 960px) {
  .tmb-center {
    max-width: 220px;
  }
  .clock-date {
    display: none;
  }
}

@media (max-width: 720px) {
  .tmb-center {
    display: none;
  }
  .logo-brand {
    display: none;
  }
  .menu-item {
    padding: 5px 7px;
  }
}
</style>
