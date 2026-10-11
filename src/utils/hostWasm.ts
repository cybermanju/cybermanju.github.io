// CyberManju OS — host (device) filesystem bridge for WASM/static builds.
// Role: File System Access API (`showDirectoryPicker`) backend behind the
//   same `/host` namespace + `host:<abs>` ids the Tauri bridge uses, so the
//   FileManager shows identical Host folders on GitHub Pages.
// Exports: `HOST_WASM_DIR_KEY`, `hostWasmSupported`, `pickHostWasmDir`,
//   `listHostWasmDir`, byte/dir verbs, `runWasmHostLine` shell shim,
//   `liveWasmMoveDeps` for `moveAnywhere`.
// Integrates: `@/utils/localDir` (handle persistence + real FSA I/O),
//   `@/utils/hostBrowse` types (`MoveDeps`, `FileNode`), `@/composables/useTauri`
//   (`invoke` for the vault legs of cross-namespace moves).
// Contracts: every failure carries an AGENT-1 prefix (`auth:`/`not_found:`/
//   `integrity:`/`unsupported:`); binary-safe (Uint8Array, no shell caps);
//   `/host` + `/host/` both address the picked `$HOME` root.

import type { FileNode } from '@/types'
import type { MoveDeps } from '@/utils/hostBrowse'
import {
  deleteLocalPath,
  dirPickerSupported,
  ensureLocalDir,
  listLocalDir,
  liveLocalDir,
  mkdirLocalDir,
  readLocalFile,
  reallowLocalDir,
  rememberLocalDir,
  writeLocalFile,
  type FsDirHandle,
} from '@/utils/localDir'
import { idbDel } from '@/utils/idb'

/** IndexedDB key for the picked `$HOME` folder (the WASM `/host` root). */
export const HOST_WASM_DIR_KEY = 'cybermanju.hostDir'

const HOST_VM_ROOT = '/host'

/** True when the dialog browser API exists (Chromium + secure context). */
export function hostWasmSupported(): boolean {
  try {
    return dirPickerSupported()
  } catch {
    return false
  }
}

// ── vm path math (mirrors hostBrowse, duplicated to avoid a module cycle) ──

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

/** Absolute (`/a/b`, `/`, `''`) → path relative to the picked root. */
function relFromAbs(abs: string): string {
  const clean = String(abs ?? '').replace(/\\/g, '/')
  if (!clean || clean === '/') return ''
  return clean.replace(/^\/+/, '')
}

/** vm path → rel inside the picked folder (`/host` → `''`). */
function relFromVm(vmPath: string): string {
  return relFromAbs(wasmAbsFromVm(vmPath))
}

/** rel → absolute (`''` → `/`). */
function absFromRel(rel: string): string {
  const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return clean ? `/${clean}` : '/'
}

/** rel → vm path (`''` → `/host`). */
function vmForRel(rel: string): string {
  const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return clean ? `${HOST_VM_ROOT}/${clean}` : HOST_VM_ROOT
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

// ── handle lifecycle (dialog browser API) ──

async function requireHandle(): Promise<FsDirHandle> {
  if (!hostWasmSupported()) {
    throw new Error('unsupported: this browser has no folder picker — use Chrome/Edge over HTTPS')
  }
  const handle = await liveLocalDir(HOST_WASM_DIR_KEY)
  if (!handle) {
    const st = await ensureLocalDir(HOST_WASM_DIR_KEY).catch(() => null)
    if (st?.status === 'needs-permission') {
      throw new Error('auth: the remembered home folder needs one click to re-allow — pick it again or press re-allow')
    }
    throw new Error('not_found: no home folder picked yet — use “Pick folder…” to load your $HOME into the app')
  }
  return handle
}

/**
 * Dialog browser API: pick the `$HOME` folder whose whole tree loads into
 * the app behind `/host`. Must run in a user gesture (button click).
 * Remembers the handle in IndexedDB so reloads keep working with one
 * re-allow click instead of a re-pick.
 */
export async function pickHostWasmDir(): Promise<{ name: string; rel: string }> {
  if (!hostWasmSupported()) {
    throw new Error('unsupported: this browser has no folder picker (showDirectoryPicker) — use Chrome/Edge over HTTPS')
  }
  const w = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: string }) => Promise<unknown>
  }
  if (typeof w.showDirectoryPicker !== 'function') {
    throw new Error('unsupported: this browser has no folder picker (showDirectoryPicker)')
  }
  let picked: unknown
  try {
    picked = await w.showDirectoryPicker({ mode: 'readwrite' })
  } catch (e) {
    throw new Error(`auth: folder pick was dismissed (${e instanceof Error ? e.message : String(e)})`)
  }
  const ok = await rememberLocalDir(HOST_WASM_DIR_KEY, picked)
  if (!ok) throw new Error('integrity: the picked folder could not be remembered')
  const handle = picked as FsDirHandle
  return { name: String(handle?.name ?? ''), rel: '' }
}

