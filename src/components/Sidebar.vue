<template>
  <aside class="sidebar" :class="{ collapsed: store.sidebarCollapsed }">
    <div v-if="!store.sidebarCollapsed" class="sidebar-account">
      <div class="bw-dot" :class="{ 'bw-dot-on': store.activeAccount }" />
      <span class="sidebar-account-name">{{ store.activeAccount?.name || 'NO_ACCOUNT' }}</span>
    </div>

    <div class="sidebar-tabs" role="tablist" aria-label="SIDEBAR SECTIONS">
      <button
        v-for="tab in sectionTabs"
        :key="tab.id"
        class="sidebar-tab"
        :class="{ active: store.sidebarSection === tab.id }"
        :title="tab.label"
        :aria-label="tab.label"
        :aria-selected="store.sidebarSection === tab.id ? 'true' : 'false'"
        role="tab"
        @click="store.sidebarSection = tab.id as SidebarSection; if (tab.id === 'landing') store.currentPanel = 'landing'"
      >
        <span class="tab-icon"><AppIcon :name="tab.icon" :size="14" /></span>
        <span v-if="!store.sidebarCollapsed" class="tab-label">{{ tab.label }}</span>
      </button>
    </div>

    <div v-if="!store.sidebarCollapsed" class="sidebar-content">
      <div v-if="store.sidebarSection === 'landing'" class="sidebar-section">
        <div class="section-header">QUICK LINKS</div>
        <div class="quick-links">
          <button class="ql-item" @click="wm.open('files')"><AppIcon name="solar:folder-open-bold" :size="12" /> FILE BROWSER</button>
          <button class="ql-item" @click="wm.open('sync')"><AppIcon name="solar:cloud-bold" :size="12" /> CLOUD SYNC</button>
          <button class="ql-item" @click="wm.open('terminal')">[&gt;] TERMINAL (cybsh)</button>
          <button class="ql-item" @click="wm.open('disks')"><AppIcon name="solar:ssd-square-bold" :size="12" /> DISKS &amp; VOLUME</button>
          <a href="https://github.com/cybermanju/cybermanju.github.io" target="_blank" class="ql-item"><AppIcon name="solar:code-square-bold" :size="12" /> SOURCE CODE</a>
          <a href="https://github.com/cybermanju/cybermanju.github.io/blob/main/README.md" target="_blank" class="ql-item"><AppIcon name="solar:book-bold" :size="12" /> DOCS</a>
        </div>
      </div>

      <div v-if="store.sidebarSection === 'tree'" class="sidebar-section"
        @contextmenu.prevent="showTreeContextMenu($event)"
      >
        <div class="section-header">FILE TREE</div>
        <div class="tree-container">
          <TreeNode
            v-for="folder in rootFolders"
            :key="folder.id"
            :node="folder"
            :depth="0"
            @select="store.selectFile"
          />
          <div v-if="rootFolders.length === 0" class="empty-section text-muted">NO FOLDERS</div>
        </div>
        <div class="section-header" title="Read-only provider mounts under providers/<id>/…">PROVIDERS (READ-ONLY)</div>
        <div class="provider-block">
          <div v-if="vfsError" class="vfs-error">{{ vfsError }}</div>
          <div
            v-for="m in vfsMounts"
            :key="m.id"
            class="vfs-mount"
          >
            <div class="sidebar-item" @click="toggleVfsMount(m.id)">
              <span class="tree-arrow">{{ vfsOpen[m.id] ? '▾' : '▸' }}</span>
              <div class="bw-dot bw-dot-on" />
              <div class="item-info">
                <span class="item-name truncate">{{ m.name }}</span>
                <span class="item-meta text-muted">{{ m.backendType }}</span>
              </div>
              <button class="vfs-del" title="Remove mount" @click.stop="removeVfsMount(m.id)">✕</button>
            </div>
            <div v-if="vfsOpen[m.id]" class="vfs-children">
              <div v-if="vfsLoading[m.id]" class="empty-section text-muted">LOADING…</div>
              <div
                v-for="e in vfsEntries[m.id] ?? []"
                :key="e.locator || e.path"
                class="tree-node-row vfs-entry"
                @click="openVfsEntry(m.id, e)"
              >
                <span class="tree-arrow">{{ e.isDir ? '▸' : '·' }}</span>
                <span class="tree-name truncate">{{ e.name }}</span>
              </div>
              <div v-if="!(vfsEntries[m.id] ?? []).length && !vfsLoading[m.id]" class="empty-section text-muted">EMPTY</div>
            </div>
          </div>
          <div v-if="!vfsMounts.length" class="empty-section text-muted">NO MOUNTS</div>
          <div v-if="vfsPreview" class="vfs-preview">
            <div class="vfs-preview-head">
              <span class="truncate">{{ vfsPreviewTitle }}</span>
              <button class="vfs-del" title="Close preview" @click="vfsPreview = null; vfsPreviewTitle = ''">✕</button>
            </div>
            <pre class="vfs-preview-body">{{ vfsPreview }}</pre>
          </div>
          <div class="vfs-add">
            <select v-model="vfsNewConfig" class="vfs-select" aria-label="Sync config to mount">
              <option value="">SELECT SYNC CONFIG…</option>
              <option v-for="c in store.syncConfigs" :key="c.id" :value="c.id">{{ c.backendType }} · {{ (c.repoName || c.basePath || c.id).slice(0, 24) }}</option>
            </select>
            <button class="bw-btn" style="font-size:10px;" :disabled="!vfsNewConfig" @click="addVfsMount">+ MOUNT</button>
          </div>
          <p class="text-muted" style="font-size:9px;padding:4px 8px;">CORS-OK ONLY: GITHUB · GITLAB · DRIVE.</p>
        </div>
      </div>

      <div v-if="store.sidebarSection === 'locations'" class="sidebar-section">
        <div class="section-header">LOCATIONS</div>
        <div class="location-list">
          <div
            v-for="account in store.accounts"
            :key="account.id"
            class="sidebar-item"
            :class="{ active: account.id === store.activeAccountId }"
            @click="store.switchAccount(account.id)"
          >
            <div class="bw-dot" :class="{ 'bw-dot-on': account.id === store.activeAccountId }" />
            <span class="item-name truncate">{{ account.name }}</span>
            <span class="item-meta text-muted">{{ account.accountType }}</span>
          </div>
        </div>
      </div>

      <div v-if="store.sidebarSection === 'collections'" class="sidebar-section">
        <div class="section-header">COLLECTIONS</div>
        <div class="collection-list">
          <div
            v-for="col in store.collections"
            :key="col.id"
            class="sidebar-item"
          >
            <div class="bw-dot bw-dot-on" />
            <div class="item-info">
              <span class="item-name truncate">{{ col.name }}</span>
              <span class="item-meta text-muted">{{ col.collectionType }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="store.sidebarSection === 'people'" class="sidebar-section">
        <div class="section-header">PEOPLE</div>
        <div class="people-list">
          <div
            v-for="face in store.faceGroups"
            :key="face.id"
            class="sidebar-item"
          >
            <div class="avatar-circle">
              <span>++</span>
            </div>
            <div class="item-info">
              <span class="item-name truncate">{{ face.name }}</span>
              <span class="item-meta text-muted">{{ face.fileIds.length }} FILES</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="store.sidebarSection === 'styles'" class="sidebar-section">
        <div class="section-header section-header--link" @click="wm.open('style')" title="OPEN STYLE TAGS PANEL">TAGS &gt;</div>
        <div class="tag-cloud">
          <span v-if="allTags.length === 0" class="text-muted" style="font-size:10px;padding:8px;">NO TAGS</span>
          <span
            v-for="tag in allTags"
            :key="tag"
            class="tag-item"
            @click="store.searchQuery = tag; wm.open('search'); store.searchFiles(tag)"
          >
            {{ tag }}
          </span>
        </div>
      </div>

      <div v-if="store.sidebarSection === 'loose'" class="sidebar-section">
        <div class="section-header section-header--link" @click="wm.open('loose-groups')" title="OPEN LOOSE GROUPS PANEL">LOOSE GROUPS &gt;</div>
        <div class="loose-list">
          <div
            v-for="group in store.looseGroups"
            :key="group.id"
            class="sidebar-item"
          >
            <div class="bw-dot bw-dot-on" />
            <div class="item-info">
              <span class="item-name truncate">{{ group.name }}</span>
              <span class="item-meta text-muted">{{ group.fileIds.length }} FILES</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="store.sidebarSection === 'users'" class="sidebar-section">
        <div class="section-header" @click="wm.open('users')">USER ACCESS &gt;</div>
        <div class="section-body">
          <p class="text-muted" style="font-size:10px;padding:8px 0;">PER-FILE USERNAME + PASSWORD AUTH WITH ARGON2</p>
          <button class="bw-btn" style="width:100%;font-size:10px;" @click="wm.open('users')"><AppIcon name="solar:square-arrow-right-up-bold" :size="12" /> USER MGMT</button>
        </div>
      </div>

      <div v-if="store.sidebarSection === 'sync'" class="sidebar-section">
        <div class="section-header" @click="wm.open('sync')">STORAGE SYNC &gt;</div>
        <div class="section-body">
          <p class="text-muted" style="font-size:10px;padding:8px 0;">SYNC TO LOCAL, GITHUB, GDRIVE</p>
          <div class="sync-backend-list">
            <div v-for="config in store.syncConfigs" :key="config.id" class="sidebar-item" style="margin-bottom:2px;" @click="wm.open('sync')">
              <div class="bw-dot" :class="{ 'bw-dot-on': config.enabled }" />
              <div class="item-info">
                <span class="item-name truncate">{{ config.backendType }}</span>
              </div>
            </div>
          </div>
          <button class="bw-btn" style="width:100%;font-size:10px;margin-top:6px;" @click="wm.open('sync')"><AppIcon name="solar:square-arrow-right-up-bold" :size="12" /> SYNC PANEL</button>
          <button class="bw-btn" style="width:100%;font-size:10px;margin-top:4px;" @click="wm.open('accounts')"><AppIcon name="solar:square-arrow-right-up-bold" :size="12" /> ACCOUNTS + OAUTH</button>
        </div>
      </div>

      <div v-if="store.sidebarSection === 'dashboard'" class="sidebar-section">
        <div class="section-header" @click="wm.open('dashboard')">REMOTE ACCESS &gt;</div>
        <div class="section-body">
          <p class="text-muted" style="font-size:10px;padding:8px 0;">WEB DASHBOARD ON PORT 3456</p>
          <div class="bw-card" style="padding:6px;margin-bottom:6px;">
            <code style="font-size:10px;color:#000;">{{ dashboardUrl }}</code>
          </div>
          <button class="bw-btn" style="width:100%;font-size:10px;" @click="wm.open('dashboard')"><AppIcon name="solar:square-arrow-right-up-bold" :size="12" /> DASHBOARD</button>
        </div>
      </div>

      <div v-if="store.sidebarSection === 'tools'" class="sidebar-section">
        <div class="section-header">TOOLS</div>
        <div class="tools-list">
          <button class="ql-item" @click="wm.open('terminal')" aria-label="OPEN TERMINAL">[&gt;] TERMINAL (cybsh)</button>
          <button class="ql-item" @click="wm.open('processes')" aria-label="OPEN TASKS"><AppIcon name="solar:cpu-bold" :size="12" /> TASKS (ps/top)</button>
          <button class="ql-item" @click="wm.open('disks')" aria-label="OPEN DISKS"><AppIcon name="solar:ssd-square-bold" :size="12" /> DISKS &amp; VOLUME</button>
          <button class="ql-item" @click="wm.open('favorites')" aria-label="OPEN FAVORITES"><AppIcon name="solar:star-bold" :size="12" /> FAVORITES ({{ store.starredFiles.length }})</button>
          <button class="ql-item" @click="wm.open('recent')" aria-label="OPEN RECENT FILES"><AppIcon name="solar:history-bold" :size="12" /> RECENT FILES</button>
          <button class="ql-item" @click="wm.open('activity'); store.fetchAuditLog()" aria-label="OPEN ACTIVITY LOG"><AppIcon name="solar:pulse-bold" :size="12" /> ACTIVITY LOG</button>
          <button class="ql-item" @click="wm.open('storage')" aria-label="OPEN STORAGE DASHBOARD"><AppIcon name="solar:database-bold" :size="12" /> STORAGE</button>
          <button class="ql-item" @click="wm.open('loose-groups')" aria-label="OPEN LOOSE GROUPS"><AppIcon name="solar:users-group-two-rounded-bold" :size="12" /> LOOSE GROUPS</button>
          <button class="ql-item" @click="wm.open('style')" aria-label="OPEN STYLE TAGS"><AppIcon name="solar:tag-bold" :size="12" /> STYLE TAGS</button>
          <button class="ql-item" @click="wm.open('webdash')" aria-label="OPEN OVERLAY DASHBOARD"><AppIcon name="solar:kanban-square-bold" :size="12" /> OVERLAY</button>
          <button class="ql-item" @click="wm.open('settings')" aria-label="OPEN SETTINGS"><AppIcon name="solar:settings-bold" :size="12" /> SETTINGS</button>
          <button class="ql-item" @click="wm.open('trash'); store.fetchTrashItems()" aria-label="OPEN TRASH"><AppIcon name="solar:trash-bin-trash-bold" :size="12" /> TRASH</button>
        </div>
      </div>
    </div>

    <div v-if="!store.sidebarCollapsed" class="sidebar-bottom">
      <button class="qa-btn" @click="store.fetchGeoFiles(); wm.open('map')" aria-label="OPEN MAP VIEW" title="MAP"><AppIcon name="solar:map-bold" :size="16" /></button>
      <button class="qa-btn" @click="store.fetchCollections(); store.sidebarSection = 'collections'" aria-label="OPEN COLLECTIONS" title="COLLECTIONS"><AppIcon name="solar:library-bold" :size="16" /></button>
      <button class="qa-btn" @click="store.detectFaces(store.selectedFileId || '')" aria-label="DETECT FACES" title="DETECT FACES"><AppIcon name="solar:face-scan-circle-bold" :size="16" /></button>
    </div>

    <button class="collapse-btn" @click="store.sidebarCollapsed = !store.sidebarCollapsed" :aria-label="store.sidebarCollapsed ? 'EXPAND SIDEBAR' : 'COLLAPSE SIDEBAR'">
      <span style="display:inline-block;transform:rotate(store.sidebarCollapsed ? 0deg : 180deg)">^</span>
    </button>


  </aside>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import { useContextMenu } from '@/composables/useContextMenu'
import { isWebMode } from '@/composables/useTauri'
import type { SidebarSection } from '@/types'
import TreeNode from './TreeNode.vue'
import type { ProviderMount, VfsEntry } from '@/composables/useProviderCanal'

const vfsMounts = ref<ProviderMount[]>([])
const vfsOpen = ref<Record<string, boolean>>({})
const vfsEntries = ref<Record<string, VfsEntry[]>>({})
const vfsLoading = ref<Record<string, boolean>>({})
const vfsError = ref('')
const vfsNewConfig = ref('')
const vfsPreview = ref<string | null>(null)
const vfsPreviewTitle = ref('')

async function refreshVfsMounts() {
  try {
    const { listVfsMounts } = await import('@/composables/useProviderCanal')
    vfsMounts.value = await listVfsMounts()
    vfsError.value = ''
  } catch (e) {
    vfsError.value = e instanceof Error ? e.message : String(e)
  }
}

async function toggleVfsMount(id: string) {
  vfsOpen.value[id] = !vfsOpen.value[id]
  if (!vfsOpen.value[id] || vfsEntries.value[id]) return
  vfsLoading.value[id] = true
  try {
    const { listVfsDir } = await import('@/composables/useProviderCanal')
    vfsEntries.value[id] = await listVfsDir(id, '')
    vfsError.value = ''
  } catch (e) {
    vfsError.value = e instanceof Error ? e.message : String(e)
  } finally {
    vfsLoading.value[id] = false
  }
}

async function openVfsEntry(mountId: string, entry: VfsEntry) {
  if (entry.isDir) return
  try {
    const { readVfsFile } = await import('@/composables/useProviderCanal')
    const file = await readVfsFile(mountId, entry.path, { locator: entry.locator })
    vfsPreviewTitle.value = entry.path
    vfsPreview.value = file.text ?? `[${file.magic} — binary, ${file.bytes.byteLength} bytes]`
    vfsError.value = ''
  } catch (e) {
    vfsError.value = e instanceof Error ? e.message : String(e)
  }
}

async function addVfsMount() {
  if (!vfsNewConfig.value) return
  try {
    const cfg = store.syncConfigs.find(c => c.id === vfsNewConfig.value)
    const { saveVfsMount } = await import('@/composables/useProviderCanal')
    await saveVfsMount({
      configId: vfsNewConfig.value,
      name: cfg ? `${cfg.backendType}` : vfsNewConfig.value,
      backendType: cfg?.backendType ?? 'github',
      basePath: (cfg?.basePath as string | undefined) ?? '',
    })
    vfsNewConfig.value = ''
    await refreshVfsMounts()
  } catch (e) {
    vfsError.value = e instanceof Error ? e.message : String(e)
  }
}

async function removeVfsMount(id: string) {
  try {
    const { deleteVfsMount } = await import('@/composables/useProviderCanal')
    await deleteVfsMount(id)
    delete vfsEntries.value[id]
    delete vfsOpen.value[id]
    await refreshVfsMounts()
  } catch (e) {
    vfsError.value = e instanceof Error ? e.message : String(e)
  }
}

void refreshVfsMounts()

const ctx = useContextMenu()

const store = useAppStore()
const wm = useWindowManager()

const dashboardUrl = computed(() => {
  if (typeof window !== 'undefined' && window.location?.port === '3456') {
    return window.location.origin
  }
  return 'HTTP://LOCALHOST:3456'
})

const allTags = computed<string[]>(() => {
  const tagSet = new Set<string>()
  store.files.forEach(f => f.tags?.forEach(t => tagSet.add(t)))
  return [...tagSet].sort()
})

const sectionTabs = computed(() => {
  const tabs: { id: string; label: string; icon: string }[] = []
  if (isWebMode()) {
    tabs.push({ id: 'landing', label: 'HOME', icon: 'solar:house-bold' })
  }
  tabs.push(
    { id: 'tree', label: 'TREE', icon: 'solar:folder-tree-bold' },
    { id: 'locations', label: 'LOCS', icon: 'solar:map-point-bold' },
    { id: 'collections', label: 'COLS', icon: 'solar:library-bold' },
    { id: 'people', label: 'PEOPLE', icon: 'solar:face-scan-circle-bold' },
    { id: 'styles', label: 'TAGS', icon: 'solar:tag-bold' },
    { id: 'loose', label: 'LOOSE', icon: 'solar:users-group-two-rounded-bold' },
    { id: 'sync', label: 'SYNC', icon: 'solar:refresh-bold' },
    { id: 'users', label: 'USERS', icon: 'solar:users-group-rounded-bold' },
    { id: 'dashboard', label: 'REMOTE', icon: 'solar:globe-bold' },
    { id: 'tools', label: 'TOOLS', icon: 'solar:toolbox-bold' },
  )
  return tabs
})

const rootFolders = computed(() =>
  store.files.filter(f => f.fileType === 'folder' && !f.parentId)
)

function showTreeContextMenu(e: MouseEvent) {
  ctx.open(e, 'sidebar_bg')
}
</script>

<style scoped>
.sidebar {
  grid-area: sidebar;
  width: 240px;
  min-width: 48px;
  display: flex;
  flex-direction: column;
  background: var(--ui-surface);
  border-right: 1px solid var(--ui-border);
  overflow: hidden;
  transition: width 0.15s;
  position: relative;
  z-index: 5;
}

.sidebar.collapsed {
  width: 48px;
}

.sidebar-account {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 6px;
  border-bottom: 1px solid var(--ui-border);
}

.sidebar-account-name {
  font-family: var(--ui-font);
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-text);
  text-transform: uppercase;
}

