// CyberManju OS — host (device) filesystem bridge for WASM/static builds.
// Role: File System Access API (`showDirectoryPicker`) backend behind the
//   same `/host` namespace + `host:<abs>` ids the Tauri bridge uses, so the
//   FileManager shows identical Host folders on GitHub Pages.
// Exports: `HOST_WASM_DIR_KEY` (legacy single, auto-migrated),
//   `hostWasmSupported`, `pickHostWasmDir` (adds one mount),
//   `listHostWasmMounts`, `removeHostWasmMount`, `hostWasmStatus`,
//   `hostWasmReallow`, `listHostWasmDir`, byte/dir verbs,
//   `runWasmHostLine` shell shim, `liveWasmMoveDeps` for `moveAnywhere`,
//   pure helpers (`isWasmMountRootAbs`, `isPickerCancel`, `isSystemJunk`).
// Integrates: `@/utils/localDir` (real FSA I/O), `@/utils/idb` (handle +
//   registry persistence), `@/utils/hostBrowse` types (`MoveDeps`,
//   `FileNode`), `@/composables/useTauri` (`invoke` for the vault legs of
//   cross-namespace moves).
// Contracts: every failure carries an AGENT-1 prefix (`auth:`/`not_found:`/
//   `invalid:`/`integrity:`/`unsupported:`); binary-safe (Uint8Array, no
//   shell caps). Chromium BLOCKS the whole `$HOME` and the Documents /
//   Downloads / Desktop roots themselves (`kDontBlockChildren` — the roots
//   refuse with "contains system files", children are fine), so this module
//   mounts SUBfolders: `/host` lists the mounts, `/host/<Label>/…` is one
//   picked tree. Mount roots are never deleted — unmount forgets the handle,
//   bytes stay on disk.

import type { FileNode } from '@/types'
import type { MoveDeps } from '@/utils/hostBrowse'
import {
  deleteLocalPath,
  dirPickerSupported,
  listLocalDir,
  mkdirLocalDir,
  readLocalFile,
  reallowLocalDir,
  rememberLocalDir,
  writeLocalFile,
  type FsDirHandle,
} from '@/utils/localDir'
import { idbDel, idbGet, idbSet } from '@/utils/idb'

/** Legacy single `$HOME` handle (auto-migrated into the mounts registry). */
export const HOST_WASM_DIR_KEY = 'cybermanju.hostDir'
/** One remembered handle per mount (`<prefix><mountId>`). */
export const HOST_WASM_MOUNT_PREFIX = 'cybermanju.hostDir:'
/** JSON registry of mounts (`[{ id, label }]`). */
export const HOST_WASM_MOUNT_INDEX = 'cybermanju.hostDir:index'

const HOST_VM_ROOT = '/host'

export interface HostWasmMount {
  id: string
  label: string
}

export type HostWasmMountStatus = 'ready' | 'needs-permission' | 'missing'

export interface HostWasmMountState extends HostWasmMount {
  status: HostWasmMountStatus
  detail: string
}

export interface HostWasmSummary {
  status: 'ready' | 'needs-permission' | 'missing' | 'unsupported'
  detail: string
  total: number
  parked: number
}

/** True when the dialog browser API exists (Chromium + secure context). */
export function hostWasmSupported(): boolean {
  try {
    return dirPickerSupported()
  } catch {
    return false
  }
}

// ── pure helpers ─────────────────────────────────────────────────────

/** `/Documentos/foto.jpg` → `{ label: 'Documentos', rel: 'foto.jpg' }`. */
export function splitWasmAbs(abs: string): { label: string; rel: string } | null {
  const clean = String(abs ?? '').replace(/\\/g, '/')
  if (!clean || clean === '/') return null
  const segs = clean.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (!segs.length) return null
  return { label: segs[0], rel: segs.slice(1).join('/') }
}

/** True for a mount-root absolute (`/Documentos`, never deeper). */
export function isWasmMountRootAbs(abs: string): boolean {
  return /^\/[^/]+$/.test(String(abs ?? '').replace(/\\/g, '/'))
}

