#!/usr/bin/env node
// CyberManju OS — The Stem Array dev runtime (scripts/vn-dev.mjs).
// Role: serves a Ren'Py Web build on the LAN with a live-reload channel, a
//       performance HUD and two asset profiles, so the phone that actually
//       stutters can A/B text speed, transitions, prediction depth and image
//       bytes without a rebuild or a devtools connection.
// Exports: `pnpm vn` CLI only (no programmatic API); endpoints /__vn/state,
//       /__vn/events (SSE), /__vn/report and /__vn/overlay.js for the HUD.
// Integrates: scripts/vn-assets.py (streamed-image derivatives), the Ren'Py
//       runtime output from .github/workflows/renpy-ci.yml or
//       public/technosutra-vn, and renpy-pre.js (renpy_exec) inside the page.
// Contracts: never writes inside the served runtime; brotli/gzip on the fly
//       with byte-range passthrough for game.zip; the service worker is a
//       no-op unless --sw=prod (a stale cache must never hide a change during
//       perf work); .rpy edits are reported as "rebuild needed", never faked.

import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { createReadStream, promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INTEGRATION = path.join(REPO_ROOT, 'integrations', 'renpy-technosutra')
const DEFAULT_RUNTIME = path.join(REPO_ROOT, 'public', 'technosutra-vn')
const DEFAULT_PORT = 5175
const REQUIRED_RUNTIME_FILES = ['index.html', 'renpy.js', 'renpy.wasm', 'renpy.data', 'game.zip']
const ENGINE_FILES = ['renpy.wasm', 'renpy.data', 'game.zip', 'renpy.js', 'renpy-pre.js']

// ── CLI ────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const options = {
    host: process.env.VN_HOST || '0.0.0.0',
    port: Number(process.env.VN_PORT || DEFAULT_PORT),
    build: process.env.VN_BUILD_DIR || '',
    assets: process.env.VN_ASSETS || 'fast',
    sprites: process.env.VN_SPRITES || 'webp',
    sw: process.env.VN_SW || 'off',
    lossless: process.env.VN_LOSSLESS === '1',
    open: false,
    watch: true,
    quiet: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    const value = () => (inline !== undefined ? inline : argv[++index])
    switch (flag) {
      case '--build':
      case '--runtime':
        options.build = value()
        break
      case '--host':
        options.host = value()
        break
      case '--port':
        options.port = Number(value())
        break
      case '--assets':
        options.assets = value()
        break
      case '--sprites':
        options.sprites = value()
        break
      case '--sw':
        options.sw = value()
        break
      case '--lossless':
        options.lossless = true
        break
      case '--open':
        options.open = true
        break
      case '--no-watch':
        options.watch = false
        break
      case '--quiet':
        options.quiet = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break
      default:
        console.error(`vn: unknown option ${flag}`)
        printHelp()
        process.exit(2)
    }
  }
  if (!['fast', 'raw'].includes(options.assets)) throw new Error('--assets must be fast or raw')
  if (!['off', 'prod'].includes(options.sw)) throw new Error('--sw must be off or prod')
  if (!['webp', 'png'].includes(options.sprites)) throw new Error('--sprites must be webp or png')
  return options
}

function printHelp() {
  console.log(`pnpm vn — serve The Stem Array Ren'Py Web build for device perf work

  --build <dir>     runtime output dir, or a parent that contains */output (default: newest local build, else public/technosutra-vn)
  --host <addr>     bind address (default 0.0.0.0, visible on the LAN)
  --port <n>        port (default ${DEFAULT_PORT})
  --assets fast|raw stream re-encoded images (default fast) or the CI originals
  --sprites webp|png  derivative codec for the 54 sprites (default webp)
  --sw off|prod     no-op service worker (default) or the shipped cache-first worker
  --lossless        lossless high compression (WebP method=6) for backgrounds + sprites
  --open            open the local URL in the default browser
  --no-watch        disable the live-reload watchers
  --quiet           only print warnings and perf reports

Runtime swaps (a new Ren'Py build appearing under --build) hot-reload every
connected page. .rpy edits cannot be compiled without the SDK, so they raise a
"rebuild needed" notice instead of pretending to reload.`)
}

