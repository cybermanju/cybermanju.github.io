#!/usr/bin/env node
// CyberManju OS — wiki generator (Pages wiki + llms.txt).
// Role: scan the tree with the improved structure finder, group files into
//   subjects, and emit LLM artifacts (llms.txt, per-subject .txt/.json) plus
//   static per-subject .html and the subjects.json payload the Three.js SPA
//   fetches at runtime.
// Exports: SUBJECTS table; main `--out <dir>` (default dist-wasm).
// Integrates: reads `scripts/collect-file-context.mjs` (heuristic fast path;
//   the Rust tree-sitter engine stays authoritative for code-intel payloads);
//   output lands in dist-wasm/{llms.txt,wiki/} so the Pages artifact serves it
//   with zero extra deploy steps. `npm run wiki` chains this + the vite build.
// Contracts: read-only w.r.t. source; only writes under --out (created with
//   mkdir -p). Caps keep every .txt LLM-friendly (< ~40 KB).

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectFileContext } from './collect-file-context.mjs';

const SITE = 'https://cybermanju.github.io';
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;

// id, title, tagline, blurb, accent color, path prefixes.
export const SUBJECTS = [
  { id: 'overview', title: 'Overview', tag: 'start here: identity, stack, transports', color: '#c084fc',
    paths: ['src/main.ts', 'src-tauri/src/main.rs', 'src-tauri/src/lib.rs', 'docker/server/src/main.rs'],
    blurb: 'CyberManju OS is a quantum-resistant encrypted file manager plus a decentralized OS layer. One Vue 3 + Pinia frontend runs over three transports — Tauri IPC on desktop, REST against the :3456 dashboard, and a WASM volume on GitHub Pages — while 15 Rust crates own agent, sync, crypto, compression, disk, search and OS services.' },
  { id: 'agent', title: 'Agent System', tag: 'loop, permissions, memory, failover', color: '#a855f7',
    paths: ['crates/agent/', 'crates/types/src/agent.rs'],
    blurb: 'The agentic loop (config → providers → MCP → edit → redact → stream) with opencode-style allow/ask/deny permissions, two-layer memory (transcripts in agent_sessions plus semantic rows in agent_memories, 2200-char recall budget), and provider failover chains that continue the same transcript on terminal auth/rate-limit/network errors.' },
  { id: 'sync', title: 'Sync Pipeline', tag: 'scan, erasure, backends, repair', color: '#ff4d6d',
    paths: ['crates/sync/', 'crates/erasure/'],
    blurb: 'Async sync jobs (202 + poll, ≤10 min parked asks) run scan → compress → encrypt → upload → verify → link → clean, with Reed-Solomon k+m striped placement, quota/rate-limit/retry guards, and scrub/repair/gc/lease workers. Failures keep the local original and record a WARNING — never silent loss.' },
  { id: 'crypto', title: 'Crypto', tag: 'ML-KEM, ChaCha20, Argon2id, BLAKE3', color: '#ef4444',
    paths: ['crates/crypto/'],
    blurb: 'Hybrid post-quantum encryption: ML-KEM-1024 key encapsulation plus X25519, ChaCha20Poly1305 data encryption, ML-DSA/SLH-DSA signatures, Argon2id key derivation and BLAKE3 hash-anchored edits. Secrets are sealed per config (hasKey only, never echoed).' },
  { id: 'compression', title: 'Compression', tag: 'LZ4, ZSTD-15, Brotli-11, .cyb3', color: '#e879f9',
    paths: ['crates/compression/'],
    blurb: 'The TripleCompressor cascade (LZ4 → ZSTD-15 → Brotli-11) with per-layer stats and .cyb3 payloads. Incompressible input short-circuits after LZ4 (ratio > 0.98). The browser mirrors the chain with zstd-wasm so Pages reads and writes the same frames.' },
  { id: 'disk', title: 'Virtual Disk', tag: 'volumes, catalog, allocator', color: '#a855f7',
    paths: ['crates/disk/'],
    blurb: 'A single-file virtual disk with superblock, block allocator, file catalog and mountable volumes — the durable home for the vault, the redb database and sync state, shared by desktop, server and the browser volume.' },
  { id: 'search', title: 'Search + Scene', tag: 'Tantivy BM25, 17 categories', color: '#f0abfc',
    paths: ['crates/search/', 'crates/scene/'],
    blurb: 'Full-text search over a Tantivy BM25 index (filename, content, tags, metadata) with faceted and fuzzy queries, paired with a heuristic scene classifier (17 categories × 10 languages, weighted name/tags/path) that also powers the Pages BM25-lite transport.' },
  { id: 'faces', title: 'Faces', tag: 'onnx, heuristic-v2, none', color: '#fda4af',
    paths: ['crates/faces/'],
    blurb: 'Face detection with honest engine labels: onnx where the model runs, a labeled skin-segmentation heuristic-v2 fallback, and silence (never fabricated boxes) where neither applies. Every result reports its engine.' },
  { id: 'os-shell', title: 'OS + cybsh', tag: 'shell, tasks, compute, schedule', color: '#ff4d6d',
    paths: ['crates/os/', 'crates/types/src/schedule.rs'],
    blurb: 'The server-side shell (POST /api/os/exec with --json, pipes, history, completion) is identical on desktop, web and Pages via the WASM dispatcher, plus background tasks, compute dispatch and cron-style schedules.' },
  { id: 'web-api', title: 'Web API', tag: '114 routes, auth, security', color: '#c084fc',
    paths: ['crates/web/', 'docker/server/'],
    blurb: 'The :3456 dashboard backend: 114 REST route arms, fail-closed auth with 404-before-401 and role RBAC, sealed secrets, scrubbed device-shell spawn, and the async job contracts (sync start 202, agent prompt 202, approve/abort). Ships as Docker/ZimaOS and CasaOS images.' },
  { id: 'db-types', title: 'Database + Types', tag: 'redb, 17+ tables, schemas', color: '#a855f7',
    paths: ['crates/db/', 'crates/types/'],
    blurb: 'One redb file (cybermanju.db) with JSON rows across 17+ tables — agent sessions/memories, disks/volumes/block_map, sync state, leases, compute tasks — and the shared serde schemas every crate and the frontend agree on.' },
  { id: 'frontend', title: 'Frontend', tag: 'Vue 3, Pinia, transports', color: '#e879f9',
    paths: ['src/composables/', 'src/components/', 'src/utils/', 'src/stores/', 'src/ui/', 'src/App.vue', 'src/main.ts'],
    blurb: '44 top-level Vue components plus ui primitives, 28 composables and 28 pure utils over a single Pinia store. The transport layer (tauri IPC / REST / WASM volume, REST-first for os/disk) is a pure, unit-tested decision matrix so the gateway cannot drift per call site.' },
  { id: 'tauri', title: 'Tauri Desktop', tag: '19 modules, 130 handlers', color: '#ef4444',
    paths: ['src-tauri/src/'],
    blurb: 'The Tauri v2 desktop shell: 19 command modules with 130 IPC handlers, the incremental tree-sitter code-intel engine (6 real grammars plus heuristic fallback, every result engine-labeled), and the web-dashboard bridge.' },
  { id: 'cli', title: 'CLI (cyb)', tag: 'Go client, every verb', color: '#f5f3ff',
    paths: ['cli/'],
    blurb: 'The Go cyb CLI: one command per server verb (files, sync, agent, secrets, disks, doctor, setup), a shared REST client with tolerant decoding, terminal UI helpers, and the Supabase OAuth broker for Pages sign-in.' },
  { id: 'wasm', title: 'WASM + Pages', tag: 'OPFS volume, offline-first', color: '#c084fc',
    paths: ['crates/os-wasm/', 'src/composables/useWasm', 'wasm-pkg.ts', 'vite.config.wasm.ts', 'vite-plugin-wasm-stub.ts'],
    blurb: 'The browser volume backend (OPFS/localStorage) that makes GitHub Pages a full peer: file pipeline, search, crypto and sync-reader run locally, fetch-free and offline-friendly, with the same error prefixes as the server.' },
  { id: 'ops', title: 'Ops + CI', tag: 'scripts, releases, android', color: '#ff4d6d',
    paths: ['scripts/', '.github/workflows/', 'docker-compose.yml', 'docs/OPERATIONS.md', 'docs/SECURITY.md', 'docs/ANDROID.md'],
    blurb: 'Everything around the code: version single-source checks, the ~15 min CI matrix (rust, wasm, windows, linux, rpm, flatpak, arch, android, macos, pages), the 8-family release atlas, Android signing runbooks, and the Docker/ZimaOS operations guide.' },
];