/** Boot-time status of the remembered `$HOME` handle (never prompts). */
export async function hostWasmStatus() {
  return ensureLocalDir(HOST_WASM_DIR_KEY)
}

/** User-gesture re-grant for a parked handle after reload. */
export async function hostWasmReallow(): Promise<boolean> {
  return reallowLocalDir(HOST_WASM_DIR_KEY)
}

export async function hostWasmForget(): Promise<void> {
  await idbDel(HOST_WASM_DIR_KEY)
}

/** Display name of the picked `$HOME` folder ('' when nothing picked). */
export async function hostWasmRootName(): Promise<string> {
  try {
    const h = await liveLocalDir(HOST_WASM_DIR_KEY)
    return String(h?.name ?? '')
  } catch {
    return ''
  }
}

// ── listing + byte verbs (same shapes as the Tauri bridge) ──

/** List one host directory as FileManager rows (`/host…` → `host:<abs>`). */
export async function listHostWasmDir(vmPath: string): Promise<FileNode[]> {
  const handle = await requireHandle()
  const rel = relFromVm(String(vmPath ?? '/host'))
  const vmDir = vmForRel(rel)
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
    const abs = absFromRel(childRel)
    return {
      id: `host:${abs}`,
      name: en.name,
      fileType: en.isDir ? 'folder' : 'file',
      parentId: vmDir,
      path: vmForRel(childRel),
      sizeBytes: Number(en.sizeBytes ?? 0),
      mimeType: en.isDir ? undefined : guessMime(en.name),
      encrypted: false,
      compressionLayers: [],
      createdAt: nowIso(),
      modifiedAt: nowIso(),
      isHidden: en.name.startsWith('.'),
    } as FileNode
  })
}

/** Resolve the `-os` default dir: the picked root (`/`). */
export async function resolveHostWasmDir(vmPath: string): Promise<string> {
  await requireHandle()
  const abs = wasmAbsFromVm(vmPath)
  if (abs) return abs
  return '/'
}

export async function readHostWasmBytes(abs: string): Promise<Uint8Array> {
  const handle = await requireHandle()
  return readLocalFile(handle, relFromAbs(abs))
}

export async function writeHostWasmBytes(abs: string, data: Uint8Array): Promise<void> {
  const handle = await requireHandle()
  await writeLocalFile(handle, relFromAbs(abs), data)
}

export async function mkdirHostWasm(abs: string): Promise<void> {
  const handle = await requireHandle()
  await mkdirLocalDir(handle, relFromAbs(abs))
}

export async function rmHostWasm(abs: string, recursive: boolean): Promise<void> {
  const handle = await requireHandle()
  await deleteLocalPath(handle, relFromAbs(abs), recursive)
}