// ── small utilities ───────────────────────────────────────────────────────────
const color = process.stdout.isTTY
  ? { dim: '\u001b[2m', cyan: '\u001b[36m', green: '\u001b[32m', yellow: '\u001b[33m', red: '\u001b[31m', bold: '\u001b[1m', off: '\u001b[0m' }
  : { dim: '', cyan: '', green: '', yellow: '', red: '', bold: '', off: '' }

function log(message) {
  if (!options.quiet) console.log(`${color.dim}vn${color.off} ${message}`)
}
function warn(message) {
  console.warn(`${color.yellow}vn${color.off} ${message}`)
}
function fail(message) {
  console.error(`${color.red}vn${color.off} ${message}`)
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function isRuntimeDir(dir) {
  for (const file of REQUIRED_RUNTIME_FILES) {
    if (!(await exists(path.join(dir, file)))) return false
  }
  return true
}

async function newestMtime(dir, depth = 0) {
  if (depth > 4) return 0
  let newest = 0
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue
    const full = path.join(dir, entry.name)
    try {
      const stat = await fs.stat(full)
      newest = Math.max(newest, stat.mtimeMs)
      if (entry.isDirectory()) newest = Math.max(newest, await newestMtime(full, depth + 1))
    } catch {
      // vanished mid-scan
    }
  }
  return newest
}