/** True when the user dismissed the picker (silent cancel, never an error). */
export function isPickerCancel(e: unknown): boolean {
  return (
    !!e &&
    typeof e === 'object' &&
    (e as { name?: unknown }).name === 'AbortError'
  )
}

/**
 * OS metadata junk never worth showing (`Thumbs.db`, `.DS_Store`,
 * `desktop.ini`, trash/recycle roots…). Listed rows carry it as
 * `isHidden`, so the FileManager hides it unless "hidden" is on.
 */
const SYSTEM_JUNK = new Set([
  'thumbs.db',
  'desktop.ini',
  '.ds_store',
  '.spotlight-v100',
  '.trashes',
  '.fseventsd',
  '.temporaryitems',
  '.apdisk',
  'system volume information',
  '$recycle.bin',
  'lost+found',
  'network trash folder',
  'temporary items',
])

export function isSystemJunk(name: string): boolean {
  const n = String(name ?? '').toLowerCase()
  if (!n) return false
  if (SYSTEM_JUNK.has(n)) return true
  // Per-volume trash roots (`.Trash-1000`, `.Trash-501`, …).
  return /^\.trash-\d+$/.test(n)
}

/** `/host/a/b` → `/a/b`; `/host` → `''`; `/host/` → `/`. */
function wasmAbsFromVm(vmPath: string): string {
  const norm = String(vmPath ?? '').replace(/\\/g, '/')
  if (norm === HOST_VM_ROOT || norm === `${HOST_VM_ROOT}/`) {
    return norm.endsWith('/') && norm.length > HOST_VM_ROOT.length ? '/' : ''
  }
  if (!norm.startsWith(`${HOST_VM_ROOT}/`)) return ''
  const rest = norm.slice(HOST_VM_ROOT.length)
  if (rest === '/') return '/'
  if (/^\/[A-Za-z]:(\/|$)/.test(rest)) return rest.slice(1)
  return rest
}

/** Mount label + rel → absolute (`{Documentos, a/b}` → `/Documentos/a/b`). */
function absFromMountRel(label: string, rel: string): string {
  const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return clean ? `/${label}/${clean}` : `/${label}`
}