export async function statHostWasm(abs: string): Promise<{
  path: string
  name: string
  kind: string
  sizeBytes: number
  modifiedMs: number
  isDir: boolean
}> {
  const handle = await requireHandle()
  const rel = relFromAbs(abs)
  if (!rel) {
    return { path: '/', name: String(handle.name ?? ''), kind: 'dir', sizeBytes: 0, modifiedMs: Date.now(), isDir: true }
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

/** Recursive copy inside the picked tree (files verify on read-back). */
export async function cpHostWasm(src: string, dst: string, recursive: boolean): Promise<void> {
  const handle = await requireHandle()
  const srcRel = relFromAbs(src)
  const dstRel = relFromAbs(dst)
  if (!srcRel) throw new Error('invalid: refusing to copy the picked root itself')
  const st = await statHostWasm(src).catch(() => null)
  if (st?.isDir) {
    if (!recursive) throw new Error(`invalid: '${src}' is a directory (use recursive copy)`)
    // Destination joins the source basename when it addresses a dir root
    // that already exists (mirrors `cp -r src dst`).
    let destBase = dstRel
    try {
      const dstStat = await statHostWasm(dst).catch(() => null)
      if (dstStat?.isDir) destBase = dstRel ? `${dstRel}/${srcRel.split('/').pop()}` : (srcRel.split('/').pop() ?? '')
    } catch {
      // Destination missing — created below as the copy target itself.
    }
    await mkdirLocalDir(handle, destBase)
    const walk = async (from: string, to: string): Promise<void> => {
      const kids = await listLocalDir(handle, from)
      for (const k of kids) {
        const s = from ? `${from}/${k.name}` : k.name
        const d = to ? `${to}/${k.name}` : k.name
        if (k.isDir) {
          await mkdirLocalDir(handle, d)
          await walk(s, d)
        } else {
          const bytes = await readLocalFile(handle, s)
          await writeLocalFile(handle, d, bytes)
        }
      }
    }
    await walk(srcRel, destBase)
    return
  }
  // Single file: `dst` may be a dir (join basename) or a file path.
  let fileDst = dstRel
  try {
    const dstStat = await statHostWasm(dst).catch(() => null)
    if (dstStat?.isDir) {
      const base = srcRel.split('/').pop() ?? 'file'
      fileDst = dstRel ? `${dstRel}/${base}` : base
    }
  } catch {
    // Destination missing — treated as the file path itself.
  }
  const bytes = await readLocalFile(handle, srcRel)
  await writeLocalFile(handle, fileDst, bytes)
  const back = await readLocalFile(handle, fileDst)
  if (back.length !== bytes.length) {
    throw new Error(`integrity: '${src}' differs after write — source kept`)
  }
}

export async function mvHostWasm(src: string, dst: string): Promise<void> {
  const handle = await requireHandle()
  const srcRel = relFromAbs(src)
  const dstRel = relFromAbs(dst)
  if (!srcRel) throw new Error('invalid: refusing to move the picked root itself')
  const st = await statHostWasm(src).catch(() => null)
  if (st?.isDir) {
    // Same-tree dir move: recursive copy then delete source (verified).
    await cpHostWasm(src, dst, true)
    await deleteLocalPath(handle, srcRel, true)
    return
  }
  let fileDst = dstRel
  try {
    const dstStat = await statHostWasm(dst).catch(() => null)
    if (dstStat?.isDir) {
      const base = srcRel.split('/').pop() ?? 'file'
      fileDst = dstRel ? `${dstRel}/${base}` : base
    }
  } catch {
    // Destination missing — treated as the file path itself.
  }
  const bytes = await readLocalFile(handle, srcRel)
  await writeLocalFile(handle, fileDst, bytes)
  const back = await readLocalFile(handle, fileDst)
  if (back.length !== bytes.length || !back.every((b, i) => b === bytes[i])) {
    throw new Error(`integrity: '${src}' differs after write — source kept`)
  }
  await deleteLocalPath(handle, srcRel, false)
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
 * `pwd/ls/stat/mkdir/rm/cp/mv/write -os` against the picked folder, so the
 * shared `moveAnywhere` matrix runs unmodified on WASM (its `deps.run`
 * emits exactly these lines).
 */
export async function runWasmHostLine(line: string): Promise<string> {
  const parts = splitArgs(line)
  const verb = String(parts[0] ?? '')
  const flags = parts.filter((p) => p.startsWith('-'))
  const operands = parts.slice(1).filter((p) => !p.startsWith('-')).map(unquote)
  const hasOs = flags.includes('-os') || parts.includes('-os')
  void hasOs
  if (verb === 'pwd') {
    await requireHandle()
    return '/'
  }
  if (verb === 'ls') {
    const abs = operands[0] ?? '/'
    const handle = await requireHandle()
    const rel = relFromAbs(abs === '' ? '/' : abs)
    const rows = await listLocalDir(handle, rel)
    return JSON.stringify({
      path: absFromRel(rel),
      host: true,
      entries: rows.map((r) => ({
        path: absFromRel(rel ? `${rel}/${r.name}` : r.name),
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
