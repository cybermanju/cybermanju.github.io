<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, provide, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import { useTitle, useBroadcastChannel } from '@vueuse/core'
import { useAppStore } from '@/stores/app'
import { useKeyboardShortcuts, getGlobalShortcuts } from '@/composables/useKeyboardShortcuts'
import { useShortcuts } from '@/composables/useShortcuts'
import { useContextMenu } from '@/composables/useContextMenu'
import { useDrag } from '@/composables/useDrag'
import { useSwipe } from '@/composables/useSwipe'
import { useTouchConfig, type TouchAction } from '@/composables/useTouchConfig'
import { useWindowManager } from '@/composables/useWindowManager'
import { useFullscreen } from '@vueuse/core'
import { finishSupabaseReturn, hydrateSupabaseConfig, refreshIdentity } from '@/composables/useSupabase'
import { migrateVaultFromLocalStorage } from '@/composables/useVault'
import { bootCyberManjuDisk, disk } from '@/composables/useCyberManjuFile'
import { startVolumeMirror, replayVolumeFromVault, flushVolumeMirror } from '@/composables/useVolumeMirror'
import { defaultKpl, defaultKpd } from '@/keymaps'
import { ShortcutsKey } from '@/composables/shortcutsKey'
import DesktopShell from '@/components/DesktopShell.vue'
import LandingPage from '@/components/LandingPage.vue'
import CanvasEngine from '@/components/CanvasEngine.vue'
import NotificationStack from '@/components/NotificationStack.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import KeyboardShortcutsHelp from '@/components/KeyboardShortcutsHelp.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import FileUploadDialog from '@/components/FileUploadDialog.vue'
import MobileNav from '@/components/MobileNav.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import type { PanelType } from '@/types'

const store = useAppStore()
const wm = useWindowManager()

// OS chrome: live tab title + multi-tab refresh bus (VueUse).
// Title shows job/sync pressure at a glance; any tab that writes files
// broadcasts `cybermanju:files-changed` so siblings re-fetch instead of
// going stale.
const pageTitle = useTitle('CyberManju OS')
const tabBus = useBroadcastChannel<string, string>({ name: 'cybermanju-os' })
const titleText = computed(() => {
  const n = store.files.length
  if (store.shellBusy) return `● CyberManju OS — working (${n})`
  if (store.activeAgentJob?.status === 'running') return `● CyberManju OS — agent (${n})`
  return `CyberManju OS — ${n} files`
})
watch(titleText, (t) => { pageTitle.value = t }, { immediate: true })
watch(() => tabBus.data.value, (msg) => {
  if (msg === 'cybermanju:files-changed') void store.fetchFiles(store.currentPath)
})

useKeyboardShortcuts(getGlobalShortcuts(store))

const shortcutOverrides = ref<Record<string, string>>({})
try {
  const saved = localStorage.getItem('cybermanju_keybindings')
  if (saved) shortcutOverrides.value = JSON.parse(saved)
} catch {}

const shortcuts = useShortcuts(defaultKpl, defaultKpd, undefined, shortcutOverrides)
provide(ShortcutsKey, shortcuts)

const ctx = useContextMenu()
const drag = useDrag()
const { toggle: toggleFullscreen } = useFullscreen()

const touchConfig = useTouchConfig({ autoDetect: true })
touchConfig.onAction((action: TouchAction) => {
  const actionMap: Record<string, () => void> = {
    toggle_sidebar: () => {},
    toggle_palette: () => { store.commandPaletteOpen = !store.commandPaletteOpen },
    toggle_help: () => { store.showShortcutsHelp = !store.showShortcutsHelp },
    focus_search: () => { wm.open('search') },
    go_back: () => navigateInHistory(-1),
    go_forward: () => navigateInHistory(1),
    go_home: () => { store.currentPanel = 'landing' },
    prev_panel: () => {},
    next_panel: () => {},
    open_trash: () => { wm.open('trash'); store.fetchTrashItems() },
    open_activity: () => { wm.open('activity'); store.fetchAuditLog() },
    open_collections: () => { wm.open('collections') },
    open_faces: () => { wm.open('faces') },
    open_map: () => { wm.open('map') },
    open_code: () => { wm.open('code') },
    open_settings: () => { wm.open('settings') },
    open_storage: () => { wm.open('storage') },
    escape: () => {
      store.selectedFileId = null
      store.createFolderPromptOpen = false
    },
    new_folder: () => { store.createFolderPromptOpen = true },
    refresh: () => { store.fetchFiles() },
    toggle_fullscreen: () => {
      toggleFullscreen().catch(() => {})
    },
    context_menu: () => {},
    select_item: () => {},
    zoom_in: () => {},
    zoom_out: () => {},
    none: () => {},
    scroll_up: () => window.scrollBy(0, -100),
    scroll_down: () => window.scrollBy(0, 100),
  }
  actionMap[action]?.()
})