async function listRuntimeDirs(parent, depth = 0) {
  const found = []
  if (depth > 3) return found
  if (await isRuntimeDir(parent)) return [parent]
  let entries
  try {
    entries = await fs.readdir(parent, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
    found.push(...(await listRuntimeDirs(path.join(parent, entry.name), depth + 1)))
  }
  return found
}

async function resolveRuntime(spec) {
  if (spec) {
    const absolute = path.resolve(spec)
    if (!(await exists(absolute))) throw new Error(`runtime path not found: ${absolute}`)
    const candidates = await listRuntimeDirs(absolute)
    if (!candidates.length) throw new Error(`no Ren'Py Web runtime (index.html + renpy.wasm + game.zip) under ${absolute}`)
    candidates.sort((a, b) => b.length - a.length)
    return { root: candidates[0], scanned: absolute }
  }
  const localBuilds = await listRuntimeDirs(path.join(INTEGRATION, 'build'))
  if (localBuilds.length) {
    const ranked = []
    for (const dir of localBuilds) {
      const zip = path.join(dir, 'game.zip')
      ranked.push({ dir, at: (await fs.stat(zip)).mtimeMs })
    }
    ranked.sort((a, b) => b.at - a.at)
    return { root: ranked[0].dir, scanned: path.join(INTEGRATION, 'build') }
  }
  if (!(await exists(DEFAULT_RUNTIME))) {
    throw new Error(
      `no runtime found. Build one with:\n` +
      `  RENPY_SDK=/tmp/renpy-8.5.3-sdk BUILD_ID=local-$(date +%s) bash integrations/renpy-technosutra/build_web.sh\n` +
      `then: pnpm vn --build integrations/renpy-technosutra/build/local`,
    )
  }
  return { root: DEFAULT_RUNTIME, scanned: DEFAULT_RUNTIME }
}

// ── asset derivatives ─────────────────────────────────────────────────────────
let runtime
let assetsMode
const assetCacheDir = path.join(REPO_ROOT, '.vn-cache', 'assets')
let assetManifest = {}

async function prepareAssets() {
  if (assetsMode !== 'fast') return
  const started = Date.now()
  const result = await new Promise((resolve) => {
    const child = spawn(
      process.env.PYTHON || 'python3',
      [
        path.join(REPO_ROOT, 'scripts', 'vn-assets.py'),
        '--root', runtime.root,
        '--out', assetCacheDir,
        '--sprites', options.sprites,
        options.lossless ? '--lossless' : null,
        '--quiet',
      ].filter(Boolean),
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stdout.on('data', (chunk) => { stderr += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => resolve({ ok: false, message: error.message }))
    child.on('exit', (code) => resolve({ ok: code === 0, message: stderr.trim(), ms: Date.now() - started }))
  })
  try {
    assetManifest = JSON.parse(await fs.readFile(path.join(assetCacheDir, 'manifest.json'), 'utf8'))
  } catch {
    assetManifest = {}
  }
  if (!result.ok) {
    warn(`fast assets unavailable (${result.message || 'generator failed'}) — serving originals`)
    assetsMode = 'raw'
    return
  }
  if (assetManifest.count) {
    log(
      `fast assets ${color.green}ready${color.off} in ${result.ms}ms: ` +
      `${(assetManifest.sourceBytes / 1e6).toFixed(1)} MB → ${(assetManifest.outputBytes / 1e6).toFixed(1)} MB ` +
      `(${color.bold}-${assetManifest.savedPercent}%${color.off}, ${assetManifest.count} images, ${options.sprites} sprites${options.lossless ? ' · lossless' : ''})`,
    )
  }
}

function derivedPath(rel) {
  if (assetsMode !== 'fast') return null
  const record = assetManifest.assets && assetManifest.assets[rel]
  if (!record) return null
  // Lossless derivatives may change extension (.jpg → .webp), so serve from
  // the recorded targetRel rather than the source-relative path.
  const targetRel = record.targetRel || rel
  return path.join(assetCacheDir, targetRel)
}

// ── response helpers ──────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.zip': 'application/zip',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.symbols': 'application/octet-stream',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.wasm', '.data', '.zip', '.txt', '.svg', '.symbols'])
const compressed = new Map()
const COMPRESSED_LIMIT = 96

function compressBuffer(buffer, encoding) {
  return encoding === 'br'
    ? zlib.brotliCompressSync(buffer, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: buffer.length > 1_000_000 ? 5 : 9,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
        },
      })
    : zlib.gzipSync(buffer, { level: 6 })
}

function negotiate(req) {
  const header = String(req.headers['accept-encoding'] || '')
  if (/\bbr\b/.test(header)) return 'br'
  if (/\bgzip\b/.test(header)) return 'gzip'
  return null
}

async function compressedBody(abs, stat, encoding) {
  const key = `${abs}|${stat.mtimeMs}|${stat.size}|${encoding}`
  const cached = compressed.get(key)
  if (cached) return cached
  const promise = fs.readFile(abs).then((body) => compressBuffer(body, encoding))
  compressed.set(key, promise)
  while (compressed.size > COMPRESSED_LIMIT) compressed.delete(compressed.keys().next().value)
  return promise
}

function etagFor(stat) {
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
}

function send(res, status, headers, body) {
  res.writeHead(status, headers)
  if (body === undefined || res.req.method === 'HEAD') res.end()
  else res.end(body)
}

// ── dev service worker ────────────────────────────────────────────────────────
const DEV_SW = `// CyberManju OS — dev no-op service worker (served by scripts/vn-dev.mjs).
// Role: replace any previously installed Stem Array worker so perf runs always
//       see the bytes on disk; the shipped cache-first worker is --sw=prod.
self.addEventListener('install', function () { self.skipWaiting() })
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var names = await caches.keys()
    await Promise.all(names.map(function (name) {
      if (name.indexOf('stem-array-vn-') === 0) return caches.delete(name)
    }))
    await self.clients.claim()
  })())
})
`

let prodSwPromise = null
async function prodServiceWorker() {
  if (prodSwPromise) return prodSwPromise
  prodSwPromise = (async () => {
    const file = path.join(runtime.root, 'service-worker.js')
    let source = await fs.readFile(file, 'utf8')
    const fingerprint = runtime.fingerprint
    const version = Buffer.from(fingerprint).toString('hex').slice(0, 16)
    source = source.replace('__STEM_CACHE_VERSION__', version)
    return source
  })()
  return prodSwPromise
}

// ── live reload ──────────────────────────────────────────────────────────────
const clients = new Set()

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) {
    try {
      res.write(frame)
    } catch {
      clients.delete(res)
    }
  }
}

