// CyberManju OS — Pinia Store
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { invoke } from '@/composables/useTauri'
import { useNotifications } from '@/composables/useNotifications'
import type {
  FileNode, Account, Collection, FaceGroup, LooseGroup,
  SearchResult, EncryptionStatus, EncryptionKeyInfo,
  CompressionStats, ParseResult, GeoMarker,
  FileContent, SavedContent,
  ProviderPreset, AgentConfig, AgentSession, AgentJob, McpServerConfig,
  AgentMemory, MemoryHit,
  ViewMode, PanelType, SidebarSection,
  SyncConfig, SyncProgress, SyncResult, RemoteFile,
  SyncJob, SyncRunRecord, RestoreOutcome, QuotaUsage,
  ScrubRun, RepairStatus, RepairTask, GcReport, LeaseInfo,
  AuthResult, ModuleInfo, TrashItem, AuditEntry, FileVersion, User,
  DashboardStatus,
  ShellResult, OsPs, OsTop, OsWorkers, OsJob, OsVolumeDf, DiskRow,
  SyncBackendType,
} from '@/types'
import { MODULE_METADATA, oauthSlugForBackend } from '@/types'
import { parseStarIds, serializeStarIds } from '@/utils/stars'
import { setAuthToken, getAuthToken, isWebMode, isStaticHost } from '@/composables/useTauri'