.sidebar-tabs {
  display: flex;
  flex-direction: column;
  padding: 4px;
  gap: 1px;
  border-bottom: 1px solid var(--ui-border);
}

.sidebar-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  color: color-mix(in srgb, var(--ui-text) 50%, transparent);
  font-size: 10px;
  font-family: var(--ui-font);
  font-weight: 700;
  border: 2px solid transparent;
}

.sidebar-tab:hover {
  color: var(--ui-text);
  border-color: var(--ui-border-strong);
}

.sidebar-tab.active {
  color: var(--ui-text);
  background: var(--ui-glass-2);
}

.tab-icon {
  font-family: var(--ui-font);
  font-size: 11px;
  width: 20px;
  text-align: center;
}

.tab-label {
  white-space: nowrap;
  font-size: 10px;
  letter-spacing: 0.5px;
}

.quick-links {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ql-item {
  display: block;
  padding: 6px 10px;
  font-family: var(--ui-font);
  font-size: 10px;
  color: color-mix(in srgb, var(--ui-text) 70%, transparent);
  cursor: pointer;
  text-decoration: none;
  border: none;
  background: transparent;
  text-align: left;
}

.ql-item:hover {
  background: var(--ui-glass-2);
  color: var(--ui-text);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar-section {
  padding: 6px;
}

.section-header {
  font-family: var(--ui-font);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  color: color-mix(in srgb, var(--ui-text) 40%, transparent);
  padding: 4px 8px;
  cursor: default;
}

.section-header:hover {
  color: var(--ui-text);
}

.section-header--link {
  cursor: pointer;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  margin-bottom: 2px;
  cursor: pointer;
  border: 2px solid transparent;
}

.sidebar-item:hover {
  border-color: var(--ui-border-strong);
}

.sidebar-item.active {
  background: var(--ui-glass-2);
}

.sidebar-item.active .item-name {
  color: var(--ui-text);
}

.item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.item-name {
  font-size: 11px;
  color: var(--ui-text);
  font-weight: 500;
}

.item-meta {
  font-size: 9px;
  font-family: var(--ui-font);
}

.avatar-circle {
  width: 24px;
  height: 24px;
  border: 1px solid var(--ui-border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 9px;
  color: var(--ui-text);
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
}

.tag-item {
  display: inline-block;
  padding: 2px 6px;
  font-size: 9px;
  font-family: var(--ui-font);
  font-weight: 700;
  border: 1px solid var(--ui-border);
  color: var(--ui-text);
  cursor: pointer;
}

.tag-item:hover {
  background: var(--ui-glass-2);
  color: var(--ui-text);
}

.tree-container {
  padding: 2px 0;
}

.tree-node-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 11px;
  color: var(--ui-text);
}

.tree-node-row:hover {
  background: color-mix(in srgb, var(--ui-text) 10%, transparent);
}

.tree-arrow {
  color: color-mix(in srgb, var(--ui-text) 50%, transparent);
  font-size: 9px;
}

.tree-name {
  font-family: var(--ui-font);
}

.empty-section {
  padding: 8px;
  font-size: 10px;
  text-align: center;
}

.sidebar-bottom {
  display: flex;
  gap: 2px;
  padding: 4px;
  border-top: 1px solid var(--ui-border);
}

.qa-btn {
  flex: 1;
  padding: 4px 2px;
  font-family: var(--ui-font);
  font-size: 8px;
  font-weight: 700;
  color: color-mix(in srgb, var(--ui-text) 60%, transparent);
  cursor: pointer;
  border: 2px solid transparent;
  background: transparent;
  text-align: center;
}

.qa-btn:hover {
  border-color: var(--ui-border-strong);
  color: var(--ui-text);
}

.collapse-btn {
  position: absolute;
  top: 50%;
  right: -12px;
  transform: translateY(-50%);
  width: 14px;
  height: 32px;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 20;
  color: var(--ui-text);
  font-size: 9px;
  font-family: var(--ui-font);
  padding: 0;
}

.collapse-btn:hover {
  background: var(--ui-glass-2);
  color: var(--ui-text);
}

.provider-block {
  border-top: 1px solid var(--ui-border);
  margin-top: 4px;
  padding-top: 2px;
}

.vfs-mount {
  margin-bottom: 2px;
}

.vfs-del {
  background: transparent;
  border: none;
  color: color-mix(in srgb, var(--ui-text) 50%, transparent);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 4px;
}

.vfs-del:hover {
  color: var(--ui-text);
}

.vfs-children {
  padding-left: 14px;
}

.vfs-entry {
  cursor: pointer;
}

.vfs-error {
  font-size: 9px;
  color: #b00020;
  padding: 4px 8px;
  word-break: break-word;
}

.vfs-preview {
  margin: 4px;
  border: 1px solid var(--ui-border);
  max-height: 180px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.vfs-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
  padding: 2px 6px;
  border-bottom: 1px solid var(--ui-border);
}

.vfs-preview-body {
  font-size: 9px;
  padding: 4px 6px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.vfs-add {
  display: flex;
  gap: 4px;
  padding: 4px;
  align-items: center;
}

.vfs-select {
  flex: 1;
  min-width: 0;
  font-size: 9px;
  padding: 3px 4px;
  background: var(--ui-surface);
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
}

.text-muted { opacity: 0.6; color: var(--ui-text) !important; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 768px) {
  .sidebar.collapsed {
    width: 36px;
    min-width: 36px;
  }
  .sidebar.collapsed .sidebar-tab {
    padding: 4px 2px;
  }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .sidebar.collapsed {
    width: 40px;
    min-width: 40px;
  }
}
</style>