const searchTypeFilter = ref('all')
const searchCurrentDir = ref(false)
const recentSearches = ref<string[]>((() => {
  try { return JSON.parse(localStorage.getItem('cybermanju_recent_searches') || '[]') as string[] } catch { return [] }
})())

function saveRecentSearch(query: string) {
  if (!query.trim()) return
  const arr = recentSearches.value.filter(s => s !== query)
  arr.unshift(query)
  if (arr.length > 10) arr.pop()
  recentSearches.value = arr
  localStorage.setItem('cybermanju_recent_searches', JSON.stringify(arr))
}

watch(() => store.searchResults, (results) => {
  if (results.length > 0 && store.searchQuery.trim()) {
    saveRecentSearch(store.searchQuery)
  }
})

const confirmVisible = ref(false)
const confirmMessage = ref('')
const confirmTitle = ref('CONFIRM')

const newFolderName = ref('')
const folderInputRef = ref<{ focus: () => void } | null>(null)
const showUploadDialog = ref(false)

const mainAreaRef = ref<HTMLElement | null>(null)

useSwipe(mainAreaRef, touchConfig.getSwipeOptions())

watch(shortcutOverrides, (v) => {
  localStorage.setItem('cybermanju_keybindings', JSON.stringify(v))
}, { deep: true })

shortcuts.on('toggle_sidebar', () => {})
shortcuts.on('toggle_palette', () => { store.commandPaletteOpen = !store.commandPaletteOpen })
shortcuts.on('toggle_help', () => { store.showShortcutsHelp = !store.showShortcutsHelp })
shortcuts.on('focus_search', () => { wm.open('search') })
shortcuts.on('new_folder', () => { store.createFolderPromptOpen = true })
shortcuts.on('upload_file', () => { showUploadDialog.value = true })
shortcuts.on('refresh', () => { store.fetchFiles() })
shortcuts.on('escape', () => {
  store.selectedFileId = null
  store.createFolderPromptOpen = false
})
shortcuts.on('go_back', () => { navigateInHistory(-1) })
shortcuts.on('go_forward', () => { navigateInHistory(1) })
shortcuts.on('open_trash', () => { wm.open('trash'); store.fetchTrashItems() })
shortcuts.on('open_activity', () => { wm.open('activity'); store.fetchAuditLog() })
shortcuts.on('open_collections', () => { wm.open('collections') })
shortcuts.on('open_faces', () => { wm.open('faces') })
shortcuts.on('open_map', () => { wm.open('map') })
shortcuts.on('open_code', () => { wm.open('code') })
shortcuts.on('open_settings', () => { wm.open('settings') })
shortcuts.on('open_storage', () => { wm.open('storage') })
shortcuts.on('go_home', () => { store.currentPanel = 'landing' })