const SIGNAL_RE = /SAFETY|INVARIANT|integrity:|auth:|rate_limited:|not_found:|unsupported:|too_large:|conflict:|disk_full:|network:|AGENT-\d|P\d+-\d+|MEMORY_\w+|STATIC_WRITE_LIMIT|MAX_TS_\w+|BUDGET|engine-labeled/g;

function trackedFiles() {
  return execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function headerText(ctx) {
  return ctx.header
    .map((l) => l.replace(/^(\s*\/\/\/?\s?|\s*#\s?|\s*<!--\s?|\s*\*\s?)/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function collectSubject(sub, files) {
  const matched = files.filter((f) => sub.paths.some((p) => f === p || f.startsWith(p)));
  const fileCtx = [];
  const contractHits = new Map();
  const importCrates = new Set();
  let symbolCount = 0;
  for (const f of matched) {
    if (!/\.(rs|ts|vue|js|mjs|sh|go)$/.test(f)) continue;
    // Skip generated/vendored trees.
    if (f.includes('/pkg/') || f.startsWith('target/') || f.startsWith('dist')) continue;
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const ctx = collectFileContext(f, text);
    fileCtx.push({ path: f, header: headerText(ctx), symbols: ctx.symbols.slice(0, 60), imports: ctx.imports.slice(0, 12) });
    symbolCount += ctx.symbols.length;
    for (const imp of ctx.imports) {
      for (const m of imp.raw.matchAll(/cybermanju[-_]([a-z_]+)/g)) {
        importCrates.add(m[1].replace(/-/g, '_'));
      }
    }
    const sigs = new Set((text.match(SIGNAL_RE) || []).map((s) => s.replace(/:$/, '')));
    for (const s of sigs) {
      if (!contractHits.has(s)) contractHits.set(s, []);
      if (contractHits.get(s).length < 6) contractHits.get(s).push(f);
    }
  }
  // Richest files first (most symbols) for the .txt module section.
  fileCtx.sort((a, b) => b.symbols.length - a.symbols.length);
  return { sub, files: fileCtx, fileCount: fileCtx.length, symbolCount, contracts: [...contractHits.entries()], importCrates: [...importCrates] };
}

// Crate → subject: real dependency edges mined from imports.
const CRATE_SUBJECT = {
  agent: 'agent', sync: 'sync', erasure: 'sync', crypto: 'crypto',
  compression: 'compression', disk: 'disk', web: 'web-api', db: 'db-types',
  types: 'db-types', search: 'search', scene: 'search', faces: 'faces',
  os: 'os-shell', os_wasm: 'wasm',
};

// Inter-subject links: hard import edges first, then reverse "used by"
// edges (so leaf crates like compression still show who consumes them),
// then subjects sharing ≥2 contract signals (shared protocols).
function computeLinks(collected) {
  const sigSets = new Map(collected.map((c) => [c.sub.id, new Set(c.contracts.map(([s]) => s))]));
  const impLinks = new Map();
  for (const c of collected) {
    const linked = [];
    for (const crate of c.importCrates) {
      const target = CRATE_SUBJECT[crate];
      if (target && target !== c.sub.id && !linked.includes(target)) linked.push(target);
    }
    impLinks.set(c.sub.id, linked);
  }
  for (const c of collected) {
    const linked = [...impLinks.get(c.sub.id)];
    // Reverse: whoever imports me.
    for (const o of collected) {
      if (o.sub.id !== c.sub.id && (impLinks.get(o.sub.id) || []).includes(c.sub.id) && !linked.includes(o.sub.id)) {
        linked.push(o.sub.id);
      }
    }
    if (linked.length < 5) {
      const mine = sigSets.get(c.sub.id);
      const scored = collected
        .filter((o) => o.sub.id !== c.sub.id && !linked.includes(o.sub.id))
        .map((o) => ({ id: o.sub.id, shared: [...sigSets.get(o.sub.id)].filter((s) => mine.has(s)).length }))
        .filter((x) => x.shared >= 2)
        .sort((a, b) => b.shared - a.shared);
      for (const s of scored) {
        if (linked.length >= 5) break;
        linked.push(s.id);
      }
    }
    c.links = linked.slice(0, 5);
  }
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function subjectTxt(c) {
  const { sub, files, fileCount, symbolCount, contracts } = c;
  const out = [];
  out.push(`# CyberManju OS wiki — ${sub.title} (v${VERSION})`);
  out.push(`> ${sub.tag}`);
  out.push(`> ${sub.blurb}`);
  out.push(`> App: ${SITE}/wiki/#/ + ${sub.id} | Static: ${SITE}/wiki/${sub.id}.html | JSON: ${SITE}/wiki/${sub.id}.json`);
  out.push('');
  out.push(`Files: ${fileCount}  |  Symbols: ${symbolCount}`);
  if (c.links && c.links.length) out.push(`Links: ${c.links.join(', ')} (see their .txt for the other side)`);
  out.push('');
  out.push('## Modules (merged top-file headers)');
  out.push('');
  for (const f of files.slice(0, 40)) {
    out.push(`### ${f.path}`);
    for (const h of f.header) out.push(`  ${h}`);
    out.push('');
  }
  if (files.length > 40) out.push(`… +${files.length - 40} more files (see ${sub.id}.json)`, '');
  out.push('## Symbols (top 150)');
  out.push('');
  let n = 0;
  for (const f of files) {
    for (const s of f.symbols) {
      if (n++ >= 150) break;
      out.push(`- ${s.name} (${s.kind}) — ${f.path}:${s.line}${s.docs ? ` — ${s.docs}` : ''}`);
    }
    if (n >= 150) break;
  }
  out.push('');
  out.push('## Contract signals in this subject');
  out.push('');
  if (contracts.length === 0) out.push('(none — pure logic; errors bubble to callers)');
  for (const [sig, where] of contracts.slice(0, 40)) out.push(`- ${sig} — ${where.join(', ')}`);
  out.push('');
  out.push('## All files');
  out.push('');
  for (const f of files) out.push(`- ${f.path}`);
  const txt = out.join('\n');
  return txt.length > 40_000 ? txt.slice(0, 40_000) + '\n…(truncated at 40 KB; see JSON)\n' : txt + '\n';
}

function subjectJson(c) {
  const { sub, files, fileCount, symbolCount, contracts } = c;
  return {
    id: sub.id, title: sub.title, tag: sub.tag, blurb: sub.blurb, color: sub.color,
    version: VERSION, fileCount, symbolCount, links: c.links || [],
    contracts: contracts.slice(0, 40).map(([sig, where]) => ({ signal: sig, files: where })),
    files: files.map((f) => ({ path: f.path, header: f.header, symbols: f.symbols.slice(0, 40), imports: f.imports })),
  };
}

function subjectHtml(c) {
  const { sub, files, fileCount, symbolCount, contracts } = c;
  const topSyms = [];
  for (const f of files) for (const s of f.symbols) { if (topSyms.length < 60) topSyms.push({ ...s, file: f.path }); }
  const rows = files.slice(0, 40).map((f) => `
      <details><summary><code>${escHtml(f.path)}</code> <span class="n">${f.symbols.length} symbols</span></summary>
      ${f.header.map((h) => `<p class="h">${escHtml(h)}</p>`).join('')}
      <p class="syms">${f.symbols.slice(0, 12).map((s) => `<code>${escHtml(s.name)}</code>`).join(' ')}</p>
      </details>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CyberManju OS wiki — ${escHtml(sub.title)}</title>
<meta name="description" content="${escHtml(sub.blurb)}">
<style>
:root{--ac:${sub.color};--bg:#0d0714;--card:#1a0f2e;--tx:#f5f3ff;--mut:#b8a6d9}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:"Pixelify Sans","Baloo 2",ui-rounded,system-ui,sans-serif;line-height:1.6}
.wrap{max-width:860px;margin:0 auto;padding:32px 20px 64px}
nav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;font-size:14px}
nav a{color:var(--ac);text-decoration:none;border:2px solid #ffffff22;padding:6px 14px;border-radius:0;box-shadow:3px 3px 0 rgba(0,0,0,.55);font-family:"Silkscreen","Pixelify Sans",monospace;font-size:12px}
.hero{border:2px solid #ffffff1e;border-left:8px solid var(--ac);border-radius:0;box-shadow:5px 5px 0 rgba(0,0,0,.55);padding:24px;background:var(--card)}
.hero h1{margin:0 0 4px;font-size:30px;font-family:"Silkscreen","Pixelify Sans",monospace;line-height:1.3}.tag{color:var(--ac);font-weight:700;font-family:"Silkscreen","Pixelify Sans",monospace;font-size:12px}.blurb{color:var(--mut)}
.stats{display:flex;gap:16px;margin:16px 0;color:var(--mut);font-size:14px}
h2{font-family:"Silkscreen","Pixelify Sans",monospace;font-size:15px;letter-spacing:.06em}
details{background:#ffffff08;border:2px solid #ffffff14;border-radius:0;padding:8px 12px;margin:8px 0}
summary{cursor:pointer}summary code{color:var(--ac)}.n{color:var(--mut);font-size:12px}
.h{margin:4px 0;color:var(--mut);font-size:14px}.syms code{background:#ffffff12;border-radius:0;padding:1px 6px;font-size:12px;margin:1px}
ul.links{list-style:none;padding:0;display:flex;gap:10px;flex-wrap:wrap}ul.links a{color:var(--tx);background:#ffffff10;border:2px solid var(--line,#ffffff1f);border-radius:0;box-shadow:3px 3px 0 rgba(0,0,0,.55);padding:6px 12px;text-decoration:none;font-size:13px}
footer{margin-top:32px;color:var(--mut);font-size:13px}
</style></head><body><div class="wrap">
<nav><a href="${SITE}/wiki/">✦ 3D wiki</a><a href="${SITE}/llms.txt">llms.txt</a><a href="./${sub.id}.txt">.txt</a><a href="./${sub.id}.json">.json</a></nav>
<div class="hero"><div class="tag">${escHtml(sub.tag)}</div><h1>${escHtml(sub.title)}</h1>
<p class="blurb">${escHtml(sub.blurb)}</p>
<div class="stats"><span>${fileCount} files</span><span>${symbolCount} symbols</span><span>v${VERSION}</span></div></div>
${(c.links && c.links.length) ? `<h2>Related modules</h2><p class="syms">${c.links.map((id) => `<a href="./${id}.html" style="color:var(--ac);text-decoration:none;border:2px solid #ffffff22;border-radius:0;box-shadow:2px 2px 0 rgba(0,0,0,.55);padding:2px 10px;margin:2px;display:inline-block">${escHtml(id)}</a>`).join(' ')}</p>` : ''}
<h2>Modules</h2>${rows}
<h2>Top symbols</h2><p class="syms">${topSyms.map((s) => `<code title="${escHtml(s.file)}:${s.line}">${escHtml(s.name)}</code>`).join(' ')}</p>
<h2>Contracts</h2><p>${contracts.length ? contracts.slice(0, 24).map(([s]) => `<code>${escHtml(s)}</code>`).join(' ') : 'none — pure logic'}</p>
<ul class="links"><li><a href="./${sub.id}.txt">LLM text</a></li><li><a href="./${sub.id}.json">JSON</a></li><li><a href="${SITE}/wiki/#/${sub.id}">Open in 3D wiki</a></li></ul>
<footer>CyberManju OS v${VERSION} — auto-generated wiki. Prefer the <a href="${SITE}/wiki/">interactive 3D wiki</a> for humans, <a href="${SITE}/llms.txt">llms.txt</a> for agents.</footer>
</div></div></body></html>
`;
}

function llmsTxt(collected) {
  const out = [
    '# CyberManju OS',
    `> Quantum-resistant encrypted file manager + decentralized OS layer (v${VERSION}).`,
    '> Interactive wiki for humans: https://cybermanju.github.io/wiki/',
    '> This file is the agent entry point: one line per subject, then fetch the .txt you need.',
    '',
    ...collected.map((c) => `- [${c.sub.title}](https://cybermanju.github.io/wiki/${c.sub.id}.txt): ${c.sub.tag} — ${c.fileCount} files, ${c.symbolCount} symbols.`),
    '',
    '## Conventions (must-read before editing code)',
    '- Transports: tauri IPC (desktop) / REST :3456 (server) / WASM volume (Pages). os_*/disk/* are REST_FIRST.',
    '- Async jobs: 202 + poll; asks park ≤10 min then auto-deny. Error prefixes: auth:/rate_limited:/not_found:/unsupported:(→501)/too_large:/integrity:/network:/disk_full:/conflict:.',
    '- Every code file carries a merged top-file header (Role/Exports/Integrates/Contracts); scripts/check-file-headers.sh enforces it.',
    '- No local cargo/Rust toolchain; Rust validation happens in CI. Local loop: check-version → vue-tsc → npm test.',
  ];
  return out.join('\n') + '\n';
}

function main() {
  const outIx = process.argv.indexOf('--out');
  const OUT = outIx !== -1 ? process.argv[outIx + 1] : 'dist-wasm';
  const files = trackedFiles();
  const collected = SUBJECTS.map((sub) => collectSubject(sub, files));
  computeLinks(collected);
  mkdirSync(join(OUT, 'wiki'), { recursive: true });

  writeFileSync(join(OUT, 'llms.txt'), llmsTxt(collected));
  const index = [];
  for (const c of collected) {
    writeFileSync(join(OUT, 'wiki', `${c.sub.id}.txt`), subjectTxt(c));
    const j = subjectJson(c);
    writeFileSync(join(OUT, 'wiki', `${c.sub.id}.json`), JSON.stringify(j, null, 1) + '\n');
    writeFileSync(join(OUT, 'wiki', `${c.sub.id}.html`), subjectHtml(c));
    index.push({ id: c.sub.id, title: c.sub.title, tag: c.sub.tag, blurb: c.sub.blurb, color: c.sub.color,
      fileCount: c.fileCount, symbolCount: c.symbolCount, links: c.links || [],
      contracts: c.contracts.slice(0, 12).map(([sig]) => sig),
      top: j.files.flatMap((f) => f.symbols.slice(0, 6).map((s) => ({ name: s.name, kind: s.kind, docs: s.docs, file: f.path, line: s.line }))).slice(0, 40) });
  }
  writeFileSync(join(OUT, 'wiki', 'subjects.json'), JSON.stringify({ version: VERSION, subjects: index }, null, 1) + '\n');
  const kb = (p) => (Buffer.byteLength(readFileSync(p, 'utf8')) / 1024).toFixed(1) + ' KB';
  console.log(`wiki: ${collected.length} subjects → ${OUT}/wiki/ (+ ${OUT}/llms.txt ${kb(join(OUT, 'llms.txt'))})`);
  for (const c of collected) console.log(`  ${c.sub.id}: ${c.fileCount} files, ${c.symbolCount} symbols, ${kb(join(OUT, 'wiki', c.sub.id + '.txt'))}`);
}

main();