export const useAppStore = defineStore('cybermanju', () => {
  // ── Navigation State ──────────────────────────────────────
  const currentPath = ref('/')
  const currentPanel = ref<PanelType>('landing')
  const viewMode = ref<ViewMode>('grid')
  const selectedFileId = ref<string | null>(null)
  const sidebarSection = ref<SidebarSection>('tree')
  const sidebarCollapsed = ref(false)

  // ── Data State ────────────────────────────────────────────
  const files = ref<FileNode[]>([])
  const accounts = ref<Account[]>([])
  const activeAccountId = ref<string | null>(null)
  const collections = ref<Collection[]>([])
  const faceGroups = ref<FaceGroup[]>([])
  const looseGroups = ref<LooseGroup[]>([])
  const searchResults = ref<SearchResult[]>([])
  const searchPage = ref(0)
  const searchTotalResults = ref(0)
  const searchPageSize = 20
  const geoMarkers = ref<GeoMarker[]>([])

  // ── Encryption State ──────────────────────────────────────
  const encryptionStatus = ref<EncryptionStatus>({ isEncrypted: false })
  const encryptionKeys = ref<EncryptionKeyInfo[]>([])

  // ── Compression State ─────────────────────────────────────
  const compressionStats = ref<CompressionStats | null>(null)

  // ── Trash State ────────────────────────────────────────────
  const trashItems = ref<TrashItem[]>([])
  const showTrashPanel = ref(false)

  // ── Audit State ────────────────────────────────────────────
  const auditLog = ref<AuditEntry[]>([])

  // ── Versions State ─────────────────────────────────────────
  const fileVersions = ref<FileVersion[]>([])

  // ── Dashboard State ─────────────────────────────────────────
  const dashboardStatus = ref<DashboardStatus>({
    running: false,
    port: 3456,
    url: 'http://localhost:3456',
    activeConnections: 0,
  })

  // ── Sync State ────────────────────────────────────────────
  const syncConfigs = ref<SyncConfig[]>([])
  const syncProgress = ref<SyncProgress | null>(null)
  const syncJobs = ref<SyncJob[]>([])
  const syncRuns = ref<SyncRunRecord[]>([])
  const syncStatus = ref<{ syncEnabled: boolean; status: string; lastSync?: string | null; provider?: string | null } | null>(null)

  // ── Durability State (AGENT-7) ──────────────────────────────
  const repairStatus = ref<RepairStatus | null>(null)
  const scrubRuns = ref<ScrubRun[]>([])
  const leaseInfo = ref<LeaseInfo | null>(null)
  const lastGc = ref<GcReport | null>(null)

  // ── OS layer (AGENT-8): cybsh, tasks, compute, volume ───
  const osPs = ref<OsPs | null>(null)
  const osTop = ref<OsTop | null>(null)
  const osWorkers = ref<OsWorkers | null>(null)
  const osJobs = ref<OsJob[]>([])
  const osDf = ref<OsVolumeDf | null>(null)
  const disks = ref<DiskRow[]>([])
  /** True while a `cybsh` line is in flight — the status bar shows it. */
  const shellBusy = ref(false)

  // ── Code Intelligence State ───────────────────────────────
  const parseResult = ref<ParseResult | null>(null)

  // ── Auth State ────────────────────────────────────────────
  const currentUser = ref<AuthResult | null>(null)
  const authToken = ref(getAuthToken())
  const isAuthenticated = computed(() => !!currentUser.value)

  /** Persist the JWT (store + localStorage) so REST calls stay authenticated. */
  function setSessionToken(token: string) {
    authToken.value = token
    setAuthToken(token)
  }

  // Web mode: a 401 means the session is missing or expired. There is no
  // password login any more — OAuth is the only way back in, so point at the
  // Accounts window instead of opening a login form that no longer exists.
  if (typeof window !== 'undefined') {
    window.addEventListener('cybermanju:unauthorized', () => {
      if (isWebMode()) {
        notifyError(
          'Session expired',
          'Reconnect with Google, GitHub or GitLab in Accounts (OAuth sign-in)'
        )
        window.dispatchEvent(new CustomEvent('cybermanju:open-accounts'))
      }
    })
  }

  // ── User Management State ──────────────────────────────────
  const users = ref<User[]>([])

  // ── Transition State ──────────────────────────────────────
  const previousPanel = ref<PanelType | null>(null)
  const isTransitioning = ref(false)

  // ── UI State ──────────────────────────────────────────────
  const searchQuery = ref('')
  const isSearching = ref(false)
  const isLoading = ref(false)
  const lastError = ref<string | null>(null)
  const matrixRainEnabled = ref(true)
  const showEncryptionPanel = ref(false)
  const showCompressionPanel = ref(false)
  const showPermissionsPanel = ref(false)
  const commandPaletteOpen = ref(false)
  const showShortcutsHelp = ref(false)
  const createFolderPromptOpen = ref(false)
  const sortBy = ref<'name' | 'date' | 'size' | 'type'>('name')
  const autoRefreshInterval = ref(0)
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null
  const selectedFileIds = ref<string[]>([])
  const isMultiSelect = ref(false)

  // ── Module Helpers ─────────────────────────────────────────
  const currentModule = computed<ModuleInfo>(() =>
    MODULE_METADATA[(showEncryptionPanel.value ? 'encryption' : showCompressionPanel.value ? 'compression' : currentPanel.value) as PanelType] || MODULE_METADATA.files
  )

  // ── Computed ──────────────────────────────────────────────
  const selectedFile = computed(() =>
    files.value.find(f => f.id === selectedFileId.value) || null
  )

  const activeAccount = computed(() =>
    accounts.value.find(a => a.id === activeAccountId.value) || accounts.value[0] || null
  )

  const encryptedFiles = computed(() =>
    files.value.filter(f => f.encrypted)
  )

  const compressedFiles = computed(() =>
    files.value.filter(f => f.compressionLayers && f.compressionLayers.length > 0 && !f.compressionLayers.includes('none'))
  )

  const starredFiles = computed(() =>
    files.value.filter(f => f.isStarred)
  )

  const folders = computed(() =>
    files.value.filter(f => f.fileType === 'folder')
  )

  const currentFolderFiles = computed(() =>
    files.value.filter(f => f.parentId === selectedFileId.value || (selectedFileId.value === null && !f.parentId))
  )

  // ── Favorites (persisted stars) ─────────────────────────
  // The Rust `FileNode` schema has no star column, so stars live beside
  // the file table: localStorage everywhere (instant, offline) mirrored
  // into the worker kv (`stars` key) on static hosts so they ride inside
  // the `.cybermanju` container alongside third-party provider data.
  const STAR_LS_KEY = 'cybermanju.stars.v1'
  const STAR_KV_KEY = 'stars'
  const starredIds = ref<Set<string>>(new Set())

  function applyStars() {
    const ids = starredIds.value
    for (const f of files.value) {
      f.isStarred = ids.has(f.id)
    }
  }

  function readStarCache(): string[] {
    try {
      const raw = localStorage.getItem(STAR_LS_KEY)
      if (!raw) return []
      return parseStarIds(raw)
    } catch {
      return []
    }
  }

  async function loadStars() {
    const cached = readStarCache()
    // Static host: the container kv wins when present (shared/portable).
    if (isStaticHost()) {
      try {
        const { wasmDbDispatch } = await import('@/composables/useWasmBackend')
        const row = (await wasmDbDispatch('kv.get', { key: STAR_KV_KEY }).catch(() => null)) as {
          value?: unknown
        } | null
        const ids = parseStarIds(row?.value)
        if (ids.length > 0) {
          starredIds.value = new Set(ids)
          try { localStorage.setItem(STAR_LS_KEY, serializeStarIds(ids)) } catch { /* private mode */ }
          applyStars()
          return
        }
      } catch {
        // Worker unavailable — fall through to the localStorage cache.
      }
    }
    if (cached.length > 0) {
      starredIds.value = new Set(cached)
      applyStars()
    }
  }

  async function persistStars() {
    const raw = serializeStarIds(starredIds.value)
    try { localStorage.setItem(STAR_LS_KEY, raw) } catch { /* private mode */ }
    if (isStaticHost()) {
      try {
        const { wasmDbDispatch } = await import('@/composables/useWasmBackend')
        await wasmDbDispatch('kv.set', { key: STAR_KV_KEY, value: raw }).catch(() => null)
      } catch {
        // Best-effort mirror — localStorage already holds the truth.
      }
    }
  }

  const { notify } = useNotifications()

  function notifyError(msg: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    // On the static WASM pack the absence of the dashboard is expected —
    // don't spam a toast per failed fetch on startup.
    if (detail.startsWith('[WASM Mode]')) {
      lastError.value = null
      return
    }
    lastError.value = `${msg}: ${detail}`
    notify('error', lastError.value)
    console.error(lastError.value)
  }

  function notifySuccess(msg: string) {
    notify('success', msg)
  }

  function clearError() {
    lastError.value = null
  }

  // ── Actions: Init ─────────────────────────────────────────
  async function initialize() {
    isLoading.value = true
    clearError()
    try {
      await loadStars()
      await Promise.allSettled([
        fetchFiles(),
        fetchAccounts(),
        fetchCollections(),
        fetchFaceGroups(),
        fetchLooseGroups(),
        fetchEncryptionStatus(),
        listKeys(),
        fetchSyncConfigs(),
      ])
      startAutoRefresh()
    } finally {
      isLoading.value = false
    }
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer)
    if (autoRefreshInterval.value > 0) {
      autoRefreshTimer = setInterval(async () => {
        await Promise.allSettled([
          fetchFiles(),
          fetchAccounts(),
          fetchCollections(),
          fetchFaceGroups(),
          fetchEncryptionStatus(),
          fetchSyncConfigs(),
          fetchTrashItems(),
        ])
      }, autoRefreshInterval.value * 1000)
    }
  }

  watch(autoRefreshInterval, () => startAutoRefresh())

  // ── Actions: Selection ────────────────────────────────────
  function selectFile(fileId: string | null) {
    selectedFileId.value = fileId
  }

  async function toggleStar(fileId: string) {
    const file = files.value.find(f => f.id === fileId)
    const next = !(file?.isStarred ?? starredIds.value.has(fileId))
    if (next) starredIds.value.add(fileId)
    else starredIds.value.delete(fileId)
    if (file) file.isStarred = next
    // Persist beside the DB (localStorage + container kv mirror); the
    // file-table schema itself carries no star column on any backend.
    await persistStars()
  }

  // ── Actions: Files ────────────────────────────────────────
  async function fetchFiles(parentPath?: string) {
    isLoading.value = true
    clearError()
    try {
      const path = parentPath || currentPath.value
      // CONTROL 5.7 — read-only provider browse: `/providers/<id>/…` never
      // touches `list_files`; mounts are lower layers served by the canal.
      if (String(path || '').replace(/\\/g, '/').startsWith('/providers')) {
        const canal = await import('@/composables/useProviderCanal')
        const parsed = canal.parseProviderPath(String(path))
        if (!parsed) {
          const mounts = await canal.listVfsMounts()
          const now = new Date().toISOString()
          files.value = mounts.map(m => ({
            id: `providers/${m.id}`,
            name: m.name,
            fileType: 'folder',
            parentId: '/providers',
            path: `/providers/${m.id}`,
            sizeBytes: 0,
            encrypted: false,
            compressionLayers: [],
            createdAt: m.createdAt || now,
            modifiedAt: m.updatedAt || now,
          }) as FileNode)
        } else {
          const entries = await canal.listVfsDir(parsed.mountId, parsed.remotePath)
          files.value = entries.map(e => ({
            id: `providers/${parsed.mountId}/${e.locator || e.path}`,
            name: e.name,
            fileType: e.isDir ? 'folder' : 'file',
            parentId: String(path),
            path: canal.providerPathFor(parsed.mountId, e.path),
            sizeBytes: Number(e.sizeBytes ?? 0),
            encrypted: false,
            compressionLayers: [],
            createdAt: String(e.modifiedAt || new Date().toISOString()),
            modifiedAt: String(e.modifiedAt || new Date().toISOString()),
          }) as FileNode)
        }
        applyStars()
        return
      }
      const result = await invoke<FileNode[]>('list_files', { parentPath: path })
      files.value = result
      // Re-apply persisted stars — no backend ships a star column.
      applyStars()
    } catch (e) {
      notifyError('Failed to fetch files', e)
    } finally {
      isLoading.value = false
    }
  }

  async function getFile(fileId: string) {
    try {
      return await invoke<FileNode>('get_file', { fileId })
    } catch (e) {
      notifyError('Failed to get file', e)
      return null
    }
  }

  async function createFolder(name: string, parentId: string) {
    try {
      await invoke('create_folder', { name, parentId })
      await fetchFiles()
    } catch (e) {
      notifyError('Failed to create folder', e)
    }
  }

  async function deleteFile(fileId: string) {
    try {
      await invoke('delete_file', { fileId })
      files.value = files.value.filter(f => f.id !== fileId)
      if (selectedFileId.value === fileId) selectedFileId.value = null
      selectedFileIds.value = selectedFileIds.value.filter(id => id !== fileId)
      notifySuccess(`File deleted`)
    } catch (e) {
      notifyError('Failed to delete file', e)
    }
  }

  async function renameFile(fileId: string, newName: string) {
    try {
      await invoke('rename_file', { fileId, newName })
      await fetchFiles()
      notifySuccess('File renamed')
    } catch (e) {
      notifyError('Failed to rename file', e)
    }
  }

  async function duplicateFileContext(fileId: string) {
    try {
      await invoke('duplicate_file_context', { fileId })
      await fetchFiles()
      notifySuccess('File context duplicated')
    } catch (e) {
      notifyError('Failed to duplicate file', e)
    }
  }

  /**
   * Replace a file's user tags (any image/doc/folder/file). Tags feed the
   * Tantivy index (filename+content+tags BM25) and the scene matcher on
   * every transport — this is how users teach search what things are.
   */
  async function setFileTags(fileId: string, tags: string[]) {
    try {
      await invoke('set_file_tags', { fileId, tags })
      await fetchFiles()
      notifySuccess('Tags saved')
      return true
    } catch (e) {
      notifyError('Failed to save tags', e)
      return false
    }
  }

  // ── Actions: Search ───────────────────────────────────────
  async function searchFiles(query: string, page?: number) {
    if (!query.trim()) { searchResults.value = []; searchTotalResults.value = 0; return }
    isSearching.value = true
    clearError()
    try {
      const pg = page ?? 0
      const limit = searchPageSize
      const result = await invoke<{ results: SearchResult[]; total: number }>('search_files_paginated', { query, limit, offset: pg * limit })
      if (pg === 0) {
        searchResults.value = result.results
      } else {
        searchResults.value = [...searchResults.value, ...result.results]
      }
      searchTotalResults.value = result.total
      searchPage.value = pg
    } catch {
      try {
        const result = await invoke<SearchResult[]>('search_files', { query, limit: 50 })
        if (page && page > 0) {
          searchResults.value = [...searchResults.value, ...result]
        } else {
          searchResults.value = result
        }
        searchTotalResults.value = result.length
        searchPage.value = page ?? 0
      } catch (e) {
        notifyError('Search failed', e)
      }
    } finally {
      isSearching.value = false
    }
  }

  function loadMoreSearchResults() {
    if (searchQuery.value.trim()) {
      searchFiles(searchQuery.value, searchPage.value + 1)
    }
  }

  // ── Actions: Encryption ───────────────────────────────────
  async function fetchEncryptionStatus() {
    try {
      encryptionStatus.value = await invoke<EncryptionStatus>('get_encryption_status', {
        fileId: selectedFileId.value || undefined,
      })
    } catch (e) {
      notifyError('Failed to get encryption status', e)
    }
  }

  async function generateKeypair(algorithm: string) {
    try {
      await invoke('generate_keypair', { algorithm })
      await listKeys()
      await fetchEncryptionStatus()
    } catch (e) {
      notifyError('Failed to generate keypair', e)
    }
  }

  async function listKeys() {
    try {
      encryptionKeys.value = await invoke<EncryptionKeyInfo[]>('list_keys')
    } catch (e) {
      notifyError('Failed to list keys', e)
    }
  }

  async function encryptFile(fileId: string, algorithm: string) {
    try {
      await invoke('encrypt_file', { fileId, algorithm })
      await fetchFiles()
      await fetchEncryptionStatus()
    } catch (e) {
      notifyError('Encryption failed', e)
    }
  }

  async function decryptFile(fileId: string) {
    try {
      await invoke('decrypt_file', { fileId })
      await fetchFiles()
      await fetchEncryptionStatus()
    } catch (e) {
      notifyError('Decryption failed', e)
    }
  }

  // ── Actions: Compression ──────────────────────────────────
  async function compressFile(fileId: string, layer: string) {
    try {
      const stats = await invoke<CompressionStats>('compress_file', { fileId, layer })
      compressionStats.value = stats
      await fetchFiles()
    } catch (e) {
      notifyError('Compression failed', e)
    }
  }

  async function decompressFile(fileId: string) {
    try {
      const stats = await invoke<CompressionStats>('decompress_file', { fileId })
      compressionStats.value = stats
      await fetchFiles()
    } catch (e) {
      notifyError('Decompression failed', e)
    }
  }

  // ── Actions: Collections ──────────────────────────────────
  async function fetchCollections() {
    try {
      collections.value = await invoke<Collection[]>('list_collections')
    } catch (e) {
      notifyError('Failed to fetch collections', e)
    }
  }

  async function createCollection(name: string, type: string, color: string, description?: string) {
    try {
      await invoke('create_collection', { name, collectionType: type, color, description })
      await fetchCollections()
    } catch (e) {
      notifyError('Failed to create collection', e)
    }
  }

  async function addToCollection(collectionId: string, fileId: string, note?: string) {
    try {
      await invoke('add_to_collection', { collectionId, fileId, note })
      await fetchCollections()
    } catch (e) {
      notifyError('Failed to add to collection', e)
    }
  }

  async function removeFromCollection(collectionId: string, fileId: string) {
    try {
      await invoke('remove_from_collection', { collectionId, fileId })
      await fetchCollections()
    } catch (e) {
      notifyError('Failed to remove from collection', e)
    }
  }

  // ── Actions: Face Groups ──────────────────────────────────
  async function fetchFaceGroups() {
    try {
      faceGroups.value = await invoke<FaceGroup[]>('list_face_groups')
    } catch (e) {
      notifyError('Failed to fetch face groups', e)
    }
  }

  async function detectFaces(fileId: string) {
    try {
      await invoke('detect_faces', { fileId })
      await fetchFaceGroups()
    } catch (e) {
      notifyError('Face detection failed', e)
    }
  }

  async function detectFacesBatch() {
    try {
      const result = await invoke<{ clustersCreated: number; totalFaces: number; noiseFaces: number; avgCohesion: number; strategyUsed: string }>('detect_faces_batch_cmd')
      await fetchFaceGroups()
      return result
    } catch (e) {
      notifyError('Batch face detection failed', e)
      return null
    }
  }

  async function reclusterFaces(strategy?: string) {
    try {
      const result = await invoke<{ clustersCreated: number; totalFaces: number; noiseFaces: number; avgCohesion: number; strategyUsed: string }>('recluster_faces', { strategy })
      await fetchFaceGroups()
      return result
    } catch (e) {
      notifyError('Re-clustering failed', e)
      return null
    }
  }

  async function renameFaceGroup(groupId: string, newName: string) {
    try {
      await invoke('rename_face_group', { groupId, newName })
      await fetchFaceGroups()
    } catch (e) {
      notifyError('Failed to rename face group', e)
    }
  }

  async function mergeFaceGroups(sourceGroupId: string, targetGroupId: string) {
    try {
      await invoke('merge_face_groups', { sourceGroupId, targetGroupId })
      await fetchFaceGroups()
    } catch (e) {
      notifyError('Failed to merge face groups', e)
    }
  }

  async function deleteFaceGroup(groupId: string) {
    try {
      await invoke('delete_face_group', { groupId })
      await fetchFaceGroups()
    } catch (e) {
      notifyError('Failed to delete face group', e)
    }
  }

  async function findSimilarFaces(groupId: string, threshold?: number) {
    try {
      return await invoke<FaceGroup[]>('find_similar_faces', { groupId, threshold })
    } catch (e) {
      notifyError('Failed to find similar faces', e)
      return []
    }
  }

  // ── Actions: Accounts ─────────────────────────────────────
  async function fetchAccounts() {
    try {
      accounts.value = await invoke<Account[]>('list_accounts')
      const active = accounts.value.find(a => a.isActive)
      if (active) activeAccountId.value = active.id
    } catch (e) {
      notifyError('Failed to fetch accounts', e)
    }
  }

  async function createAccount(name: string, type: string, path?: string, color?: string) {
    try {
      await invoke('create_account', { name, accountType: type, path, color })
      await fetchAccounts()
    } catch (e) {
      notifyError('Failed to create account', e)
    }
  }

  async function switchAccount(accountId: string) {
    try {
      await invoke('switch_account', { accountId })
      activeAccountId.value = accountId
      await fetchAccounts()
    } catch (e) {
      notifyError('Failed to switch account', e)
    }
  }

  async function deleteAccount(accountId: string) {
    try {
      await invoke('delete_account', { accountId })
      await fetchAccounts()
      notifySuccess('Account deleted')
    } catch (e) {
      notifyError('Failed to delete account (active accounts cannot be deleted)', e)
    }
  }

  // ── Actions: Map ──────────────────────────────────────────
  async function fetchGeoFiles() {
    try {
      const geoFiles = await invoke<Array<{ id: string; name: string; gpsLat?: number; gpsLon?: number }>>('get_geo_files')
      geoMarkers.value = geoFiles
        .filter(f => f.gpsLat != null && f.gpsLon != null)
        .map(f => ({
          fileId: f.id,
          fileName: f.name,
          lat: f.gpsLat!,
          lng: f.gpsLon!,
        }))
    } catch (e) {
      notifyError('Failed to fetch geo files', e)
    }
  }

  // ── Actions: Tree-sitter ──────────────────────────────────
  async function parseFileCode(filePath: string) {
    try {
      parseResult.value = await invoke<ParseResult>('parse_file', { filePath })
    } catch (e) {
      notifyError('Parse failed', e)
    }
  }

  /**
   * Parse source text on every transport: Tauri runs the real grammars,
   * REST runs the shared heuristic core (same shape, honest `engine`).
   * Returns the result for callers that render from it directly.
   */
  async function parseCodeText(fileName: string, content: string) {
    try {
      const result = await invoke<ParseResult>('parse_text', { fileName, content })
      parseResult.value = result
      return result
    } catch (e) {
      notifyError('Parse failed', e)
      return null
    }
  }

  // ── Actions: Editor file content (transport-aware) ───────────
  /** Managed file bytes (desktop Tauri command, REST on web). */
  async function readManagedContent(fileId: string) {
    try {
      return await invoke<FileContent>('read_file_content', { fileId })
    } catch (e) {
      notifyError('Failed to read file content', e)
      return null
    }
  }

  /** Save managed file bytes (snapshots a version first, server-side). */
  async function saveManagedContent(fileId: string, content: string) {
    try {
      const saved = await invoke<SavedContent>('write_file_content', { fileId, content })
      notifySuccess(`Saved ${saved.name} (${saved.sizeBytes} bytes — version snapshotted)`)
      await fetchFiles()
      return saved
    } catch (e) {
      notifyError('Save failed', e)
      return null
    }
  }

  /** WASM-volume text (static host only): read via the shell. */
  async function readWasmFile(path: string) {
    try {
      const res = await invoke<ShellResult>('os_exec', { line: `cat "${path}"` })
      if (!res.ok) {
        notifyError('Failed to read file', res.output)
        return null
      }
      return res.output
    } catch (e) {
      notifyError('Failed to read file', e)
      return null
    }
  }

  /** WASM-volume save (static host only, 1 MiB cap enforced Rust-side). */
  async function saveWasmFile(path: string, content: string) {
    try {
      const res = await invoke<{ ok: boolean; output: string }>('os_write', { path, content })
      if (res && (res as { ok?: boolean }).ok === false) {
        notifyError('Save failed', (res as { output?: string }).output ?? '')
        return false
      }
      notifySuccess(`Saved ${path}`)
      return true
    } catch (e) {
      notifyError('Save failed', e)
      return false
    }
  }

  /** WASM-volume directory listing (static host only). */
  async function listWasmDir(path: string) {
    try {
      const res = await invoke<{ ok: boolean; output: string } | string[]>('os_ls', { path })
      if (Array.isArray(res)) return res as string[]
      const out = (res as { output?: string }).output ?? ''
      return out.split('\n').map(s => s.trim()).filter(Boolean)
    } catch (e) {
      notifyError('Failed to list directory', e)
      return []
    }
  }

  // ── Actions: Loose Groups ─────────────────────────────────
  async function fetchLooseGroups() {
    try {
      looseGroups.value = await invoke<LooseGroup[]>('list_loose_groups')
    } catch (e) {
      notifyError('Failed to fetch loose groups', e)
    }
  }

  async function createLooseGroup(name: string, color = '#FFFFFF') {
    const clean = name.trim()
    if (!clean) {
      notifyError('Invalid group name', 'Give the loose group a name first')
      return null
    }
    try {
      const group = await invoke<LooseGroup>('create_loose_group', { name: clean, color })
      await fetchLooseGroups()
      notifySuccess(`Loose group "${clean}" created`)
      return group
    } catch (e) {
      notifyError('Failed to create loose group', e)
      return null
    }
  }

  async function addFileToLooseGroup(groupId: string, fileId: string) {
    try {
      const group = await invoke<LooseGroup>('add_to_loose_group', { groupId, fileId })
      await Promise.allSettled([fetchLooseGroups(), fetchFiles()])
      notifySuccess('File added to loose group')
      return group
    } catch (e) {
      notifyError('Failed to add file to loose group', e)
      return null
    }
  }

  // ── Actions: Sync ──────────────────────────────────────
  async function fetchSyncConfigs() {
    try {
      syncConfigs.value = await invoke<SyncConfig[]>('list_sync_configs')
    } catch (e) {
      notifyError('Failed to fetch sync configs', e)
    }
  }

  async function createSyncConfig(config: Omit<SyncConfig, 'id' | 'createdAt' | 'updatedAt'>) {
    try {
      await invoke('create_sync_config', { config })
      await fetchSyncConfigs()
    } catch (e) {
      notifyError('Failed to create sync config', e)
    }
  }

  async function deleteSyncConfig(configId: string) {
    try {
      await invoke('delete_sync_config', { configId })
      await fetchSyncConfigs()
    } catch (e) {
      notifyError('Failed to delete sync config', e)
    }
  }

  /**
   * Upsert a full sync config (create when `id` is empty, overwrite when set —
   * `save_config` on the backend). An absent `token` leaves the stored secret
   * untouched, so toggling `enabled` never wipes credentials. Returns the
   * saved row, or null on failure (toast already shown).
   */
  async function saveSyncConfig(config: SyncConfig): Promise<SyncConfig | null> {
    try {
      const saved = await invoke<SyncConfig>('create_sync_config', { config })
      await fetchSyncConfigs()
      return saved ?? null
    } catch (e) {
      notifyError('Failed to save provider', e)
      return null
    }
  }

  /**
   * Quiet connectivity probe — same `test_sync_connection` call the Sync
   * panel uses, but without toast spam so the Account Manager can poll it
   * while an OAuth browser flow completes.
   */
  async function probeSyncConnection(config: SyncConfig): Promise<{ ok: boolean; detail: string }> {
    try {
      const ok = await invoke<boolean>('test_sync_connection', { config })
      return ok
        ? { ok: true, detail: 'provider answered' }
        : { ok: false, detail: 'provider answered false — check token / OAuth, then retry' }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  async function startSync(configId: string, fileIds: string[]) {
    try {
      await invoke('start_sync', { configId, fileIds })
      await pollSyncProgress()
    } catch (e) {
      notifyError('Failed to start sync', e)
    }
  }

  async function pollSyncProgress() {
    try {
      syncProgress.value = await invoke<SyncProgress>('get_sync_progress')
      const status = syncProgress.value?.status
      const terminal =
        status === 'idle' ||
        status === 'done' ||
        status === 'error' ||
        status === 'completed' ||
        status === 'cancelled'
      if (syncProgress.value && !terminal) {
        setTimeout(() => pollSyncProgress(), 1000)
      }
    } catch (e) {
      notifyError('Failed to get sync progress', e)
    }
  }

  async function getSyncProgress() {
    try {
      syncProgress.value = await invoke<SyncProgress>('get_sync_progress')
    } catch (e) {
      notifyError('Failed to get sync progress', e)
    }
  }

  async function testSyncConnection(config: SyncConfig) {
    try {
      return await invoke<boolean>('test_sync_connection', { config })
    } catch (e) {
      notifyError('Sync connection test failed', e)
      return false
    }
  }

  async function cancelSync() {
    try {
      await invoke('cancel_sync')
      syncProgress.value = null
    } catch (e) {
      notifyError('Failed to cancel sync', e)
    }
  }

  async function listRemoteFiles(config: SyncConfig, prefix: string) {
    try {
      return await invoke<RemoteFile[]>('list_remote_files', { config, prefix })
    } catch (e) {
      notifyError('Failed to list remote files', e)
      return []
    }
  }

  async function getSyncJob(jobId: string) {
    try {
      const job = await invoke<SyncJob>('get_sync_job', { jobId })
      const i = syncJobs.value.findIndex(j => j.jobId === jobId)
      if (i >= 0) syncJobs.value[i] = job
      else syncJobs.value.push(job)
      return job
    } catch (e) {
      notifyError('Failed to get sync job', e)
      return null
    }
  }

  async function fetchSyncRuns() {
    try {
      syncRuns.value = await invoke<SyncRunRecord[]>('list_sync_runs')
    } catch (e) {
      notifyError('Failed to fetch sync runs', e)
    }
  }

  async function fetchSyncStatus() {
    try {
      syncStatus.value = await invoke<{ syncEnabled: boolean; status: string; lastSync?: string | null; provider?: string | null }>('get_sync_status')
    } catch (e) {
      notifyError('Failed to fetch sync status', e)
    }
  }

  async function restoreSyncFile(configId: string, fileId?: string, remotePath?: string, destPath?: string) {
    try {
      const out = await invoke<RestoreOutcome>('restore_sync_file', { configId, fileId, remotePath, destPath })
      notifySuccess(`Restored ${out.bytes} bytes to ${out.path}${out.verified ? ' (verified)' : ''}`)
      return out
    } catch (e) {
      notifyError('Restore failed', e)
      return null
    }
  }

  async function deleteRemoteFile(configId: string, remotePath: string) {
    try {
      await invoke<boolean>('delete_remote_file', { configId, remotePath })
      notifySuccess('Remote file deleted')
      return true
    } catch (e) {
      notifyError('Remote delete failed', e)
      return false
    }
  }

  async function fetchSyncUsage(configId: string) {
    try {
      return await invoke<QuotaUsage>('get_sync_usage', { configId })
    } catch (e) {
      notifyError('Failed to fetch provider quota', e)
      return null
    }
  }

  async function oauthStart(provider: string, configId: string) {
    try {
      // The backend route only knows google|github|gitlab slugs —
      // Google Drive uses the `google` OAuth client.
      const slug = oauthSlugForBackend(provider as SyncBackendType) ?? provider
      const res = await invoke<{ authorizeUrl: string; state: string }>('oauth_start', { provider: slug, configId })
      if (res?.authorizeUrl && typeof window !== 'undefined') window.open(res.authorizeUrl, '_blank')
      return res
    } catch (e) {
      notifyError('OAuth start failed (fall back to manual token paste)', e)
      return null
    }
  }

  function logout() {
    currentUser.value = null
    setSessionToken('')
    notifySuccess('Logged out')
  }

  // ── Actions: Durability (AGENT-7) ─────────────────────────
  async function fetchRepairStatus() {
    try {
      repairStatus.value = await invoke<RepairStatus>('repair_status')
    } catch (e) {
      notifyError('Failed to fetch repair status', e)
    }
  }

  async function fetchRepairTasks() {
    try {
      return await invoke<RepairTask[]>('repair_tasks')
    } catch (e) {
      notifyError('Failed to fetch repair tasks', e)
      return []
    }
  }

  async function fetchRepairHealth() {
    try {
      return await invoke<Record<string, unknown>>('repair_health')
    } catch (e) {
      notifyError('Failed to fetch provider health', e)
      return null
    }
  }

  async function runRepair(findings?: unknown[]) {
    try {
      const task = await invoke<RepairTask>('repair_run', { findings: findings ?? [] })
      notifySuccess(`Repair started (${task.taskId})`)
      await fetchRepairStatus()
      return task
    } catch (e) {
      notifyError('Repair failed to start', e)
      return null
    }
  }

  async function runRebuild() {
    try {
      const task = await invoke<RepairTask>('repair_rebuild')
      notifySuccess(`Catalog rebuild started (${task.taskId})`)
      return task
    } catch (e) {
      notifyError('Rebuild failed to start', e)
      return null
    }
  }

  async function runGc(dryRun = true) {
    try {
      const report = await invoke<GcReport>('repair_gc', { dryRun })
      lastGc.value = report
      notifySuccess(dryRun ? `GC dry run: ${report.deleted} would be freed` : `GC freed ${report.bytesFreed} bytes`)
      return report
    } catch (e) {
      notifyError('GC failed', e)
      return null
    }
  }

  async function runScrub() {
    try {
      const task = await invoke<RepairTask>('scrub_run')
      notifySuccess(`Scrub started (${task.taskId})`)
      return task
    } catch (e) {
      notifyError('Scrub failed to start', e)
      return null
    }
  }

  async function fetchScrubRuns() {
    try {
      scrubRuns.value = await invoke<ScrubRun[]>('scrub_runs')
    } catch (e) {
      notifyError('Failed to fetch scrub runs', e)
    }
  }

  async function acquireLease(holder: string, scope = 'volume', ttlSecs = 60) {
    try {
      leaseInfo.value = await invoke<LeaseInfo>('lease_acquire', { holder, scope, ttlSecs })
      return leaseInfo.value
    } catch (e) {
      notifyError('Lease acquire failed', e)
      return null
    }
  }

  async function releaseLease(holder: string, scope = 'volume') {
    try {
      await invoke<boolean>('lease_release', { holder, scope })
      leaseInfo.value = null
      return true
    } catch (e) {
      notifyError('Lease release failed', e)
      return false
    }
  }

  async function fetchLeaseStatus(scope?: string) {
    try {
      leaseInfo.value = await invoke<LeaseInfo>('lease_status', { scope })
    } catch (e) {
      notifyError('Failed to fetch lease status', e)
    }
  }

  // ── Actions: Trash ─────────────────────────────────────────
  async function fetchTrashItems() {
    try {
      trashItems.value = await invoke<TrashItem[]>('list_trash')
    } catch (e) {
      notifyError('Failed to fetch trash', e)
    }
  }

  async function restoreTrashItem(fileId: string) {
    try {
      await invoke('restore_from_trash', { fileId })
      await fetchTrashItems()
      await fetchFiles()
      notifySuccess('File restored from trash')
    } catch (e) {
      notifyError('Failed to restore file', e)
    }
  }

  async function emptyTrash() {
    try {
      const count = await invoke<number>('empty_trash')
      trashItems.value = []
      notifySuccess(`Permanently deleted ${count} items`)
    } catch (e) {
      notifyError('Failed to empty trash', e)
    }
  }

  async function deleteFromTrash(fileId: string) {
    try {
      await invoke('delete_from_trash', { fileId })
      await fetchTrashItems()
      notifySuccess('File permanently deleted')
    } catch (e) {
      notifyError('Failed to delete from trash', e)
    }
  }

  // ── Actions: Audit Log ─────────────────────────────────────
  async function fetchAuditLog(limit?: number, entityType?: string) {
    try {
      auditLog.value = await invoke<AuditEntry[]>('get_audit_log', { limit, entityType })
    } catch (e) {
      notifyError('Failed to fetch audit log', e)
    }
  }

  // ── Actions: File Versions ─────────────────────────────────
  async function fetchFileVersions(fileId: string) {
    try {
      fileVersions.value = await invoke<FileVersion[]>('list_file_versions', { fileId })
    } catch (e) {
      notifyError('Failed to fetch file versions', e)
    }
  }

  async function createVersion(fileId: string) {
    try {
      await invoke('create_file_version', { fileId })
      await fetchFileVersions(fileId)
      notifySuccess('Version snapshot created')
    } catch (e) {
      notifyError('Failed to create version', e)
    }
  }

  async function revertToVersion(fileId: string, versionId: string) {
    try {
      await invoke('revert_file_version', { fileId, versionId })
      await fetchFileVersions(fileId)
      await fetchFiles()
      notifySuccess('File reverted to version')
    } catch (e) {
      notifyError('Failed to revert file version', e)
    }
  }

  async function snapshotAllVersions() {
    try {
      const count = await invoke<number>('snapshot_all_versions')
      notifySuccess(`Snapshotted ${count} files`)
    } catch (e) {
      notifyError('Failed to snapshot all versions', e)
    }
  }

  // ── Actions: Dashboard Status ───────────────────────────────
  async function fetchDashboardStatus() {
    try {
      dashboardStatus.value = await invoke<DashboardStatus>('dashboard_status')
    } catch (e) {
      notifyError('Failed to fetch dashboard status', e)
    }
  }

  async function startDashboard() {
    try {
      const result = await invoke<DashboardStatus>('start_dashboard')
      dashboardStatus.value = result
      notifySuccess('Dashboard started')
    } catch (e) {
      notifyError('Failed to start dashboard', e)
    }
  }

  async function stopDashboard() {
    try {
      await invoke<boolean>('stop_dashboard')
      dashboardStatus.value = { running: false, port: 3456, url: 'http://localhost:3456', activeConnections: 0 }
      notifySuccess('Dashboard stopped')
    } catch (e) {
      notifyError('Failed to stop dashboard', e)
    }
  }

  // ── Actions: User Management ───────────────────────────────
  async function fetchUsers() {
    try {
      users.value = await invoke<User[]>('list_users')
    } catch (e) {
      notifyError('Failed to fetch users', e)
    }
  }

  async function createUser(username: string, password: string, role: string) {
    try {
      await invoke('create_user', { username, password, role })
      await fetchUsers()
      notifySuccess(`User '${username}' created`)
    } catch (e) {
      notifyError('Failed to create user', e)
    }
  }

  async function deleteUser(userId: string) {
    try {
      await invoke('delete_user', { userId })
      await fetchUsers()
      notifySuccess('User deleted')
    } catch (e) {
      notifyError('Failed to delete user', e)
    }
  }

  async function updateUserRole(userId: string, role: string) {
    try {
      await invoke('update_user_role', { userId, role })
      await fetchUsers()
      notifySuccess('User role updated')
    } catch (e) {
      notifyError('Failed to update user role', e)
    }
  }

  // ── Actions: Batch Operations ──────────────────────────────
  async function batchDeleteFiles(fileIds: string[]) {
    try {
      const count = await invoke<number>('batch_delete', { fileIds })
      await fetchFiles()
      notifySuccess(`Batch deleted ${count} files`)
    } catch (e) {
      notifyError('Batch delete failed', e)
    }
  }

  async function batchEncryptFiles(fileIds: string[], algorithm: string) {
    try {
      const count = await invoke<number>('batch_encrypt', { fileIds, algorithm })
      await fetchFiles()
      notifySuccess(`Batch encrypted ${count} files`)
    } catch (e) {
      notifyError('Batch encrypt failed', e)
    }
  }

  async function batchCompressFiles(fileIds: string[], layer: string) {
    try {
      const count = await invoke<number>('batch_compress', { fileIds, layer })
      await fetchFiles()
      notifySuccess(`Batch compressed ${count} files`)
    } catch (e) {
      notifyError('Batch compress failed', e)
    }
  }

  // ── Actions: Share Links ────────────────────────────────────
  const shareLinks = ref<import('@/types').ShareLink[]>([])

  async function generateShareLink(fileId: string, expiresInHours?: number) {
    try {
      const result = await invoke<import('@/types').ShareLink>('generate_share_link', { fileId, expiresInHours })
      await fetchShareLinks()
      notifySuccess('Share link generated')
      return result
    } catch (e) {
      notifyError('Failed to generate share link', e)
      return null
    }
  }

  async function fetchShareLinks() {
    try {
      shareLinks.value = await invoke<import('@/types').ShareLink[]>('list_share_links')
    } catch (e) {
      notifyError('Failed to fetch share links', e)
    }
  }

  // ── Actions: URL Import ─────────────────────────────────────
  async function importFromUrl(url: string, parentPath: string) {
    try {
      const result = await invoke<FileNode>('import_from_url', { url, parentPath })
      await fetchFiles()
      notifySuccess('File imported from URL')
      return result
    } catch (e) {
      notifyError('Failed to import from URL', e)
      return null
    }
  }

  // ── Actions: Parent Index Rebuild ──────────────────────────
  async function rebuildParentIndex() {
    try {
      const count = await invoke<number>('rebuild_parent_index')
      await fetchFiles()
      notifySuccess(`Rebuilt parent index for ${count} files`)
    } catch (e) {
      notifyError('Failed to rebuild parent index', e)
    }
  }

  // ── Actions: OS layer (AGENT-8) ───────────────────────────
  /**
   * Run one `cybsh` line. A command that ran and reported a failure comes
   * back as `{ ok: false }` with the message in `output` — only a transport
   * failure lands in the catch, and that is reported as a shell error too so
   * the terminal never silently drops a line.
   */
  async function execShellLine(line: string): Promise<ShellResult> {
    shellBusy.value = true
    try {
      return await invoke<ShellResult>('os_exec', { line })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      return { ok: false, line, output: detail, error: detail, prompt: 'cybsh> ' }
    } finally {
      shellBusy.value = false
    }
  }

  /** Tab completion off the live command table; never throws. */
  async function completeShellLine(prefix: string): Promise<string[]> {
    try {
      return await invoke<string[]>('os_complete', { prefix })
    } catch {
      return []
    }
  }

  /** Polled from the status bar, so failures stay quiet — the task panel
   *  shows `…` until the API is reachable instead of spamming toasts. */
  async function fetchOsPs() {
    try {
      osPs.value = await invoke<OsPs>('os_ps')
    } catch {
      osPs.value = null
    }
  }

  async function fetchOsTop() {
    try {
      osTop.value = await invoke<OsTop>('os_top')
    } catch (e) {
      notifyError('Failed to fetch system stats', e)
    }
  }

  async function fetchOsWorkers() {
    try {
      osWorkers.value = await invoke<OsWorkers>('os_workers')
    } catch (e) {
      notifyError('Failed to fetch worker pool', e)
    }
  }

  async function fetchOsJobs() {
    try {
      osJobs.value = await invoke<OsJob[]>('os_jobs')
    } catch (e) {
      notifyError('Failed to fetch compute jobs', e)
    }
  }

  async function fetchOsDf() {
    try {
      osDf.value = await invoke<OsVolumeDf>('os_df')
    } catch (e) {
      notifyError('Failed to fetch volume usage', e)
    }
  }

  /** `kill <id>` through the same syscall boundary the terminal uses. */
  async function killOsTask(taskId: number) {
    const result = await execShellLine(`kill ${taskId}`)
    if (!result.ok) {
      notifyError('Failed to kill task', result.output)
      return
    }
    await fetchOsPs()
    notifySuccess(`Task ${taskId} killed`)
  }

  /** `compute run <job> <path>` — starts a fan-out job in the background. */
  async function runComputeJob(job: string, path: string) {
    const result = await execShellLine(`compute run ${job} ${path}`)
    if (!result.ok) notifyError('Failed to start compute job', result.output)
    else notifySuccess(`${job} started on ${osWorkers.value?.total ?? '?'} workers`)
    await fetchOsPs()
    return result
  }

  // ── Actions: AI agent ─────────────────────────────────────
  const agentProviders = ref<ProviderPreset[]>([])
  const agentConfigs = ref<AgentConfig[]>([])
  const agentSessions = ref<AgentSession[]>([])
  const agentJobs = ref<AgentJob[]>([])
  const activeAgentJob = ref<AgentJob | null>(null)

  async function fetchAgentProviders() {
    try {
      agentProviders.value = await invoke<ProviderPreset[]>('list_agent_providers')
    } catch (e) {
      notifyError('Failed to fetch providers', e)
    }
  }

  async function fetchAgentConfigs() {
    try {
      agentConfigs.value = await invoke<AgentConfig[]>('list_agent_configs')
    } catch (e) {
      notifyError('Failed to fetch agent configs', e)
    }
  }

  async function saveAgentConfig(config: Omit<AgentConfig, 'id' | 'hasKey' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    try {
      const saved = await invoke<AgentConfig>('save_agent_config', {
        config: { ...config, id: config.id ?? '', hasKey: false, createdAt: '', updatedAt: '' },
      })
      await fetchAgentConfigs()
      notifySuccess(`Agent config '${saved.name}' saved`)
      return saved
    } catch (e) {
      notifyError('Failed to save agent config', e)
      return null
    }
  }

  async function deleteAgentConfig(configId: string) {
    try {
      await invoke('delete_agent_config', { configId })
      await fetchAgentConfigs()
      notifySuccess('Agent config deleted')
    } catch (e) {
      notifyError('Failed to delete agent config', e)
    }
  }

  async function saveAgentKey(configId: string, apiKey: string) {
    try {
      await invoke('save_agent_key', { configId, apiKey })
      await fetchAgentConfigs()
      notifySuccess('API key sealed')
      return true
    } catch (e) {
      notifyError('Failed to save API key', e)
      return false
    }
  }

  async function refreshAgentModels(configId: string) {
    try {
      return await invoke<string[]>('list_agent_models', { configId })
    } catch (e) {
      notifyError('Model refresh failed', e)
      return null
    }
  }

  async function fetchAgentSessions() {
    try {
      agentSessions.value = await invoke<AgentSession[]>('list_agent_sessions')
    } catch (e) {
      notifyError('Failed to fetch agent sessions', e)
    }
  }

  async function loadAgentSession(sessionId: string) {
    try {
      return await invoke<AgentSession>('get_agent_session', { sessionId })
    } catch (e) {
      notifyError('Failed to load agent session', e)
      return null
    }
  }

  async function deleteAgentSession(sessionId: string) {
    try {
      await invoke('delete_agent_session', { sessionId })
      await fetchAgentSessions()
    } catch (e) {
      notifyError('Failed to delete agent session', e)
    }
  }

  async function startAgentRun(configId: string, prompt: string, sessionId?: string) {
    try {
      const job = await invoke<AgentJob>('start_agent_run', { configId, sessionId, prompt })
      activeAgentJob.value = job
      await subscribeAgentJob(job.jobId)
      return job
    } catch (e) {
      notifyError('Failed to start agent run', e)
      return null
    }
  }

  /**
   * SSE-first job tail (P2.4): `GET /api/agent/jobs/:id/events` streams
   * `job` snapshots over a fetch reader — EventSource cannot send the
   * `Authorization` header, so the poller stays as the fallback. Any
   * transport failure degrades to the 1.5 s `pollAgentJob` loop.
   */
  async function subscribeAgentJob(jobId: string) {
    const applySnapshot = (job: AgentJob) => {
      activeAgentJob.value = job
      const i = agentJobs.value.findIndex(j => j.jobId === jobId)
      if (i >= 0) agentJobs.value[i] = job
      else agentJobs.value.unshift(job)
      announceAgentJob(jobId, job)
      return job.status === 'done' || job.status === 'error' || job.status === 'cancelled'
    }
    try {
      const { getServerUrl, getAuthToken } = await import('@/composables/useTauri')
      const { parseAgentStreamChunk, isStreamDone } = await import('@/utils/agentStream')
      const base = getServerUrl() || 'http://localhost:3456'
      const headers: Record<string, string> = { Accept: 'text/event-stream' }
      const token = getAuthToken()
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${base}/api/agent/jobs/${encodeURIComponent(jobId)}/events`, { headers })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''
        for (const frame of frames) {
          for (const ev of parseAgentStreamChunk(`${frame}\n\n`)) {
            if (isStreamDone(ev.data)) {
              await pollAgentJob(jobId)
              return
            }
            if (ev.event !== 'job') continue
            try {
              if (applySnapshot(JSON.parse(ev.data) as AgentJob)) {
                try { reader.cancel() } catch { /* already closed */ }
                return
              }
            } catch {
              // Malformed frame — the next poll heals the view.
            }
          }
        }
      }
      // Stream ended (cap, idle close) with the job still live.
      const cur = activeAgentJob.value
      if (cur && cur.jobId === jobId && (cur.status === 'running' || cur.status === 'waiting_approval')) {
        await pollAgentJob(jobId)
      }
    } catch {
      await pollAgentJob(jobId)
    }
  }

  async function pollAgentJob(jobId: string) {
    try {
      const job = await invoke<AgentJob>('agent_job_status', { jobId })
      activeAgentJob.value = job
      const i = agentJobs.value.findIndex(j => j.jobId === jobId)
      if (i >= 0) agentJobs.value[i] = job
      else agentJobs.value.unshift(job)
      announceAgentJob(jobId, job)
      if (job.status === 'running' || job.status === 'waiting_approval') {
        setTimeout(() => pollAgentJob(jobId), 1500)
      }
    } catch (e) {
      notifyError('Failed to poll agent job', e)
    }
  }

  /**
   * Announce the two things a user must not miss — the agent is blocked on
   * them, and the run is over — exactly once per job and status.
   */
  const agentJobSeen: Record<string, string> = {}
  function announceAgentJob(jobId: string, job: AgentJob) {
    if (agentJobSeen[jobId] === job.status) return
    agentJobSeen[jobId] = job.status
    if (job.status === 'waiting_approval') {
      const tool = job.pending?.tool ?? 'a tool'
      notifySuccess(`Agent waiting for approval — ${tool}`)
      return
    }
    if (job.status === 'done') {
      const out = (job.result ?? '').trim().split('\n')[0]?.slice(0, 120)
      notifySuccess(out ? `Agent finished — ${out}` : 'Agent finished')
      return
    }
    if (job.status === 'error') notifyError('Agent run failed', job.error ?? 'unknown error')
    if (job.status === 'cancelled') notifySuccess('Agent run cancelled')
  }

  async function abortAgentJob(jobId: string) {
    try {
      await invoke('abort_agent_job', { jobId })
      await pollAgentJob(jobId)
    } catch (e) {
      notifyError('Failed to abort agent job', e)
    }
  }

  async function approveAgentJob(jobId: string, approved: boolean, answer?: string, remember?: boolean) {
    try {
      await invoke('approve_agent_job', { jobId, approved, answer, remember: remember ?? false })
      await pollAgentJob(jobId)
    } catch (e) {
      notifyError('Failed to answer approval', e)
      return null
    }
  }

  async function initAgentRun(configId: string) {
    try {
      const job = await invoke<AgentJob>('init_agent_run', { configId })
      activeAgentJob.value = job
      await subscribeAgentJob(job.jobId)
      notifySuccess('Repo-init started — the agent will write AGENTS.md')
      return job
    } catch (e) {
      notifyError('Failed to start repo-init', e)
      return null
    }
  }

  async function compactAgentSession(configId: string, sessionId: string) {
    try {
      const compacted = await invoke<AgentSession>('compact_agent_session', { configId, sessionId })
      await fetchAgentSessions()
      notifySuccess('Session compacted — old transcript kept for revert')
      return compacted
    } catch (e) {
      notifyError('Compaction failed', e)
      return null
    }
  }

  // ── Semantic memory (redb `agent_memories`: text + vectors) ──
  const agentMemories = ref<AgentMemory[]>([])

  async function fetchAgentMemories(configId?: string) {
    try {
      agentMemories.value = await invoke<AgentMemory[]>('list_agent_memories', { configId })
    } catch (e) {
      notifyError('Failed to fetch memories', e)
    }
  }

  async function storeAgentMemory(configId: string, text: string, sessionId?: string) {
    try {
      const saved = await invoke<AgentMemory>('store_agent_memory', { configId, sessionId, text })
      await fetchAgentMemories(configId)
      notifySuccess('Remembered for future sessions')
      return saved
    } catch (e) {
      notifyError('Failed to store memory', e)
      return null
    }
  }

  async function recallAgentMemories(query: string, configId?: string, topK = 3) {
    try {
      return await invoke<MemoryHit[]>('recall_agent_memories', { configId, query, topK })
    } catch (e) {
      notifyError('Memory recall failed', e)
      return null
    }
  }

  async function deleteAgentMemory(memoryId: string, configId?: string) {
    try {
      await invoke('delete_agent_memory', { memoryId })
      await fetchAgentMemories(configId)
      notifySuccess('Memory deleted')
    } catch (e) {
      notifyError('Failed to delete memory', e)
    }
  }

  async function mcpAddServer(configId: string, name: string, server: McpServerConfig) {
    try {
      const updated = await invoke<AgentConfig>('mcp_add_server', { configId, name, server })
      await fetchAgentConfigs()
      notifySuccess(`MCP server '${name}' attached`)
      return updated
    } catch (e) {
      notifyError('Failed to attach MCP server', e)
      return null
    }
  }

  async function mcpRemoveServer(configId: string, name: string) {
    try {
      await invoke('mcp_remove_server', { configId, name })
      await fetchAgentConfigs()
      notifySuccess(`MCP server '${name}' detached`)
    } catch (e) {
      notifyError('Failed to detach MCP server', e)
    }
  }

  async function mcpListTools(configId: string) {
    try {
      return await invoke<Array<{ server: string; name: string; description: string }>>('mcp_list_tools', { configId })
    } catch (e) {
      notifyError('MCP discovery failed', e)
      return null
    }
  }

  async function fetchDisks() {
    try {
      disks.value = await invoke<DiskRow[]>('list_disks')
    } catch (e) {
      notifyError('Failed to fetch disks', e)
    }
  }

  async function createDisk(configId: string, sizeBytes: number, passphrase: string) {
    try {
      const disk = await invoke<DiskRow>('create_disk', { configId, sizeBytes, passphrase })
      await fetchDisks()
      await fetchOsDf()
      notifySuccess(`Disk created — ${disk?.id ?? 'ok'}`)
      return disk
    } catch (e) {
      notifyError('Failed to create disk', e)
      return null
    }
  }

  async function attachDisk(diskId: string, passphrase: string) {
    try {
      await invoke('attach_disk', { id: diskId, passphrase })
      await fetchDisks()
      await fetchOsDf()
      notifySuccess('Disk attached — volume grew')
    } catch (e) {
      notifyError('Failed to attach disk', e)
    }
  }

  async function detachDisk(diskId: string) {
    try {
      await invoke('detach_disk', { id: diskId })
      await fetchDisks()
      await fetchOsDf()
      notifySuccess('Disk detached')
    } catch (e) {
      notifyError('Failed to detach disk', e)
    }
  }

  async function resizeDisk(diskId: string, sizeBytes: number) {
    try {
      await invoke('resize_disk', { id: diskId, sizeBytes })
      await fetchDisks()
      await fetchOsDf()
      notifySuccess('Disk resized')
    } catch (e) {
      notifyError('Failed to resize disk', e)
    }
  }

  async function checkDisk(diskId: string) {
    try {
      const report = await invoke<{ ok: boolean }>('check_disk', { id: diskId })
      await fetchDisks()
      if (report?.ok) notifySuccess('Disk check passed')
      else notifyError('Disk check found problems', 'see the disk card for details')
      return report
    } catch (e) {
      notifyError('Failed to check disk', e)
      return null
    }
  }

  return {
    // State
    currentPath, currentPanel, viewMode, selectedFileId, sidebarSection, sidebarCollapsed,
    files, accounts, activeAccountId, collections, faceGroups, looseGroups,
    searchResults, geoMarkers, encryptionStatus, encryptionKeys,
    compressionStats, parseResult, syncConfigs, syncProgress,
    syncJobs, syncRuns, syncStatus, repairStatus, scrubRuns, leaseInfo, lastGc,
    osPs, osTop, osWorkers, osJobs, osDf, disks, shellBusy,
    trashItems, showTrashPanel, auditLog, fileVersions, dashboardStatus, shareLinks,
    searchQuery, searchTotalResults, isSearching, isLoading, lastError, matrixRainEnabled,
    showEncryptionPanel, showCompressionPanel, showPermissionsPanel, commandPaletteOpen,
    showShortcutsHelp, createFolderPromptOpen,
    selectedFileIds, isMultiSelect, users, autoRefreshInterval, sortBy,
    // Computed
    currentUser, selectedFile, activeAccount, encryptedFiles, compressedFiles,
    starredFiles, folders, currentFolderFiles,
    // Actions
    initialize, selectFile, toggleStar, clearError,
    fetchFiles, getFile, createFolder, deleteFile, renameFile, duplicateFileContext, setFileTags,
    searchFiles, loadMoreSearchResults, fetchEncryptionStatus, generateKeypair, listKeys, encryptFile, decryptFile,
    compressFile, decompressFile, fetchCollections, createCollection, addToCollection, removeFromCollection,
    fetchFaceGroups, detectFaces, detectFacesBatch, reclusterFaces,
    renameFaceGroup, mergeFaceGroups, deleteFaceGroup, findSimilarFaces,
    fetchAccounts, createAccount, switchAccount, deleteAccount, fetchGeoFiles,
    parseFileCode, parseCodeText, fetchLooseGroups, createLooseGroup, addFileToLooseGroup,
    readManagedContent, saveManagedContent, readWasmFile, saveWasmFile, listWasmDir,
    fetchSyncConfigs, createSyncConfig, saveSyncConfig, probeSyncConnection, deleteSyncConfig, startSync,
    getSyncProgress, testSyncConnection, cancelSync, listRemoteFiles,
    getSyncJob, fetchSyncRuns, fetchSyncStatus, restoreSyncFile, deleteRemoteFile,
    fetchSyncUsage, oauthStart,
    fetchRepairStatus, runRepair, runRebuild, runGc, runScrub, fetchScrubRuns,
    fetchRepairTasks, fetchRepairHealth,
    acquireLease, releaseLease, fetchLeaseStatus,
    // OS layer (cybsh, tasks, compute, disks, volume)
    execShellLine, completeShellLine,
    fetchOsPs, fetchOsTop, fetchOsWorkers, fetchOsJobs, fetchOsDf,
    killOsTask, runComputeJob,
    agentProviders, agentConfigs, agentSessions, agentJobs, activeAgentJob,
    fetchAgentProviders, fetchAgentConfigs, saveAgentConfig, deleteAgentConfig,
    saveAgentKey, refreshAgentModels, fetchAgentSessions, loadAgentSession, deleteAgentSession,
    startAgentRun, pollAgentJob, subscribeAgentJob, abortAgentJob, approveAgentJob, initAgentRun,
    compactAgentSession, mcpAddServer, mcpRemoveServer, mcpListTools,
    agentMemories, fetchAgentMemories, storeAgentMemory, recallAgentMemories, deleteAgentMemory,
    fetchDisks, createDisk, attachDisk, detachDisk, resizeDisk, checkDisk,
    // User Management
    fetchUsers, createUser, deleteUser, updateUserRole,
    // Trash
    fetchTrashItems, restoreTrashItem, emptyTrash, deleteFromTrash,
    // Audit
    fetchAuditLog,
    // Versions
    fetchFileVersions, createVersion, revertToVersion, snapshotAllVersions,
    // Batch
    batchDeleteFiles, batchEncryptFiles, batchCompressFiles,
    // Dashboard
    fetchDashboardStatus, startDashboard, stopDashboard,
    // Share Links
    generateShareLink, fetchShareLinks,
    // URL Import
    importFromUrl,
    // Auth
    setSessionToken, logout,
    // Utility
    rebuildParentIndex,
    notifySuccess,
    notifyError,
  }
})