function fileTypeContextMenu(file: any) {
  const base = [
    { id: 'open', label: 'OPEN', icon: 'solar:folder-open-bold', shortcut: shortcuts.getShortcut('open'), action: () => file?.select?.() },
    { id: 'preview', label: 'PREVIEW', icon: 'solar:eye-bold', shortcut: shortcuts.getShortcut('preview'), action: () => file?.preview?.() },
    { id: 'div0', label: '', divider: true },
  ]
  const typeActions: Record<string, any[]> = {
    image: [
      { id: 'rotate_cw', label: 'ROTATE CW', icon: 'solar:undo-right-round-bold', shortcut: shortcuts.getShortcut('rotate_cw'), action: () => file?.rotate?.('cw') },
      { id: 'rotate_ccw', label: 'ROTATE CCW', icon: 'solar:undo-left-round-bold', shortcut: shortcuts.getShortcut('rotate_ccw'), action: () => file?.rotate?.('ccw') },
      { id: 'div_i1', label: '', divider: true },
    ],
    audio: [
      { id: 'play', label: 'PLAY', icon: 'solar:play-bold', action: () => file?.play?.() },
      { id: 'div_a1', label: '', divider: true },
    ],
    video: [
      { id: 'play', label: 'PLAY', icon: 'solar:play-bold', action: () => file?.play?.() },
      { id: 'div_v1', label: '', divider: true },
    ],
    archive: [
      { id: 'extract', label: 'EXTRACT HERE', icon: 'solar:box-bold', action: () => file?.extract?.() },
      { id: 'div_ar1', label: '', divider: true },
    ],
    folder: [
      { id: 'open_in_new', label: 'OPEN IN NEW TAB', icon: 'solar:square-arrow-right-up-bold', action: () => file?.openNew?.() },
      { id: 'div_f1', label: '', divider: true },
      { id: 'paste_into', label: 'PASTE INTO', icon: 'solar:clipboard-paste-bold', action: () => file?.pasteInto?.() },
      { id: 'div_f2', label: '', divider: true },
    ],
  }
  const ft = file?.fileType || 'file'
  const typeSpecific = typeActions[ft] || []
  const download = { id: 'download', label: 'DOWNLOAD', icon: 'solar:download-bold', shortcut: shortcuts.getShortcut('download'), action: () => file?.download?.() }
  const star = { id: 'star', label: file?.isStarred ? 'UNSTAR' : 'STAR', icon: 'solar:star-bold', shortcut: shortcuts.getShortcut('star_file'), action: () => file?.star?.() }
  const rename = { id: 'rename', label: 'RENAME', icon: 'solar:pen-bold', shortcut: shortcuts.getShortcut('rename'), action: () => file?.rename?.() }
  const duplicate = { id: 'duplicate', label: 'DUPLICATE', icon: 'solar:copy-add-bold', shortcut: shortcuts.getShortcut('duplicate'), action: () => file?.duplicate?.() }
  const compress = { id: 'compress', label: 'COMPRESS', icon: 'solar:archive-bold', shortcut: shortcuts.getShortcut('compress'), action: () => file?.compress?.() }
  const encrypt = { id: 'encrypt', label: 'ENCRYPT', icon: 'solar:lock-bold', shortcut: shortcuts.getShortcut('encrypt'), action: () => file?.encrypt?.() }
  const decrypt = { id: 'decrypt', label: 'DECRYPT', icon: 'solar:lock-unlocked-bold', action: () => file?.decrypt?.() }
  const decompress = { id: 'decompress', label: 'DECOMPRESS', icon: 'solar:archive-up-bold', action: () => file?.decompress?.() }
  const permissions = { id: 'permissions', label: 'PERMISSIONS', icon: 'solar:key-bold', shortcut: shortcuts.getShortcut('show_permissions'), action: () => file?.permissions?.() }
  const properties = { id: 'properties', label: 'PROPERTIES', icon: 'solar:info-circle-bold', shortcut: shortcuts.getShortcut('file_properties'), action: () => file?.properties?.() }
  const deleteAction = { id: 'delete', label: 'DELETE', icon: 'solar:trash-bin-trash-bold', shortcut: shortcuts.getShortcut('delete'), action: () => file?.delete?.() }
  const transformDivider = { id: 'div_t1', label: '', divider: true }
  const metaDivider = { id: 'div_m1', label: '', divider: true }
  const dangerDivider = { id: 'div_d1', label: '', divider: true }
  return [
    ...base,
    ...typeSpecific,
    download,
    star,
    rename,
    duplicate,
    metaDivider,
    file?.encrypted ? decrypt : null,
    file?.compressionLayers?.length ? decompress : null,
    !file?.encrypted ? compress : null,
    !file?.encrypted ? encrypt : null,
    transformDivider,
    permissions,
    properties,
    dangerDivider,
    deleteAction,
  ].filter(Boolean) as any[]
}

