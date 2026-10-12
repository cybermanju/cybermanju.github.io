// CyberManju OS — transport parity sweep (scripts/check-transport-parity.mjs).
// Role: full TS↔Rust static parity check (ANALYSIS.md §3 close-out) — every
// REST_ROUTES mapping has method + /api/ path, every path's second segment is
// a known Rust route (else `is_known_route` 404s it before auth), every
// REST_FIRST entry resolves, WRITE_ONLY stays disjoint, and the spine twins
// (devices/peers/oplog/bundle/todos) exist on both sides. Runs on node only
// (no cargo, no wasm-pack) so Linux meta-checks stay honest.
// Exports: none (CLI; exit 1 on drift).
// Integrates: src/composables/useTauri.ts; crates/web/src/security.rs +
// lib.rs + api/*.rs; tests/frontend/transport-parity-full.test.ts (vitest
// twin using real TS imports instead of regex).
// Contracts: static reads assert presence/shape, never behavior; the
// live-boot shape-equality sweep (real `crates/web` + snake→camel) stays a
// CI-side follow-up needing both toolchains in one job (documented below).
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const fail = []
const pass = []
const ok = (msg) => pass.push(`ok: ${msg}`)
const bad = (msg) => fail.push(`DRIFT: ${msg}`)

const tauri = fs.readFileSync(path.join(root, 'src/composables/useTauri.ts'), 'utf8')

// ─── 1. REST_ROUTES inventory (regex — the vitest twin uses real imports) ──
// Keys are `  name: {` on their own line (method/buildPath on later lines).
const routesStart = tauri.indexOf('export const REST_ROUTES')
const routesEnd = tauri.indexOf('export const WRITE_ONLY_COMMANDS')
const routesBlock = tauri.slice(routesStart, routesEnd)
const mappings = [...routesBlock.matchAll(/^ {2}([A-Za-z0-9_]+): \{/gm)].map((m) => m[1])
if (mappings.length >= 170) ok(`REST_ROUTES has ${mappings.length} mappings (>= 170)`)
else bad(`REST_ROUTES has ${mappings.length} mappings, need >= 170`)

// Every mapping key must have a method + buildPath before the next key.
const methodOf = {}
for (let i = 0; i < mappings.length; i++) {
  const key = mappings[i]
  const keyIdx = routesBlock.indexOf(`\n  ${key}: {`)
  const nextIdx = i + 1 < mappings.length ? routesBlock.indexOf(`\n  ${mappings[i + 1]}: {`) : routesBlock.length
  const chunk = routesBlock.slice(keyIdx, nextIdx)
  const method = chunk.match(/method: '(GET|POST|PUT|DELETE|PATCH)'/)
  if (!method) bad(`mapping '${key}' lacks a valid method`)
  else methodOf[key] = method[1]
  if (!/buildPath/.test(chunk)) bad(`mapping '${key}' lacks buildPath`)
}
if (fail.length === 0) ok('every mapping block carries method + buildPath')

// Static /api/ path per mapping (truncate template/query tails to the shape).
const paths = []
for (let i = 0; i < mappings.length; i++) {
  const key = mappings[i]
  const keyIdx = routesBlock.indexOf(`\n  ${key}: {`)
  const nextIdx = i + 1 < mappings.length ? routesBlock.indexOf(`\n  ${mappings[i + 1]}: {`) : routesBlock.length
  const chunk = routesBlock.slice(keyIdx, nextIdx)
  const m = chunk.match(/\/api\/[A-Za-z0-9_./${}?=:-]*/)
  if (!m) {
    bad(`mapping '${key}' has no /api/ path literal`)
    continue
  }
  let p = m[0].split('$')[0].split('?')[0].replace(/\/+$/, '') || '/api/'
  paths.push(p)
  if (!m[0].startsWith('/api/')) bad(`mapping '${key}' path does not start with /api/: ${m[0]}`)
}
ok(`${paths.length} mappings carry an /api/ path`)

// ─── 2. REST_FIRST resolves + WRITE_ONLY disjoint ─────────────────────────
const setOf = (name) => {
  const m = tauri.match(new RegExp(`export const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`))
  if (!m) return null
  return [...m[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1])
}
const restFirst = setOf('REST_FIRST') ?? []
const writeOnly = setOf('WRITE_ONLY_COMMANDS') ?? []
const mappingSet = new Set(mappings)
for (const cmd of restFirst) {
  if (!mappingSet.has(cmd)) bad(`REST_FIRST '${cmd}' has no REST_ROUTES entry (split-brain phantom)`)
}
if (restFirst.length > 0) ok(`REST_FIRST resolves (${restFirst.length} entries)`)
for (const cmd of writeOnly) {
  if (mappingSet.has(cmd)) bad(`WRITE_ONLY '${cmd}' also has a REST route (must stay desktop-only)`)
  if (restFirst.includes(cmd)) bad(`WRITE_ONLY '${cmd}' is also REST_FIRST`)
}
if (writeOnly.length > 0) ok(`WRITE_ONLY disjoint (${writeOnly.length} entries)`)

// ─── 3. Rust known-routes cover every REST second segment ─────────────────
const security = fs.readFileSync(path.join(root, 'crates/web/src/security.rs'), 'utf8')
const segRe = /"([a-z0-9-]+)",/g
const segments = new Set([...security.matchAll(segRe)].map((m) => m[1]))
const seconds = new Set(paths.map((p) => p.split('/')[2]).filter(Boolean))
for (const seg of seconds) {
  if (!segments.has(seg)) bad(`REST second segment '/${seg}' is not a ROUTED_SEGMENT (router 404s before auth)`)
}
ok(`all ${seconds.size} REST second segments are known Rust routes`)
for (const spine of ['devices', 'todos', 'oplog', 'peers', 'sync']) {
  if (!segments.has(spine)) bad(`spine segment '${spine}' missing from ROUTED_SEGMENTS`)
}
ok('spine segments present (devices/todos/oplog/peers/sync)')

// Spine arms exist in the Rust router files (static presence, not behavior).
const lib = fs.readFileSync(path.join(root, 'crates/web/src/lib.rs'), 'utf8')
for (const needle of ['["api", "peers"]', 'bundle', 'oplog', 'devices::route', 'todos::route']) {
  if (!lib.includes(needle)) bad(`crates/web/src/lib.rs lacks '${needle}'`)
}
ok('Rust router serves devices/peers/oplog/bundle/todos')

// ─── 4. AGENT-1 prefix matrix pinned ──────────────────────────────────────
const prefixTest = fs.readFileSync(path.join(root, 'tests/frontend/error-prefix.test.ts'), 'utf8')
for (const prefix of ['auth:', 'rate_limited:', 'not_found:', 'unsupported:', 'too_large:', 'integrity:', 'network:', 'disk_full:', 'conflict:']) {
  if (!prefixTest.includes(prefix)) bad(`error-prefix test lacks '${prefix}'`)
}
ok('AGENT-1 prefix matrix pinned (9 prefixes)')

console.log(pass.join('\n'))
if (fail.length) {
  console.error(fail.join('\n'))
  console.error(`\ntransport parity: ${fail.length} drift(s). Fix the mapping or the router, then re-run.`)
  console.error('NOTE: live-boot shape equality (real crates/web + snake→camel) stays a CI follow-up needing both toolchains in one job.')
  process.exit(1)
}
console.log(`\ntransport parity: clean (${mappings.length} mappings, ${seconds.size} route families).`)
console.log('NOTE: live-boot shape equality (real crates/web + snake→camel) stays a CI follow-up needing both toolchains in one job.')