function scheduleReload(reason, delay = 220) {
  clearTimeout(scheduleReload.timer)
  scheduleReload.timer = setTimeout(() => {
    if (!clients.size) {
      log(`${reason} (no page connected)`)
      return
    }
    log(`${color.cyan}reload${color.off} ${reason} → ${clients.size} page(s)`)
    broadcast('reload', { reason, at: Date.now() })
  }, delay)
}

async function swapRuntime(nextRoot, reason) {
  if (nextRoot === runtime.root) return
  runtime = { ...runtime, root: nextRoot, fingerprint: await fingerprintOf(nextRoot) }
  prodSwPromise = null
  await prepareAssets()
  log(`${color.green}runtime swapped${color.off} → ${path.relative(REPO_ROOT, nextRoot)} (${reason})`)
  scheduleReload("new Ren'Py build")
}

async function fingerprintOf(root) {
  const parts = []
  for (const file of ['index.html', 'game.zip', 'renpy.wasm']) {
    try {
      const stat = await fs.stat(path.join(root, file))
      parts.push(`${file}:${stat.size}:${Math.floor(stat.mtimeMs)}`)
    } catch {
      parts.push(`${file}:missing`)
    }
  }
  return parts.join('|')
}

function watchDir(dir, onChange) {
  try {
    const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return
      if (String(filename).includes('__pycache__') || String(filename).endsWith('.tmp')) return
      onChange(String(filename))
    })
    watcher.on('error', () => {})
    return watcher
  } catch (error) {
    warn(`watch disabled for ${path.relative(REPO_ROOT, dir)}: ${error.message}`)
    return null
  }
}

async function startWatchers(scanned) {
  const watchers = []
  watchers.push(watchDir(runtime.root, () => scheduleReload('runtime files changed')))

  // New build output appearing under the scanned parent hot-swaps the runtime.
  const parent = path.resolve(scanned)
  if (parent !== runtime.root) {
    watchers.push(watchDir(parent, async () => {
      try {
        const next = await resolveRuntime(options.build || scanned)
        await swapRuntime(next.root, 'build output changed')
      } catch {
        // A half-written build directory is not an error yet.
      }
    }))
  }

  // Source edits: Ren'Py cannot compile without the SDK, so say so out loud.
  const sourceDirs = [path.join(INTEGRATION, 'game'), path.join(INTEGRATION, 'web')]
  for (const dir of sourceDirs) {
    if (await exists(dir)) {
      watchers.push(watchDir(dir, (filename) => {
        const name = path.basename(filename)
        if (name.endsWith('.rpy') || name.endsWith('.rpyc')) {
          log(`${color.yellow}source changed${color.off} ${filename} — .rpy needs a Ren'Py rebuild (CI: renpy-web, local: build_web.sh)`)
          broadcast('notice', { message: `${filename} changed — rebuild the runtime to see it`, at: Date.now() })
        } else {
          scheduleReload(`game asset changed: ${filename}`)
        }
      }))
    }
  }
  return watchers
}