ctx.registerContext('file_grid_item', [
  { id: 'open', label: 'OPEN', icon: 'solar:folder-open-bold', shortcut: shortcuts.getShortcut('open'), action: (d) => d?.select?.() },
  { id: 'preview', label: 'PREVIEW', icon: 'solar:eye-bold', shortcut: shortcuts.getShortcut('preview'), action: (d) => d?.preview?.() },
  { id: 'div0', label: '', divider: true },
  { id: 'download', label: 'DOWNLOAD', icon: 'solar:download-bold', shortcut: shortcuts.getShortcut('download'), action: (d) => d?.download?.() },
  { id: 'star', label: 'STAR', icon: 'solar:star-bold', shortcut: shortcuts.getShortcut('star_file'), action: (d) => d?.star?.() },
  { id: 'rename', label: 'RENAME', icon: 'solar:pen-bold', shortcut: shortcuts.getShortcut('rename'), action: (d) => d?.rename?.() },
  { id: 'duplicate', label: 'DUPLICATE', icon: 'solar:copy-add-bold', shortcut: shortcuts.getShortcut('duplicate'), action: (d) => d?.duplicate?.() },
  { id: 'div1', label: '', divider: true },
  { id: 'compress', label: 'COMPRESS', icon: 'solar:archive-bold', shortcut: shortcuts.getShortcut('compress'), action: (d) => d?.compress?.() },
  { id: 'encrypt', label: 'ENCRYPT', icon: 'solar:lock-bold', shortcut: shortcuts.getShortcut('encrypt'), action: (d) => d?.encrypt?.() },
  { id: 'decrypt', label: 'DECRYPT', icon: 'solar:lock-unlocked-bold', action: (d) => d?.decrypt?.() },
  { id: 'div2', label: '', divider: true },
  { id: 'permissions', label: 'PERMISSIONS', icon: 'solar:key-bold', shortcut: shortcuts.getShortcut('show_permissions'), action: (d) => d?.permissions?.() },
  { id: 'properties', label: 'PROPERTIES', icon: 'solar:info-circle-bold', shortcut: shortcuts.getShortcut('file_properties'), action: (d) => d?.properties?.() },
  { id: 'div3', label: '', divider: true },
  { id: 'delete', label: 'DELETE', icon: 'solar:trash-bin-trash-bold', shortcut: shortcuts.getShortcut('delete'), action: (d) => d?.delete?.() },
])

ctx.registerContext('file_grid_bg', [
  { id: 'new_folder', label: 'NEW FOLDER', icon: 'solar:add-folder-bold', shortcut: shortcuts.getShortcut('new_folder'), action: () => { store.createFolderPromptOpen = true } },
  { id: 'paste', label: 'PASTE', icon: 'solar:clipboard-paste-bold', shortcut: shortcuts.getShortcut('paste'), action: () => {} },
  { id: 'div1', label: '', divider: true },
  {
    id: 'sort', label: 'SORT BY', icon: 'solar:sort-bold', submenu: [
      { id: 'sort_name', label: 'NAME', icon: 'solar:sort-alphabetically-bold', action: () => { (store as any).sortBy = 'name' } },
      { id: 'sort_date', label: 'DATE', icon: 'solar:calendar-bold', action: () => { (store as any).sortBy = 'date' } },
      { id: 'sort_size', label: 'SIZE', icon: 'solar:sort-from-top-to-bottom-bold', action: () => { (store as any).sortBy = 'size' } },
      { id: 'sort_type', label: 'TYPE', icon: 'solar:file-type-bold', action: () => { (store as any).sortBy = 'type' } },
    ]
  },
  {
    id: 'view', label: 'VIEW MODE', icon: 'solar:grid-2x2-bold', submenu: [
      { id: 'view_grid', label: 'GRID', icon: 'solar:grid-3x3-bold', action: () => { wm.open('files'); store.viewMode = 'grid' } },
      { id: 'view_list', label: 'LIST', icon: 'solar:list-bold', action: () => { wm.open('files'); store.viewMode = 'list' } },
      { id: 'view_masonry', label: 'MASONRY', icon: 'solar:columns-3-bold', action: () => { wm.open('files'); store.viewMode = 'masonry' } },
    ]
  },
  { id: 'div2', label: '', divider: true },
  { id: 'select_all', label: 'SELECT ALL', icon: 'solar:check-square-bold', shortcut: shortcuts.getShortcut('select_all'), action: () => { store.selectedFileIds = [...store.files.map(f => f.id)] } },
  { id: 'deselect', label: 'DESELECT', icon: 'solar:close-square-bold', shortcut: shortcuts.getShortcut('deselect'), action: () => { store.selectedFileIds = [] } },
  { id: 'div3', label: '', divider: true },
  {
    id: 'go_to', label: 'GO TO', icon: 'solar:point-on-map-bold', submenu: [
      { id: 'go_home', label: 'HOME', icon: 'solar:house-bold', action: () => { store.currentPanel = 'landing' } },
      { id: 'go_trash', label: 'TRASH', icon: 'solar:trash-bin-trash-bold', action: () => { wm.open('trash'); store.fetchTrashItems() } },
      { id: 'go_recent', label: 'RECENT', icon: 'solar:history-bold', action: () => { wm.open('recent') } },
      { id: 'go_favorites', label: 'FAVORITES', icon: 'solar:star-bold', action: () => { wm.open('favorites') } },
    ]
  },
  { id: 'div4', label: '', divider: true },
  { id: 'refresh', label: 'REFRESH', icon: 'solar:refresh-bold', shortcut: shortcuts.getShortcut('refresh'), action: () => store.fetchFiles() },
])