/** Mount label + rel → vm path (`{Documentos, a/b}` → `/host/Documentos/a/b`). */
function vmForMountRel(label: string, rel: string): string {
  const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return clean ? `${HOST_VM_ROOT}/${label}/${clean}` : `${HOST_VM_ROOT}/${label}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function guessMime(name: string): string {
  const ext = String(name ?? '').split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) {
    return ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
  }
  if (['mp4', 'webm', 'mov'].includes(ext)) return `video/${ext}`
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return `audio/${ext}`
  if (ext === 'pdf') return 'application/pdf'
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return 'application/zip'
  if (['txt', 'md', 'csv', 'log'].includes(ext)) return 'text/plain'
  if (['json', 'html', 'css', 'js', 'ts', 'py', 'rs'].includes(ext)) return `text/${ext}`
  return 'application/octet-stream'
}

function slugify(name: string): string {
  const clean = String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return clean || 'pasta'
}

function shortId(): string {
  try {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return (buf[0] % 1296).toString(36).padStart(2, '0') +
      (Math.floor(buf[0] / 1296) % 1296).toString(36).padStart(2, '0')
  } catch {
    return Math.random().toString(36).slice(2, 6)
  }
}

// ── registry + handles ─────────────────────────────────────────────

function isHandle(v: unknown): v is FsDirHandle {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as FsDirHandle).getFileHandle === 'function' &&
    typeof (v as FsDirHandle).getDirectoryHandle === 'function'
  )
}

async function readMountIndex(): Promise<HostWasmMount[]> {
  try {
    const raw = await idbGet<unknown>(HOST_WASM_MOUNT_INDEX)
    if (!Array.isArray(raw)) return []
    return raw
      .filter((r): r is { id: unknown; label: unknown } => !!r && typeof r === 'object')
      .filter((r) => typeof r.id === 'string' && r.id && typeof r.label === 'string' && r.label)
      .map((r) => ({ id: r.id as string, label: r.label as string }))
  } catch {
    return []
  }
}

async function writeMountIndex(mounts: HostWasmMount[]): Promise<void> {
  await idbSet(HOST_WASM_MOUNT_INDEX, mounts.map((m) => ({ id: m.id, label: m.label })))
}

async function loadMountHandle(mount: HostWasmMount): Promise<FsDirHandle | null> {
  try {
    const raw = await idbGet<unknown>(`${HOST_WASM_MOUNT_PREFIX}${mount.id}`)
    return isHandle(raw) ? raw : null
  } catch {
    return null
  }
}

async function queryGranted(handle: FsDirHandle): Promise<boolean> {
  try {
    return (await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

/** One-time adoption of the legacy single `$HOME` handle into the registry. */
async function ensureMigrated(): Promise<void> {
  try {
    const legacy = await idbGet<unknown>(HOST_WASM_DIR_KEY)
    if (!isHandle(legacy)) return
    const index = await readMountIndex()
    if (index.length) {
      // Mounts already exist — the legacy handle is superseded.
      await idbDel(HOST_WASM_DIR_KEY)
      return
    }
    const label = String(legacy.name || 'Home').trim() || 'Home'
    const id = `${slugify(label)}-${shortId()}`
    const ok = await idbSet(`${HOST_WASM_MOUNT_PREFIX}${id}`, legacy as unknown as Record<string, unknown>)
    if (ok) {
      await writeMountIndex([{ id, label }])
      await idbDel(HOST_WASM_DIR_KEY)
    }
  } catch {
    // IndexedDB unavailable — mounts simply stay empty.
  }
}

// ── test seam (node has no picker/IndexedDB; tests inject a fake handle) ──

let testMount: { mount: HostWasmMount; handle: FsDirHandle } | null = null

/** Inject a fake mount for unit tests (bypasses picker + IndexedDB). */
export function setHostWasmTestHandle(mount: HostWasmMount, handle: FsDirHandle): void {
  testMount = { mount, handle }
}

/** Clear the injected test mount + any cached state. */
export function resetHostWasmTestState(): void {
  testMount = null
}

// ── mount lifecycle (dialog browser API) ───────────────────────────

/**
 * List every added folder with live permission state (never prompts).
 * Parked handles (`needs-permission`) stay listed — opening one explains
 * the one-click re-allow instead of failing silently.
 */
export async function listHostWasmMounts(): Promise<HostWasmMountState[]> {
  if (testMount) {
    return [{ ...testMount.mount, status: 'ready', detail: 'test mount' }]
  }
  if (!hostWasmSupported()) return []
  await ensureMigrated()
  const index = await readMountIndex()
  const out: HostWasmMountState[] = []
  for (const m of index) {
    const handle = await loadMountHandle(m)
    if (!handle) {
      out.push({ ...m, status: 'missing', detail: 'remembered folder is unreadable — remove and re-add it' })
      continue
    }
    if (await queryGranted(handle)) {
      out.push({ ...m, status: 'ready', detail: 'attached' })
    } else {
      out.push({ ...m, status: 'needs-permission', detail: 'remembered — one click re-allows access (no re-pick)' })
    }
  }
  return out
}

/** Aggregate status for banners (never prompts). */
export async function hostWasmStatus(): Promise<HostWasmSummary> {
  if (!hostWasmSupported()) {
    return { status: 'unsupported', detail: 'no folder picker in this browser', total: 0, parked: 0 }
  }
  const mounts = await listHostWasmMounts()
  if (!mounts.length) {
    return { status: 'missing', detail: 'no folder added yet — use Add folder', total: 0, parked: 0 }
  }
  const parked = mounts.filter((m) => m.status !== 'ready').length
  if (parked === mounts.length) {
    return { status: 'needs-permission', detail: 'remembered — one click re-allows access (no re-pick)', total: mounts.length, parked }
  }
  return {
    status: 'ready',
    detail: parked ? `${mounts.length - parked} of ${mounts.length} attached` : 'attached',
    total: mounts.length,
    parked,
  }
}

/**
 * Dialog browser API: add one external folder behind `/host/<Label>`.
 * Must run in a user gesture (button click). Chromium BLOCKS the whole
 * `$HOME` and the Documents/Downloads/Desktop roots ("contains system
 * files") — pick a SUBfolder (e.g. create `CyberManju` inside Documents).
 * Cancelling rethrows the DOM `AbortError` untouched so callers stay
 * silent; anything else carries an AGENT-1 prefix with subfolder guidance.
 */
export async function pickHostWasmDir(): Promise<{ id: string; label: string; name: string }> {
  if (!hostWasmSupported()) {
    throw new Error('unsupported: this browser has no folder picker (showDirectoryPicker) — use Chrome/Edge over HTTPS')
  }
  const w = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: string; startIn?: string }) => Promise<unknown>
  }
  if (typeof w.showDirectoryPicker !== 'function') {
    throw new Error('unsupported: this browser has no folder picker (showDirectoryPicker)')
  }
  let picked: unknown
  try {
    // `startIn: documents` opens the dialog where subfolders are pickable.
    picked = await w.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' })
  } catch (e) {
    // User cancelled — callers (`isPickerCancel`) stay silent, no toast.
    if (isPickerCancel(e)) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) {
      throw new Error(
        `unsupported: Chrome blocked that folder (system folders and the whole $HOME are off-limits) — create/select a SUBfolder instead, e.g. Documents/CyberManju, then pick it (${msg})`,
      )
    }
    throw new Error(`auth: folder pick failed (${msg})`)
  }
  if (!isHandle(picked)) throw new Error('integrity: the picked folder is not a directory handle')
  const handle = picked as FsDirHandle
  const name = String(handle.name || '').trim() || 'Folder'
  await ensureMigrated()
  const index = await readMountIndex()
  const taken = new Set(index.map((m) => m.label.toLowerCase()))
  let label = name
  for (let n = 2; taken.has(label.toLowerCase()); n++) label = `${name} ${n}`
  const id = `${slugify(label)}-${shortId()}`
  const ok = await rememberLocalDir(`${HOST_WASM_MOUNT_PREFIX}${id}`, picked)
  if (!ok) throw new Error('integrity: the picked folder could not be remembered')
  await writeMountIndex([...index, { id, label }])
  return { id, label, name }
}

/** Forget one mount (bytes stay on disk — unmount, never delete). */
export async function removeHostWasmMount(idOrLabel: string): Promise<void> {
  const mounts = await listHostWasmMounts()
  const hit = mounts.find((m) => m.id === idOrLabel || m.label === idOrLabel)
  if (!hit) throw new Error(`not_found: no mounted folder '${idOrLabel}'`)
  await idbDel(`${HOST_WASM_MOUNT_PREFIX}${hit.id}`)
  await writeMountIndex(mounts.filter((m) => m.id !== hit.id).map(({ id, label }) => ({ id, label })))
}

/** User-gesture re-grant for parked handles. True when none stay parked. */
export async function hostWasmReallow(): Promise<boolean> {
  if (!hostWasmSupported()) return false
  await ensureMigrated()
  const index = await readMountIndex()
  for (const m of index) {
    try {
      await reallowLocalDir(`${HOST_WASM_MOUNT_PREFIX}${m.id}`)
    } catch {
      // One denied handle never blocks the rest.
    }
  }
  const after = await hostWasmStatus().catch(() => null)
  return (after?.parked ?? 1) === 0
}

/** Display label for the `/host` root banner (`2 folder(s)` / ''). */
export async function hostWasmRootName(): Promise<string> {
  try {
    const mounts = await listHostWasmMounts()
    return mounts.length ? `${mounts.length} folder(s)` : ''
  } catch {
    return ''
  }
}

async function requireMount(label: string): Promise<FsDirHandle> {
  if (!hostWasmSupported()) {
    throw new Error('unsupported: this browser has no folder picker — use Chrome/Edge over HTTPS')
  }
  if (testMount && testMount.mount.label === label) return testMount.handle
  await ensureMigrated()
  const index = await readMountIndex()
  if (!index.length) {
    throw new Error('not_found: no folder added yet — use “Add folder…” to load an external folder into the app')
  }
  const mount = index.find((m) => m.label === label)
  if (!mount) {
    const known = index.map((m) => `“${m.label}”`).join(', ')
    throw new Error(`not_found: “${label}” is not a mounted folder (mounted: ${known || 'none'})`)
  }
  const handle = await loadMountHandle(mount)
  if (!handle) {
    throw new Error(`not_found: “${label}” is remembered but unreadable — remove it and add the folder again`)
  }
  if (!(await queryGranted(handle))) {
    throw new Error(`auth: “${label}” needs one click to re-allow — press Re-allow and grant access`)
  }
  return handle
}

async function resolveMountRel(abs: string): Promise<{ label: string; handle: FsDirHandle; rel: string }> {
  const split = splitWasmAbs(abs)
  if (!split) throw new Error(`invalid: '${abs}' is not inside a mounted folder`)
  const handle = await requireMount(split.label)
  return { label: split.label, handle, rel: split.rel }
}

// ── listing + byte verbs (same shapes as the Tauri bridge) ──

/** List one host directory as FileManager rows (`/host…` → `host:<abs>`). */
export async function listHostWasmDir(vmPath: string): Promise<FileNode[]> {
  const norm = String(vmPath ?? '/host').replace(/\\/g, '/')
  // Virtual root: the mounts themselves (parked ones included — opening
  // one explains the one-click re-allow).
  if (norm === HOST_VM_ROOT || norm === `${HOST_VM_ROOT}/`) {
    if (!hostWasmSupported()) {
      throw new Error('unsupported: this browser has no folder picker — use Chrome/Edge over HTTPS')
    }
    const mounts = await listHostWasmMounts()
    if (!mounts.length) {
      throw new Error('not_found: no folder added yet — use “Add folder…” to load an external folder into the app')
    }
    return mounts.map((m) => ({
      id: `host:/${m.label}`,
      name: m.status === 'ready' ? m.label : `${m.label} (${m.status})`,
      fileType: 'folder',
      parentId: HOST_VM_ROOT,
      path: `${HOST_VM_ROOT}/${m.label}`,
      sizeBytes: 0,
      encrypted: false,
      compressionLayers: [],
      createdAt: nowIso(),
      modifiedAt: nowIso(),
      isHidden: false,
    }) as FileNode)
  }
  const abs = wasmAbsFromVm(norm)
  if (!abs) throw new Error(`not_found: '${vmPath}' is not reachable`)
  const { label, handle, rel } = await resolveMountRel(abs)
  const vmDir = vmForMountRel(label, rel)
  let entries: Awaited<ReturnType<typeof listLocalDir>>
  try {
    entries = await listLocalDir(handle, rel)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/^(invalid|not_found|integrity|unsupported|auth):/.test(msg)) throw e
    throw new Error(`not_found: '${vmPath}' is not reachable (${msg})`)
  }
  return entries.map((en) => {
    const childRel = rel ? `${rel}/${en.name}` : en.name
    const childAbs = absFromMountRel(label, childRel)
    const junk = !en.isDir && isSystemJunk(en.name)
    return {
      id: `host:${childAbs}`,
      name: en.name,
      fileType: en.isDir ? 'folder' : 'file',
      parentId: vmDir,
      path: vmForMountRel(label, childRel),
      sizeBytes: Number(en.sizeBytes ?? 0),
      mimeType: en.isDir ? undefined : guessMime(en.name),
      encrypted: false,
      compressionLayers: [],
      createdAt: nowIso(),
      modifiedAt: nowIso(),
      isHidden: en.name.startsWith('.') || junk,
    } as FileNode
  })
}

/** Resolve an absolute behind a listing (`/host` itself has none — virtual). */
export async function resolveHostWasmDir(vmPath: string): Promise<string> {
  const abs = wasmAbsFromVm(vmPath)
  if (!abs) {
    throw new Error('invalid: /host lists the added folders — open one of them (or Add folder) instead of resolving the list itself')
  }
  return abs
}

export async function readHostWasmBytes(abs: string): Promise<Uint8Array> {
  const { handle, rel } = await resolveMountRel(abs)
  if (!rel) throw new Error(`invalid: '${abs}' is a mounted folder — open it instead of reading it`)
  return readLocalFile(handle, rel)
}

export async function writeHostWasmBytes(abs: string, data: Uint8Array): Promise<void> {
  const { handle, rel } = await resolveMountRel(abs)
  if (!rel) throw new Error(`invalid: '${abs}' is a mounted folder — pick a file inside it`)
  await writeLocalFile(handle, rel, data)
}

export async function mkdirHostWasm(abs: string): Promise<void> {
  const { handle, rel } = await resolveMountRel(abs)
  // The mount root is the picked folder itself — nothing to create.
  if (!rel) return
  await mkdirLocalDir(handle, rel)
}

export async function rmHostWasm(abs: string, recursive: boolean): Promise<void> {
  const clean = String(abs ?? '').replace(/\\/g, '/')
  if (!clean || clean === '/') {
    throw new Error('invalid: refusing to delete the folders list — unmount one folder instead')
  }
  const { handle, rel } = await resolveMountRel(abs)
  if (!rel) {
    // A mount root is a whole picked tree — never byte-delete it here.
    // Unmount (forget the handle, bytes stay on disk) is the safe removal.
    throw new Error(`invalid: '${abs}' is a mounted folder — unmount it instead of deleting (bytes stay on disk)`)
  }
  await deleteLocalPath(handle, rel, recursive)
}

export async function statHostWasm(abs: string): Promise<{
  path: string
  name: string
  kind: string
  sizeBytes: number
  modifiedMs: number
  isDir: boolean
}> {
  const clean = String(abs ?? '').replace(/\\/g, '/')
  if (!clean || clean === '/') {
    return { path: '/', name: 'Device', kind: 'dir', sizeBytes: 0, modifiedMs: Date.now(), isDir: true }
  }
  const { label, handle, rel } = await resolveMountRel(abs)
  if (!rel) {
    return { path: abs, name: label, kind: 'dir', sizeBytes: 0, modifiedMs: Date.now(), isDir: true }
  }
  const segs = rel.split('/').filter(Boolean)
  const name = segs[segs.length - 1] ?? ''
  const parentRel = segs.slice(0, -1).join('/')
  const rows = await listLocalDir(handle, parentRel)
  const hit = rows.find((r) => r.name === name)
  if (!hit) throw new Error(`not_found: '${abs}' is not reachable`)
  return {
    path: abs,
    name,
    kind: hit.isDir ? 'dir' : 'file',
    sizeBytes: Number(hit.sizeBytes ?? 0),
    modifiedMs: Date.now(),
    isDir: hit.isDir,
  }
}

export async function writeHostWasmText(abs: string, content: string): Promise<void> {
  if (content.length > 1024 * 1024) {
    throw new Error(`too_large: content is ${content.length} bytes, shell write limit is ${1024 * 1024}`)
  }
  await writeHostWasmBytes(abs, new TextEncoder().encode(content))
}

/** Recursive copy inside/between mounted trees (files verify on read-back). */
export async function cpHostWasm(src: string, dst: string, recursive: boolean): Promise<void> {
  const s = await resolveMountRel(src)
  if (!s.rel) throw new Error(`invalid: refusing to copy the mounted folder '${src}' itself — copy the files inside it`)
  const st = await statHostWasm(src).catch(() => null)
  if (st?.isDir) {
    if (!recursive) throw new Error(`invalid: '${src}' is a directory (use recursive copy)`)
    const d = await resolveMountRel(dst)
    let destBase = d.rel
    const dstStat = await statHostWasm(dst).catch(() => null)
    if (dstStat?.isDir) {
      const base = s.rel.split('/').pop() ?? 'folder'
      destBase = d.rel ? `${d.rel}/${base}` : base
    }
    if (!destBase) throw new Error(`invalid: cannot copy a folder onto the folders list`)
    // Cross-mount copies resolve each side against its own handle.
    const walk = async (
      fromHandle: FsDirHandle,
      from: string,
      toHandle: FsDirHandle,
      to: string,
    ): Promise<void> => {
      const kids = await listLocalDir(fromHandle, from)
      for (const k of kids) {
        const ks = from ? `${from}/${k.name}` : k.name
        const kd = to ? `${to}/${k.name}` : k.name
        if (k.isDir) {
          await mkdirLocalDir(toHandle, kd)
          await walk(fromHandle, ks, toHandle, kd)
        } else {
          const bytes = await readLocalFile(fromHandle, ks)
          await writeLocalFile(toHandle, kd, bytes)
        }
      }
    }
    await mkdirLocalDir(d.handle, destBase)
    await walk(s.handle, s.rel, d.handle, destBase)
    return
  }
  const d = await resolveMountRel(dst)
  let fileDst = d.rel
  const dstStat = await statHostWasm(dst).catch(() => null)
  if (dstStat?.isDir) {
    const base = s.rel.split('/').pop() ?? 'file'
    fileDst = d.rel ? `${d.rel}/${base}` : base
  }
  if (!fileDst) throw new Error(`invalid: cannot copy a file onto the folders list`)
  const bytes = await readLocalFile(s.handle, s.rel)
  await writeLocalFile(d.handle, fileDst, bytes)
  const back = await readLocalFile(d.handle, fileDst)
  if (back.length !== bytes.length) {
    throw new Error(`integrity: '${src}' differs after write — source kept`)
  }
}

export async function mvHostWasm(src: string, dst: string): Promise<void> {
  const s = await resolveMountRel(src)
  if (!s.rel) throw new Error(`invalid: '${src}' is a mounted folder — unmount it instead of moving (bytes stay on disk)`)
  const st = await statHostWasm(src).catch(() => null)
  if (st?.isDir) {
    // Same-tree dir move: recursive copy then delete source (verified).
    await cpHostWasm(src, dst, true)
    await deleteLocalPath(s.handle, s.rel, true)
    return
  }
  const d = await resolveMountRel(dst)
  let fileDst = d.rel
  const dstStat = await statHostWasm(dst).catch(() => null)
  if (dstStat?.isDir) {
    const base = s.rel.split('/').pop() ?? 'file'
    fileDst = d.rel ? `${d.rel}/${base}` : base
  }
  if (!fileDst) throw new Error(`invalid: cannot move a file onto the folders list`)
  const bytes = await readLocalFile(s.handle, s.rel)
  await writeLocalFile(d.handle, fileDst, bytes)
  const back = await readLocalFile(d.handle, fileDst)
  if (back.length !== bytes.length || !back.every((b, i) => b === bytes[i])) {
    throw new Error(`integrity: '${src}' differs after write — source kept`)
  }
  await deleteLocalPath(s.handle, s.rel, false)
}

// ── shell shim: the same `-os` verbs hostBrowse emits, served from FSA ──

function unquote(token: string): string {
  const t = String(token ?? '').trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return t
}

function splitArgs(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  let esc = false
  for (const ch of String(line ?? '')) {
    if (esc) {
      cur += ch === '"' ? '"' : `\\${ch}`
      esc = false
      continue
    }
    if (ch === '\\' && inQ) {
      esc = true
      continue
    }
    if (ch === '"') {
      inQ = !inQ
      cur += ch
      continue
    }
    if (!inQ && /\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/**
 * `pwd/ls/stat/mkdir/rm/cp/mv/write -os` against the mounted folders, so
 * the shared `moveAnywhere` matrix runs unmodified on WASM (its `deps.run`
 * emits exactly these lines). `/` is the virtual folders list.
 */
export async function runWasmHostLine(line: string): Promise<string> {
  const parts = splitArgs(line)
  const verb = String(parts[0] ?? '')
  const flags = parts.filter((p) => p.startsWith('-'))
  const operands = parts.slice(1).filter((p) => !p.startsWith('-')).map(unquote)
  if (verb === 'pwd') {
    if (!hostWasmSupported()) throw new Error('unsupported: this browser has no folder picker')
    return '/'
  }
  if (verb === 'ls') {
    const abs = operands[0] ?? '/'
    if (abs === '' || abs === '/') {
      const mounts = await listHostWasmMounts()
      const ready = mounts.filter((m) => m.status === 'ready')
      return JSON.stringify({
        path: '/',
        host: true,
        entries: ready.map((m) => ({
          path: `/${m.label}`,
          name: m.label,
          kind: 'dir',
          sizeBytes: 0,
          modifiedMs: Date.now(),
          isDir: true,
        })),
      })
    }
    const { label, handle, rel } = await resolveMountRel(abs)
    const rows = await listLocalDir(handle, rel)
    return JSON.stringify({
      path: abs,
      host: true,
      entries: rows.map((r) => ({
        path: absFromMountRel(label, rel ? `${rel}/${r.name}` : r.name),
        name: r.name,
        kind: r.isDir ? 'dir' : 'file',
        sizeBytes: Number(r.sizeBytes ?? 0),
        modifiedMs: Date.now(),
        isDir: r.isDir,
      })),
    })
  }
  if (verb === 'stat') {
    const abs = operands[0] ?? '/'
    return JSON.stringify(await statHostWasm(abs === '' ? '/' : abs))
  }
  if (verb === 'mkdir') {
    const abs = operands[operands.length - 1] ?? '/'
    await mkdirHostWasm(abs === '' ? '/' : abs)
    return ''
  }
  if (verb === 'rm') {
    const abs = operands[operands.length - 1] ?? ''
    const recursive = flags.includes('-r') || flags.includes('-R')
    await rmHostWasm(abs === '' ? '/' : abs, recursive)
    return ''
  }
  if (verb === 'cp') {
    const recursive = flags.includes('-r') || flags.includes('-R')
    const [src, dst] = operands.slice(-2)
    if (!src || !dst) throw new Error('invalid: cp needs a source and a destination')
    await cpHostWasm(src, dst, recursive)
    return ''
  }
  if (verb === 'mv') {
    const [src, dst] = operands.slice(-2)
    if (!src || !dst) throw new Error('invalid: mv needs a source and a destination')
    await mvHostWasm(src, dst)
    return ''
  }
  if (verb === 'write') {
    const [abs, ...rest] = operands
    if (!abs) throw new Error('invalid: write needs a path')
    // hostBrowse escapes content as trailing argv words joined with spaces.
    const content = rest.join(' ')
    await writeHostWasmText(abs, content)
    return ''
  }
  throw new Error(`unsupported: wasm host shell has no verb '${verb}'`)
}

// ── MoveDeps for the shared moveAnywhere matrix ──

/** WASM legs for `moveAnywhere`: FSA host bytes + live vault invoke. */
export async function liveWasmMoveDeps(): Promise<MoveDeps> {
  const { invoke } = await import('@/composables/useTauri')
  const { readVfsFile, writeVfsFile, deleteVfsFile, listVfsDir } = await import(
    '@/composables/useProviderCanal'
  )
  return {
    run: runWasmHostLine,
    invoke: invoke as MoveDeps['invoke'],
    canal: {
      readProviderFile: async (mountId, remotePath, locator) =>
        (await readVfsFile(mountId, remotePath, { locator: locator || remotePath })).bytes,
      writeProviderFile: async (mountId, remotePath, data) => {
        await writeVfsFile(mountId, remotePath, data)
      },
      deleteProviderFile: async (mountId, remotePath, locator) => {
        await deleteVfsFile(mountId, remotePath, { locator: locator || remotePath })
      },
      listProviderDir: async (mountId, remotePath) => {
        const rows = await listVfsDir(mountId, remotePath)
        return rows.map((e) => ({
          name: e.name,
          path: e.path,
          locator: e.locator || e.path,
          isDir: e.isDir,
          sizeBytes: Number(e.sizeBytes ?? 0),
        }))
      },
    },
    listVaultDir: async (vaultPath: string) =>
      invoke<FileNode[]>('list_files', { parentPath: vaultPath }),
    readHostBytes: readHostWasmBytes,
    writeHostBytes: writeHostWasmBytes,
  }
}