// ── perf report sink ─────────────────────────────────────────────────────────
async function writePerfReport(report) {
  const lines = []
  const engine = report.engine || {}
  const frame = report.frameMs || {}
  const bootMs = report.boot && report.boot.firstFrameMs
  lines.push(
    `${color.cyan}perf${color.off} ${report.build || '?'} · ${engine.viewport || '?'} dpr${engine.dpr || '?'} · ` +
    `${report.fps} fps · p50 ${frame.p50}ms p95 ${frame.p95}ms worst ${frame.worst}ms`,
  )
  lines.push(
    `     ${color.dim}jank${color.off} ${report.jank.over32ms} frames >32ms · ${report.longTasks.count} long tasks ` +
    `(worst ${report.longTasks.worstMs}ms) · heap ${report.heapMb === null ? 'n/a' : report.heapMb + 'MB'} · ` +
    `first frame ${bootMs === null ? '?' : bootMs + 'ms'}`,
  )
  lines.push(
    `     ${color.dim}bytes${color.off} ${report.transferredMb}MB total · images ${report.imageMb}MB/${report.imageCount} · ` +
    `engine ${report.engineMb}MB · assets ${report.assets}`,
  )
  if (report.probe) {
    lines.push(
      `     ${color.dim}engine${color.off} ${report.probe.version} · ${report.probe.renderer} · cps ${report.probe.textCps} · ` +
      `transitions ${report.probe.transitions} · predict ${report.probe.predict} · dev ${report.probe.developer}`,
    )
  }
  if (report.slowest && report.slowest.length) {
    lines.push(`     ${color.dim}slowest${color.off} ` + report.slowest.map((item) => `${item.ms}ms ${item.name}`).join(' · '))
  }
  console.log(lines.join('\n'))
  try {
    await fs.mkdir(path.join(REPO_ROOT, 'logs'), { recursive: true })
    await fs.appendFile(path.join(REPO_ROOT, 'logs', 'vn-perf.log'), `${JSON.stringify(report)}\n`, 'utf8')
  } catch {
    // Reporting must never break the server.
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function json(res, status, value) {
  send(res, status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, JSON.stringify(value))
}

async function readBody(req, limit = 1 << 20) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function injectOverlay(html) {
  const tag = `<script>window.__VN_DEV__=${JSON.stringify({
    root: path.relative(REPO_ROOT, runtime.root) || runtime.root,
    build: runtime.fingerprint.slice(0, 40),
    assets: assetsMode,
    sprites: options.sprites,
    serviceWorker: options.sw,
  })};</script><script src="/__vn/overlay.js"></script>`
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`)
  return `${tag}${html}`
}

async function handle(request, response) {
  const url = new URL(request.url, 'http://localhost')
  const pathname = decodeURIComponent(url.pathname)

  if (pathname === '/__vn/overlay.js') {
    const body = await fs.readFile(path.join(REPO_ROOT, 'scripts', 'vn-overlay.js'))
    return send(response, 200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' }, body)
  }

  if (pathname === '/__vn/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.write(`event: state\ndata: ${JSON.stringify({ root: runtime.root, assets: assetsMode })}\n\n`)
    clients.add(response)
    log(`page connected (${clients.size}) from ${request.socket.remoteAddress}`)
    const heartbeat = setInterval(() => {
      try {
        response.write(': keepalive\n\n')
      } catch {
        clearInterval(heartbeat)
      }
    }, 20000)
    request.on('close', () => {
      clearInterval(heartbeat)
      clients.delete(response)
    })
    return
  }

  if (pathname === '/__vn/state') {
    if (request.method === 'GET') {
      const engine = {}
      for (const file of ['renpy.wasm', 'renpy.data', 'game.zip']) {
        try {
          const stat = await fs.stat(path.join(runtime.root, file))
          engine[file] = { bytes: stat.size, mtimeMs: stat.mtimeMs }
        } catch { engine[file] = null }
      }
      return json(response, 200, {
        root: runtime.root,
        fingerprint: runtime.fingerprint,
        assets: assetsMode,
        sprites: options.sprites,
        lossless: options.lossless,
        serviceWorker: options.sw,
        clients: clients.size,
        engine,
        // stableCache: true tells the client these files carry long max-age +
        // ETag, so a repeat visit re-downloads nothing unless bytes changed.
        stableCache: true,
        assetsManifest: {
          count: assetManifest.count || 0,
          sourceBytes: assetManifest.sourceBytes || 0,
          outputBytes: assetManifest.outputBytes || 0,
          savedPercent: assetManifest.savedPercent || 0,
        },
      })
    }
    if (request.method === 'POST') {
      const body = JSON.parse((await readBody(request)) || '{}')
      if (body.assets === 'fast' || body.assets === 'raw') {
        assetsMode = body.assets
        if (assetsMode === 'fast') await prepareAssets()
        log(`assets → ${assetsMode}`)
        return json(response, 200, { ok: true, assets: assetsMode })
      }
      return json(response, 400, { error: 'unknown state change' })
    }
    return json(response, 405, { error: 'method not allowed' })
  }

  if (pathname === '/__vn/report' && request.method === 'POST') {
    try {
      const report = JSON.parse(await readBody(request))
      await writePerfReport(report)
    } catch (error) {
      warn(`bad perf report: ${error.message}`)
    }
    return json(response, 200, { ok: true })
  }

  if (pathname === '/__vn/health') {
    return json(response, 200, { ok: true, root: runtime.root, assets: assetsMode })
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return send(response, 405, { 'content-type': 'text/plain' }, 'method not allowed')
  }

  if (pathname === '/service-worker.js') {
    const body = options.sw === 'prod' ? await prodServiceWorker() : DEV_SW
    return send(response, 200, {
      'content-type': MIME['.js'],
      'cache-control': 'no-store',
      'service-worker-allowed': '/',
    }, body)
  }

  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  if (rel.endsWith('/')) rel += 'index.html'
  let absolute = path.resolve(runtime.root, rel)
  if (absolute !== runtime.root && !absolute.startsWith(runtime.root + path.sep)) {
    return send(response, 403, { 'content-type': 'text/plain' }, 'forbidden')
  }

  let stat
  try {
    stat = await fs.stat(absolute)
    if (stat.isDirectory()) {
      absolute = path.join(absolute, 'index.html')
      stat = await fs.stat(absolute)
    }
  } catch {
    const fallback = derivedPath(rel)
    if (fallback) {
      try {
        stat = await fs.stat(fallback)
        absolute = fallback
      } catch {
        stat = null
      }
    }
    if (!stat) {
      response.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      return response.end(`not found: ${pathname}`)
    }
  }

  // Streamed images prefer the derivative, keyed by the same URL path.
  const derived = derivedPath(rel)
  if (derived) {
    try {
      const derivedStat = await fs.stat(derived)
      if (derivedStat.isFile()) {
        absolute = derived
        stat = derivedStat
      }
    } catch {
      // Not generated for this file; the original is correct.
    }
  }

  const extension = path.extname(absolute).toLowerCase()
  const mime = MIME[extension] || 'application/octet-stream'
  const etag = etagFor(stat)

  // Engine + archive + images are content-addressed by the build fingerprint,
  // so they can be kept locally for a year and revalidated with ETag (304 when
  // unchanged, 200 when a new build shipped). This is the "reuse renpy.wasm /
  // renpy.data" path — a repeat visit re-downloads nothing unless bytes changed.
  const STABLE = new Set(['.wasm', '.data', '.zip', '.jpg', '.jpeg', '.png', '.webp'])
  const stable = STABLE.has(extension)
  const maxAge = stable ? 'public, max-age=31536000, must-revalidate'
    : extension === '.html' ? 'no-store' : 'no-cache'

  if (request.headers['if-none-match'] === etag) {
    return send(response, 304, { etag, 'cache-control': maxAge })
  }

  const headers = {
    'content-type': mime,
    'cache-control': maxAge,
    etag,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  }

  // Byte ranges (used by the engine archive reader) bypass compression.
  const range = request.headers.range
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match) {
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
      if (start <= end && start < stat.size) {
        headers['content-range'] = `bytes ${start}-${end}/${stat.size}`
        headers['content-length'] = String(end - start + 1)
        response.writeHead(206, headers)
        if (request.method === 'HEAD') return response.end()
        return createReadStream(absolute, { start, end }).pipe(response)
      }
      headers['content-range'] = `bytes */${stat.size}`
      return send(response, 416, headers)
    }
  }

  if (extension === '.html') {
    const html = injectOverlay(await fs.readFile(absolute, 'utf8'))
    headers['content-length'] = String(Buffer.byteLength(html))
    return send(response, 200, headers, html)
  }

  const encoding = COMPRESSIBLE.has(extension) && stat.size > 1024 ? negotiate(request) : null
  if (encoding) {
    const body = await compressedBody(absolute, stat, encoding)
    headers['content-encoding'] = encoding
    headers['vary'] = 'accept-encoding'
    headers['content-length'] = String(body.length)
    return send(response, 200, headers, body)
  }

  headers['content-length'] = String(stat.size)
  response.writeHead(200, headers)
  if (request.method === 'HEAD') return response.end()
  return createReadStream(absolute).pipe(response)
}

// ── main ─────────────────────────────────────────────────────────────────────
const options = parseArgs(process.argv.slice(2))

async function warmEngine() {
  for (const file of ENGINE_FILES) {
    const abs = path.join(runtime.root, file)
    try {
      const stat = await fs.stat(abs)
      if (COMPRESSIBLE.has(path.extname(abs)) && stat.size > 1024) {
        await compressedBody(abs, stat, 'br')
      }
    } catch {
      // Optional file.
    }
  }
}

function lanAddresses() {
  const found = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address)
    }
  }
  return found
}

async function main() {
  const resolved = await resolveRuntime(options.build)
  runtime = { root: resolved.root, fingerprint: await fingerprintOf(resolved.root) }
  assetsMode = options.assets

  const sourceNewest = Math.max(
    await newestMtime(path.join(INTEGRATION, 'game')),
    await newestMtime(path.join(INTEGRATION, 'web')),
    await newestMtime(path.join(INTEGRATION, 'tools')),
    await fs.stat(path.join(INTEGRATION, 'chapters.json')).then((stat) => stat.mtimeMs).catch(() => 0),
  )
  const runtimeNewest = await newestMtime(runtime.root, 0)
  const stale = sourceNewest > runtimeNewest + 2000

  if (!options.quiet) {
    console.log(`${color.bold}The Stem Array — dev runtime${color.off}`)
    console.log(`  runtime  ${path.relative(REPO_ROOT, runtime.root) || runtime.root}`)
    console.log(`  assets   ${options.assets}${options.assets === 'fast' ? ` (${options.sprites} sprites${options.lossless ? ' · lossless' : ''})` : ''}`)
    console.log(`  service  ${options.sw === 'prod' ? 'prod cache-first worker' : 'off (fresh bytes every reload)'}`)
  }
  if (stale) {
    warn('the game source is newer than this runtime — .rpy/asset changes are not in the bytes being tested')
    warn('rebuild: RENPY_SDK=/tmp/renpy-8.5.3-sdk BUILD_ID=local-$(date +%s) bash integrations/renpy-technosutra/build_web.sh')
  }

  await prepareAssets()

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      warn(`${request.method} ${request.url} failed: ${error.stack || error.message}`)
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      }
      response.end('internal error')
    })
  })
  server.keepAliveTimeout = 65000

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, resolve)
  })

  const port = server.address().port
  const lan = lanAddresses()
  if (!options.quiet) {
    console.log(`  local    ${color.cyan}http://localhost:${port}/${color.off}`)
    for (const address of lan) {
      console.log(`  device   ${color.green}http://${address}:${port}/${color.off}`)
    }
    if (!lan.length) warn('no non-internal IPv4 address found; pass --host with the interface you want')
    console.log(`  ${color.dim}HUD: bottom-left pill · report → logs/vn-perf.log · Ctrl+C to stop${color.off}`)
  }

  setTimeout(() => { warmEngine().catch(() => {}) }, 25)

  const watchers = options.watch ? await startWatchers(resolved.scanned) : []
  const shutdown = () => {
    for (const watcher of watchers) {
      try { watcher?.close() } catch { /* already closed */ }
    }
    for (const client of clients) {
      try { client.end() } catch { /* gone */ }
    }
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  if (options.open) {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [`http://localhost:${port}/`], { stdio: 'ignore', detached: true }).unref()
  }
}

main().catch((error) => {
  fail(error.message)
  process.exit(1)
})