ctx.registerContext('sidebar_node', [
  { id: 'open', label: 'OPEN', icon: 'solar:folder-open-bold', action: (d) => d?.select?.() },
  { id: 'open_new_tab', label: 'OPEN IN NEW TAB', icon: 'solar:square-arrow-right-up-bold', action: (d) => d?.openNewTab?.() },
  { id: 'div1', label: '', divider: true },
  { id: 'new_subfolder', label: 'NEW SUBFOLDER', icon: 'solar:add-folder-bold', action: (d) => d?.newSubfolder?.() },
  { id: 'rename', label: 'RENAME', icon: 'solar:pen-bold', action: (d) => d?.rename?.() },
  { id: 'duplicate', label: 'DUPLICATE', icon: 'solar:copy-add-bold', action: (d) => d?.duplicate?.() },
  { id: 'div2', label: '', divider: true },
  { id: 'paste_into', label: 'PASTE INTO', icon: 'solar:clipboard-paste-bold', action: (d) => d?.pasteInto?.() },
  { id: 'div3', label: '', divider: true },
  { id: 'expand', label: 'EXPAND ALL', icon: 'solar:chevrons-up-down-bold', action: (d) => d?.expandAll?.() },
  { id: 'collapse', label: 'COLLAPSE ALL', icon: 'solar:chevrons-down-up-bold', action: (d) => d?.collapseAll?.() },
  { id: 'div4', label: '', divider: true },
  { id: 'delete', label: 'DELETE', icon: 'solar:trash-bin-trash-bold', action: (d) => d?.delete?.() },
])

ctx.registerContext('sidebar_bg', [
  { id: 'new_folder', label: 'NEW FOLDER', icon: 'solar:add-folder-bold', shortcut: shortcuts.getShortcut('new_folder'), action: () => { store.createFolderPromptOpen = true } },
  { id: 'refresh', label: 'REFRESH', icon: 'solar:refresh-bold', shortcut: shortcuts.getShortcut('refresh'), action: () => store.fetchFiles() },
  { id: 'div1', label: '', divider: true },
  { id: 'expand', label: 'EXPAND ALL', icon: 'solar:chevrons-up-down-bold', action: () => {} },
  { id: 'collapse', label: 'COLLAPSE ALL', icon: 'solar:chevrons-down-up-bold', action: () => {} },
  { id: 'div2', label: '', divider: true },
  { id: 'show_trash', label: 'SHOW TRASH', icon: 'solar:trash-bin-trash-bold', action: () => { wm.open('trash'); store.fetchTrashItems() } },
  { id: 'show_storage', label: 'STORAGE DASHBOARD', icon: 'solar:database-bold', action: () => { wm.open('storage') } },
])

ctx.registerContext('search_result', [
  { id: 'open', label: 'OPEN', icon: 'solar:folder-open-bold', action: (d) => d?.select?.() },
  { id: 'preview', label: 'PREVIEW', icon: 'solar:eye-bold', action: (d) => d?.preview?.() },
  { id: 'download', label: 'DOWNLOAD', icon: 'solar:download-bold', action: (d) => d?.download?.() },
  { id: 'star', label: 'STAR', icon: 'solar:star-bold', action: (d) => d?.star?.() },
  { id: 'div1', label: '', divider: true },
  { id: 'copy_path', label: 'COPY PATH', icon: 'solar:copy-bold', action: (d) => d?.copyPath?.() },
  { id: 'show_in_folder', label: 'SHOW IN FOLDER', icon: 'solar:folder-search-bold', action: (d) => d?.showInFolder?.() },
  { id: 'div2', label: '', divider: true },
  { id: 'properties', label: 'PROPERTIES', icon: 'solar:info-circle-bold', action: (d) => d?.properties?.() },
])

ctx.registerContext('collection_item', [
  { id: 'open', label: 'OPEN COLLECTION', icon: 'solar:folder-open-bold', action: (d) => d?.open?.() },
  { id: 'rename', label: 'RENAME', icon: 'solar:pen-bold', action: (d) => d?.rename?.() },
  { id: 'div1', label: '', divider: true },
  { id: 'add_files', label: 'ADD FILES', icon: 'solar:file-add-bold', action: (d) => d?.addFiles?.() },
  { id: 'remove_files', label: 'REMOVE FILES', icon: 'solar:file-minus-bold', action: (d) => d?.removeFiles?.() },
  { id: 'div2', label: '', divider: true },
  { id: 'share', label: 'SHARE', icon: 'solar:share-bold', action: (d) => d?.share?.() },
  { id: 'delete', label: 'DELETE COLLECTION', icon: 'solar:trash-bin-trash-bold', action: (d) => d?.delete?.() },
])

ctx.registerContext('face_item', [
  { id: 'rename', label: 'RENAME', icon: 'solar:pen-bold', action: (d) => d?.rename?.() },
  { id: 'merge', label: 'MERGE WITH...', icon: 'solar:git-branch-bold', action: (d) => d?.merge?.() },
  { id: 'div1', label: '', divider: true },
  { id: 'show_files', label: 'SHOW FILES', icon: 'solar:folder-with-files-bold', action: (d) => d?.showFiles?.() },
  { id: 'delete', label: 'DELETE GROUP', icon: 'solar:trash-bin-trash-bold', action: (d) => d?.delete?.() },
])

ctx.registerContext('trash_item', [
  { id: 'restore', label: 'RESTORE', icon: 'solar:undo-left-round-bold', action: (d) => d?.restore?.() },
  { id: 'div1', label: '', divider: true },
  { id: 'delete_perm', label: 'DELETE PERMANENTLY', icon: 'solar:trash-bin-trash-bold', action: (d) => d?.deletePermanently?.() },
])

ctx.registerContext('activity_item', [
  { id: 'copy_details', label: 'COPY DETAILS', icon: 'solar:copy-bold', action: (d) => d?.copyDetails?.() },
  { id: 'show_file', label: 'SHOW FILE', icon: 'solar:file-search-bold', action: (d) => d?.showFile?.() },
])

ctx.registerContext('favorite_item', [
  { id: 'open', label: 'OPEN', icon: 'solar:folder-open-bold', action: (d) => d?.open?.() },
  { id: 'unstar', label: 'UNSTAR', icon: 'solar:star-off-bold', action: (d) => d?.unstar?.() },
  { id: 'div1', label: '', divider: true },
  { id: 'show_in_folder', label: 'SHOW IN FOLDER', icon: 'solar:folder-search-bold', action: (d) => d?.showInFolder?.() },
])

ctx.registerContext('recent_item', [
  { id: 'open', label: 'OPEN', icon: 'solar:folder-open-bold', action: (d) => d?.open?.() },
  { id: 'star', label: 'STAR', icon: 'solar:star-bold', action: (d) => d?.star?.() },
  { id: 'div1', label: '', divider: true },
  { id: 'show_in_folder', label: 'SHOW IN FOLDER', icon: 'solar:folder-search-bold', action: (d) => d?.showInFolder?.() },
])

const pathHistory = ref<string[]>([])
const pathHistoryIndex = ref(-1)

function navigateToPath(path: string) {
  const fullPath = '/' + path
  if (pathHistoryIndex.value < pathHistory.value.length - 1) {
    pathHistory.value = pathHistory.value.slice(0, pathHistoryIndex.value + 1)
  }
  pathHistory.value.push(fullPath)
  pathHistoryIndex.value = pathHistory.value.length - 1
  store.currentPath = fullPath
  store.fetchFiles(fullPath)
}

function goBack() {
  if (pathHistoryIndex.value > 0) {
    pathHistoryIndex.value--
    const path = pathHistory.value[pathHistoryIndex.value]
    store.currentPath = path
    store.fetchFiles(path)
  }
}

function goForward() {
  if (pathHistoryIndex.value < pathHistory.value.length - 1) {
    pathHistoryIndex.value++
    const path = pathHistory.value[pathHistoryIndex.value]
    store.currentPath = path
    store.fetchFiles(path)
  }
}

function navigateInHistory(dir: number) {
  if (dir < 0) goBack()
  else goForward()
}

watch(() => store.createFolderPromptOpen, async (v: boolean) => {
  if (v) {
    newFolderName.value = ''
    await nextTick()
    folderInputRef.value?.focus()
  }
})

async function handleCreateFolder() {
  if (!newFolderName.value.trim()) return
  await store.createFolder(newFolderName.value.trim(), store.selectedFileId || '')
  newFolderName.value = ''
  store.createFolderPromptOpen = false
}

function handleUpload() {
  showUploadDialog.value = true
}

/**
 * Ctrl+` opens the system terminal (AGENT-8 item 11). Registered here rather
 * than in the `.kpl` profile so the binding exists in every build, including
 * ones that load a custom profile without an `open_terminal` action.
 */
function toggleTerminal(event: KeyboardEvent) {
  if (!event.ctrlKey || event.shiftKey || event.altKey) return
  if (event.key !== '`' && event.key !== '~' && event.key !== 'Dead') return
  event.preventDefault()
  wm.open('terminal')
}

/**
 * Ctrl+E opens the code editor next to the terminal binding above.
 * The editor itself handles Ctrl+S (save); Escape stays global.
 */
function openEditor(event: KeyboardEvent) {
  if (!event.ctrlKey && !event.metaKey) return
  if (event.shiftKey || event.altKey) return
  if (event.key.toLowerCase() !== 'e') return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  event.preventDefault()
  wm.open('editor')
}

/**
 * Ctrl+G opens the AI agent panel. Skipped inside inputs like the editor
 * binding above so typing is never hijacked.
 */
function openAgent(event: KeyboardEvent) {
  if (!event.ctrlKey && !event.metaKey) return
  if (event.shiftKey || event.altKey) return
  if (event.key.toLowerCase() !== 'g') return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  event.preventDefault()
  wm.open('agent')
}

const openAccountsWindow = () => wm.open('accounts')

onMounted(() => {
  store.currentPanel = 'landing'
  store.initialize()
  // OAuth return (Supabase PKCE popup or full-redirect): exchange ?code=,
  // stash the provider token, close popup returns.
  void finishSupabaseReturn().then(async (handled) => {
    if (handled) store.notifySuccess('OAuth return processed — token captured')
    await refreshIdentity()
  })
  // Vault boot: migrate anything an older build left in localStorage into
  // `.cybermanju`, restore the Supabase URL/key from the file, re-attach the
  // remembered file (permission/passphrase gated), then fill the OS volume
  // from the vault. Volume mirroring starts first so replayed writes push
  // straight back into the file.
  startVolumeMirror()
  void (async () => {
    try {
      await migrateVaultFromLocalStorage()
      await hydrateSupabaseConfig()
      await bootCyberManjuDisk()
      await replayVolumeFromVault(disk.attached)
      if (disk.attached) store.notifySuccess(`${disk.name} opened — vault is on disk`)
    } catch (e) {
      store.notifyError('Vault boot failed', e)
    }
  })()
  window.addEventListener('cybermanju:upload', handleUpload)
  window.addEventListener('cybermanju:open-accounts', openAccountsWindow)
  window.addEventListener('keydown', toggleTerminal)
  window.addEventListener('keydown', openEditor)
  window.addEventListener('keydown', openAgent)
  window.addEventListener('pagehide', () => void flushVolumeMirror())
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', toggleTerminal)
  window.removeEventListener('keydown', openEditor)
  window.removeEventListener('keydown', openAgent)
  window.removeEventListener('cybermanju:open-accounts', openAccountsWindow)
})
</script>

<template>
  <div class="cybermanju-shell">
    <LandingPage
      v-if="store.currentPanel === 'landing'"
      @open-app="store.currentPanel = 'files'; wm.open('files')"
    />
    <template v-else>
      <DesktopShell>
        <template #wallpaper>
          <CanvasEngine :enabled="store.matrixRainEnabled" />
        </template>
      </DesktopShell>

      <div v-if="store.lastError" class="error-banner" @click="store.clearError()">
      <span class="error-icon"><AppIcon name="solar:danger-circle-bold" /></span>
      <span class="error-text">{{ store.lastError }}</span>
      <span class="error-dismiss">X</span>
    </div>

    <Teleport to="body">
      <div v-if="store.createFolderPromptOpen" class="overlay-thin" @click.self="store.createFolderPromptOpen = false">
        <div class="mini-modal">
          <div class="mini-header">NEW FOLDER</div>
          <UiInput
            ref="folderInputRef"
            v-model="newFolderName"
            class="mini-input"
            placeholder="FOLDER NAME"
            @enter="handleCreateFolder"
          />
          <div class="mini-actions">
            <UiButton variant="ghost" size="sm" icon="solar:close-bold" @click="store.createFolderPromptOpen = false">CANCEL</UiButton>
            <UiButton variant="primary" size="sm" icon="solar:add-bold" @click="handleCreateFolder">CREATE</UiButton>
          </div>
        </div>
      </div>
    </Teleport>

    <NotificationStack />
    <CommandPalette />
    <KeyboardShortcutsHelp />
    <ConfirmDialog
      :visible="confirmVisible"
      :title="confirmTitle"
      :message="confirmMessage"
      @confirm="confirmVisible = false"
      @cancel="confirmVisible = false"
      @update:visible="confirmVisible = $event"
    />
    <FileUploadDialog
      :visible="showUploadDialog"
      @close="showUploadDialog = false"
    />
    <MobileNav />
    <ContextMenu />

    </template>
    </div>
</template>

<style scoped>
.cybermanju-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--ui-bg);
  color: var(--ui-text);
  overflow: hidden;
  position: relative;
}

.error-banner {
  position: fixed;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  border: 1px solid color-mix(in srgb, var(--ui-danger) 55%, transparent);
  border-radius: var(--ui-radius-full);
  color: var(--ui-danger);
  font-family: var(--ui-font-mono);
  font-size: var(--ui-fs-xs);
  font-weight: 600;
  cursor: pointer;
  z-index: 9999;
  box-shadow: var(--ui-shadow-3), 0 0 24px color-mix(in srgb, var(--ui-danger) 18%, transparent);
  animation: ui-rise var(--ui-dur) var(--ui-ease-spring);
}

.error-banner:hover {
  background: var(--ui-surface-2);
}

.error-icon { font-size: 12px; flex-shrink: 0; display: flex; }
.error-text { flex: 1; }
.error-dismiss {
  font-weight: 700;
  cursor: pointer;
  margin-left: 8px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ui-radius-full);
  background: color-mix(in srgb, var(--ui-danger) 16%, transparent);
}

.overlay-thin {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--ui-bg-deep) 62%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  animation: ui-fade-in var(--ui-dur) var(--ui-ease-out);
}

.mini-modal {
  background: var(--ui-glass-2);
  backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate));
  border: 1px solid var(--ui-border-strong);
  border-radius: var(--ui-radius-lg);
  box-shadow: var(--ui-shadow-3), inset 0 1px 0 var(--ui-glass-highlight);
  padding: 20px;
  width: 320px;
  font-family: var(--ui-font);
  animation: ui-pop var(--ui-dur) var(--ui-ease-spring);
}

.mini-header {
  font-size: var(--ui-fs-md);
  font-weight: 800;
  color: var(--ui-text);
  margin-bottom: 12px;
  letter-spacing: var(--ui-tracking-wide);
}

.mini-input {
  width: 100%;
  margin-bottom: 14px;
}

.mini-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.text-muted { color: color-mix(in srgb, var(--ui-text) 50%, transparent) !important; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
