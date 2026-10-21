#!/usr/bin/env node
// CyberManju OS — Wiki 2D graph HTML builder (scripts/wiki-graph-html.mjs).
// Role: build the interactive symbol-level knowledge-graph page the wiki's
//   2D switch loads — every node is a REAL code symbol or subject module
//   (never a "Community {n}" meta-circle), drawn with its module's
//   vis-network silhouette and carrying the source file:line + doc-comment
//   in the tooltip. Replaces graphify's community-hub export, which
//   collapses the symbol graph into opaque clusters.
// Exports: buildGraphHtml({ subjects, collected, kg, version, commit }) →
//   HTML string; pickGraphSymbols(collected, kg, perSubject) → the capped
//   per-subject symbol set (god nodes first, then weighted degree).
// Integrates: scripts/generate-wiki.mjs calls buildGraphHtml when
//   graphify-out/graph.json was present (engine: graphify); without a graph
//   no 2D page is emitted. wiki-src/main.ts lazy-loads the result as
//   ./graph.html inside the 2D overlay iframe.
// Contracts: fully static (no backend); vis-network from CDN with SRI; every
//   node label is a real symbol name or subject title; docs come from the
//   heuristic structure finder's doc-comment extraction (same source the
//   .txt artifacts use) — never fabricated prose. Size caps keep the page
//   under ~400 KB even with 11k+ graph nodes.

const PER_SUBJECT = 14;
const MAX_NODES = 420;
const MAX_EDGES = 900;
const DOC_SNIP = 140;

// Subject → vis-network silhouette (mirrors the 3D forms in shapes.ts).
const VIS = {
  facet: 'hexagon', knot: 'star', orbit: 'triangleDown', diamond: 'diamond',
  funnel: 'triangle', platter: 'database', lens: 'hexagon', star: 'star',
  chevron: 'triangle', globe: 'diamond', hex: 'hexagon', pill: 'database',
  shield: 'diamond', cursor: 'triangle', spindle: 'triangleDown', gear: 'star',
};

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function snip(s, n = DOC_SNIP) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function locLine(loc) {
  const m = typeof loc === 'string' ? /^L(\d+)/.exec(loc) : null;
  return m ? Number(m[1]) : 0;
}

/**
 * Pick the per-subject symbol set for the 2D graph: god nodes (highest
 * weighted degree inside the subject) first, then remaining subjectSymbols
 * by degree, capped at `perSubject`. Returns a Map subjectId → entry[].
 */
export function pickGraphSymbols(collected, kg, perSubject = PER_SUBJECT) {
  const bySub = new Map();
  for (const c of collected) {
    const gods = (kg?.subjectGods?.get(c.sub.id) ?? []).map((g) => ({
      name: g.name,
      file: g.file,
      line: g.line,
      degree: g.degree ?? 0,
      community: g.community ?? -1,
      god: true,
      docs: lookupDocs(c, g.name),
    }));
    const seen = new Set(gods.map((g) => g.name));
    const rest = (kg?.subjectSymbols?.get(c.sub.id) ?? [])
      .filter((s) => !seen.has(s.name))
      .map((s) => ({
        name: s.name,
        file: s.file,
        line: s.line,
        degree: s.degree ?? 0,
        community: s.community ?? -1,
        god: false,
        docs: lookupDocs(c, s.name),
      }));
    const all = [...gods, ...rest].sort((a, b) => b.degree - a.degree);
    bySub.set(c.sub.id, all.slice(0, perSubject));
  }
  return bySub;
}

// Doc-comment lookup: the heuristic structure finder already extracted docs
// per file symbol — match by name so tooltips carry real prose, not invented.
function lookupDocs(collected, name) {
  for (const f of collected.files ?? []) {
    for (const s of f.symbols ?? []) {
      if (s.name === name && s.docs) return s.docs;
    }
  }
  return '';
}

/**
 * Build the full interactive graph.html from in-memory wiki data.
 * @param {{
 *   subjects: Array<{id:string,title:string,color:string,shape?:string,glyph?:string,paths?:string[]}>,
 *   collected: Array<{sub:object, files:Array, fileCount:number, symbolCount:number, links?:string[], edges?:Array, godNodes?:Array}>,
 *   kg: object|null,
 *   version: string,
 *   commit: string|null,
 * }} opts
 */
export function buildGraphHtml({ subjects, collected, kg, version, commit }) {
  const collectedById = new Map(collected.map((c) => [c.sub.id, c]));
  const picked = pickGraphSymbols(collected, kg, PER_SUBJECT);

  // Node id scheme: `s:<subjectId>` for module hubs, `y:<subjectId>:<name>`
  // for symbols. The `y:` prefix avoids collisions with graphify's raw ids.
  const nodes = [];
  const nodeIndex = new Map(); // symbol id → node id

  // 1. Subject module hubs (big shape nodes at the center of each cluster).
  for (const s of subjects) {
    const c = collectedById.get(s.id);
    if (!c) continue;
    const gods = kg?.subjectGods?.get(s.id) ?? [];
    const topDeg = gods[0]?.degree ?? 0;
    nodes.push({
      id: `s:${s.id}`,
      label: s.title,
      shape: VIS[s.shape] ?? 'diamond',
      color: s.color,
      size: Math.min(48, 22 + Math.log2(1 + c.fileCount) * 4),
      font: { size: 16, color: '#ffffff', multi: false },
      title: `${s.title} — ${c.fileCount} files, ${c.symbolCount} symbols${s.glyph ? ' · ' + s.glyph : ''}\n${snip(s.blurb ?? '', 180)}`,
      subject: s.id,
      kind: 'module',
      file: '',
      line: 0,
      docs: snip(s.blurb ?? '', 180),
      degree: topDeg,
      community: kg?.subjectCommunity?.get(s.id)?.id ?? -1,
      hub: true,
    });
  }

  // 2. Symbol satellites (real code identifiers with docs).
  for (const s of subjects) {
    const c = collectedById.get(s.id);
    if (!c) continue;
    for (const sym of picked.get(s.id) ?? []) {
      const nid = `y:${s.id}:${sym.name}`;
      nodeIndex.set(`${s.id}|${sym.name}`, nid);
      nodes.push({
        id: nid,
        label: sym.name,
        shape: sym.god ? 'star' : VIS[s.shape] ?? 'dot',
        color: sym.god ? '#f5f3ff' : s.color,
        size: sym.god ? Math.min(28, 10 + Math.log2(1 + sym.degree) * 3) : Math.min(18, 6 + Math.log2(1 + sym.degree) * 2),
        font: { size: sym.god ? 13 : 11, color: '#ffffff' },
        title: sym.god
          ? `★ ${sym.name} — ${sym.file}:${sym.line} · degree ${sym.degree}\n${sym.docs || '(no doc-comment)'}`
          : `${sym.name} — ${sym.file}:${sym.line}${sym.docs ? '\n' + snip(sym.docs) : ''}`,
        subject: s.id,
        kind: sym.god ? 'god' : 'symbol',
        file: sym.file,
        line: sym.line,
        docs: snip(sym.docs),
        degree: sym.degree,
        community: sym.community,
        god: sym.god,
      });
    }
  }

  // 3. Edges: subject↔subject (aggregated) + subject→its symbols + symbol↔symbol.
  const edges = [];
  const seenEdge = new Set();
  const addEdge = (from, to, opts2) => {
    const key = from < to ? `${from}|${to}` : `${to}|${from}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    edges.push({ from, to, ...opts2 });
  };

  // Cross-subject edges from the knowledge graph (strongest first).
  for (const c of collected) {
    for (const e of c.edges ?? []) {
      const a = `s:${c.sub.id}`;
      const b = `s:${e.to}`;
      if (!collectedById.has(e.to)) continue;
      const dashed = e.inferred > e.extracted;
      addEdge(a, b, {
        dashes: dashed,
        width: Math.min(4, 1 + Math.log2(1 + e.weight)),
        color: { opacity: dashed ? 0.3 : 0.45 },
        title: `${c.sub.title} → ${e.to}: w${e.weight}, EXTRACTED ${e.extracted} / INFERRED ${e.inferred} (${Object.entries(e.relations).map(([r, n]) => `${r} ×${n}`).join(', ')})${e.sample ? `\n${e.sample}` : ''}`,
        confidence: dashed ? 'INFERRED' : 'EXTRACTED',
        cross: true,
      });
    }
  }

  // Subject hub → its picked symbols (membership spokes).
  for (const s of subjects) {
    for (const sym of picked.get(s.id) ?? []) {
      const nid = nodeIndex.get(`${s.id}|${sym.name}`);
      if (!nid) continue;
      addEdge(`s:${s.id}`, nid, {
        dashes: false,
        width: sym.god ? 1.5 : 0.8,
        color: { opacity: sym.god ? 0.4 : 0.18 },
        title: `${sym.name} ∈ ${s.title}${sym.docs ? ` — ${snip(sym.docs, 80)}` : ''}`,
        confidence: 'EXTRACTED',
        cross: false,
        membership: true,
      });
    }
  }

  // Symbol↔symbol edges among picked symbols (from graphify links, via kg).
  if (kg?.subjectSymbols) {
    // Build name→nodeId map for quick lookup across subjects.
    const nameToNode = new Map();
    for (const [key, nid] of nodeIndex) {
      const [sid, name] = key.split('|');
      nameToNode.set(`${sid}:${name}`, nid);
      // Also bare name (may collide across subjects — first wins).
      if (!nameToNode.has(name)) nameToNode.set(name, nid);
    }
    for (const s of subjects) {
      for (const sym of picked.get(s.id) ?? []) {
        const fromId = nodeIndex.get(`${s.id}|${sym.name}`);
        if (!fromId) continue;
        // Neighbors from the kg payload carry relation + provenance.
        const full = (kg.subjectSymbols.get(s.id) ?? []).find(
          (x) => x.name === sym.name,
        );
        for (const nb of full?.neighbors ?? []) {
          const toId = nameToNode.get(nb.name);
          if (!toId || toId === fromId) continue;
          const dashed = nb.confidence === 'INFERRED';
          addEdge(fromId, toId, {
            dashes: dashed,
            width: Math.min(3, 0.8 + Math.log2(1 + nb.weight)),
            color: { opacity: dashed ? 0.22 : 0.35 },
            title: `${sym.name} ${nb.via === 'in' ? '←' : '→'} ${nb.relation} ${nb.name} · ${nb.confidence} w${nb.weight}`,
            confidence: nb.confidence,
            cross: false,
          });
          if (edges.length >= MAX_EDGES) break;
        }
        if (edges.length >= MAX_EDGES) break;
      }
      if (edges.length >= MAX_EDGES) break;
    }
  }

  // Hard caps: keep the page interactive even on huge graphs.
  if (nodes.length > MAX_NODES) {
    // Keep all hubs, trim lowest-degree symbols.
    const hubs = nodes.filter((n) => n.hub);
    const syms = nodes.filter((n) => !n.hub).sort((a, b) => b.degree - a.degree);
    nodes.length = 0;
    nodes.push(...hubs, ...syms.slice(0, MAX_NODES - hubs.length));
    const keep = new Set(nodes.map((n) => n.id));
    const filtered = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    edges.length = 0;
    edges.push(...filtered.slice(0, MAX_EDGES));
  } else if (edges.length > MAX_EDGES) {
    edges.length = MAX_EDGES;
  }

  // Legend: one row per subject (dot + title + symbol count).
  const legend = subjects
    .filter((s) => collectedById.has(s.id))
    .map((s) => ({
      cid: s.id,
      label: `${s.glyph ? s.glyph + ' ' : ''}${s.title}`,
      color: s.color,
      count: (picked.get(s.id) ?? []).length + 1,
    }));

  const stats = `${nodes.length} nodes · ${edges.length} edges · ${subjects.length} subjects · engine: graphify`;
  const commitLine = commit ? `commit ${esc(commit)}` : 'local build';
  const payloadNodes = JSON.stringify(nodes).replace(/</g, '\\u003c');
  const payloadEdges = JSON.stringify(edges).replace(/</g, '\\u003c');
  const payloadLegend = JSON.stringify(legend).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>CyberManju OS — knowledge graph (symbol level)</title>
<script id="vis-network-script" async onerror="this.dataset.failed='true'" src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"
        integrity="sha384-Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1"
        crossorigin="anonymous"></script>
<style>
  :root {
    --bg: #0f0f1a; --panel: #1a1a2e; --border: #2a2a4e; --input-border: #3a3a5e;
    --text: #e0e0e0; --text-2: #aaa; --text-3: #ccc; --muted: #555; --count: #666;
    --neighbor-border: #333; --node-label: #ffffff;
  }
  [data-theme="light"] {
    --bg: #ffffff; --panel: #f8f9fa; --border: #d9dee5; --input-border: #c3cad4;
    --text: #222222; --text-2: #666666; --text-3: #333333; --muted: #888888; --count: #777777;
    --neighbor-border: #ccc; --node-label: #222222;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; height: 100vh; overflow: hidden; }
  #graph { flex: 1; }
  #sidebar { width: 300px; background: var(--panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
  #search-wrap { padding: 12px; border-bottom: 1px solid var(--border); }
  #search { width: 100%; background: var(--bg); border: 1px solid var(--input-border); color: var(--text); padding: 7px 10px; border-radius: 6px; font-size: 13px; outline: none; }
  #search:focus { border-color: #4E79A7; }
  #search-results { max-height: 160px; overflow-y: auto; padding: 4px 12px; border-bottom: 1px solid var(--border); display: none; }
  .search-item { padding: 4px 6px; cursor: pointer; border-radius: 4px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search-item:hover { background: var(--border); }
  button.search-item { width: 100%; text-align: left; color: inherit; border: 0; background: transparent; }
  .search-item small { color: var(--muted); margin-left: 6px; }
  #info-panel { padding: 14px; border-bottom: 1px solid var(--border); min-height: 150px; max-height: 240px; overflow-y: auto; }
  #info-panel h3 { font-size: 13px; color: var(--text-2); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  #info-content { font-size: 13px; color: var(--text-3); line-height: 1.55; }
  #info-content .field { margin-bottom: 5px; }
  #info-content .field b { color: var(--text); }
  #info-content .empty { color: var(--muted); font-style: italic; }
  #info-content code { background: #ffffff12; padding: 1px 5px; font-size: 12px; }
  .neighbor-link { display: block; width: 100%; padding: 2px 6px; margin: 2px 0; border: 0; border-left: 3px solid var(--neighbor-border); background: transparent; color: var(--text-3); text-align: left; border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .neighbor-link:hover { background: var(--border); }
  #neighbors-list { max-height: 120px; overflow-y: auto; margin-top: 4px; }
  #legend-wrap { flex: 1; overflow-y: auto; padding: 12px; }
  #legend-wrap h3 { font-size: 13px; color: var(--text-2); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  .legend-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .legend-item:hover { background: var(--border); padding-left: 4px; }
  .legend-item.dimmed { opacity: 0.35; }
  .legend-dot { width: 12px; height: 12px; flex-shrink: 0; clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%); }
  .legend-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend-count { color: var(--count); font-size: 11px; }
  #stats { padding: 10px 14px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); line-height: 1.5; }
  #legend-controls { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 4px 0; }
  #legend-controls label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: var(--text-2); user-select: none; }
  #legend-controls label:hover { color: var(--text); }
  .legend-cb, #select-all-cb { appearance: none; -webkit-appearance: none; width: 14px; height: 14px; border: 1.5px solid var(--input-border); border-radius: 3px; background: var(--bg); cursor: pointer; position: relative; flex-shrink: 0; }
  .legend-cb:checked, #select-all-cb:checked { background: #4E79A7; border-color: #4E79A7; }
  .legend-cb:checked::after, #select-all-cb:checked::after { content: ''; position: absolute; left: 3.5px; top: 1px; width: 4px; height: 7px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
  #select-all-cb:indeterminate { background: #4E79A7; border-color: #4E79A7; }
  #select-all-cb:indeterminate::after { content: ''; position: absolute; left: 2px; top: 5px; width: 8px; height: 2px; background: #fff; border: none; transform: none; }
  #theme-wrap { display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  #theme-wrap button { flex: 1; background: var(--bg); color: var(--text-2); border: 1px solid var(--input-border); border-radius: 4px; padding: 3px 0; font-size: 11px; cursor: pointer; }
  #theme-wrap button:hover { color: var(--text); }
  #theme-wrap button[aria-pressed="true"] { background: #4E79A7; border-color: #4E79A7; color: #fff; }
  #hdr { padding: 10px 14px; border-bottom: 1px solid var(--border); }
  #hdr .t { font-weight: 700; font-size: 14px; }
  #hdr .s { color: var(--muted); font-size: 11px; margin-top: 2px; }
  #hdr a { color: #6ea8ff; text-decoration: none; font-size: 11px; }
  #graph { position: relative; }
  #graph-status {
    position: absolute; z-index: 2; inset: 0; display: grid; place-items: center; padding: 24px;
    color: var(--text-2); text-align: center; pointer-events: none;
  }
  #graph-status[hidden] { display: none; }
  #graph-status[data-state="error"] { color: #ffb4ab; }
  #mobile-drawer > summary, #mobile-home { display: none; }
  #mobile-toolbar, #mobile-drawer, .drawer-content { display: contents; }
  button, input { font: inherit; }
  :focus-visible { outline: 2px solid #78aaff; outline-offset: 2px; }
  @media (max-width: 900px) {
    html, body { width: 100%; height: 100%; height: 100dvh; min-height: 0; overflow: hidden; }
    body { position: relative; display: block; }
    #graph { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
    #sidebar {
      position: absolute; z-index: 5; top: env(safe-area-inset-top, 0px); left: 0; right: 0; bottom: auto;
      width: auto; max-height: 100%; overflow: visible; display: block; border: 0; background: transparent;
      padding: 8px max(10px, env(safe-area-inset-right, 0px)) 0 max(10px, env(safe-area-inset-left, 0px));
      pointer-events: none;
    }
    #mobile-toolbar {
      display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; width: 100%; padding: 8px;
      background: color-mix(in srgb, var(--panel) 96%, transparent); border: 1px solid var(--border);
      border-radius: 14px; box-shadow: 0 4px 18px #0005; pointer-events: auto;
    }
    #hdr { display: none; }
    #mobile-home { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 10px; border: 1px solid var(--input-border); border-radius: 8px; color: #78aaff; text-decoration: none; font-size: 13px; }
    #search-wrap { position: relative; flex: 1 1 12rem; min-width: 0; padding: 0; border: 0; }
    #search { height: 44px; padding: 0 12px; font-size: 16px; }
    #search-results { position: absolute; z-index: 2; top: calc(100% + 6px); left: 0; right: 0; max-height: min(35dvh, 280px); padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); box-shadow: 0 4px 18px #0006; }
    .search-item { min-height: 44px; display: flex; align-items: center; padding: 8px 10px; white-space: normal; overflow-wrap: anywhere; }
    #mobile-drawer { display: block; position: relative; margin-left: auto; pointer-events: auto; }
    #mobile-drawer > summary {
      list-style: none; display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px;
      padding: 0 12px; border: 1px solid var(--input-border); border-radius: 8px; background: var(--bg); color: var(--text);
      font-size: 13px; font-weight: 600; cursor: pointer; user-select: none;
    }
    #mobile-drawer > summary::-webkit-details-marker { display: none; }
    #mobile-drawer[open] > summary { background: #4E79A7; border-color: #4E79A7; color: #fff; }
    #mobile-drawer > .drawer-content {
      display: block; position: absolute; top: calc(100% + 6px); right: 0; width: min(390px, calc(100vw - 20px));
      max-height: min(48dvh, 420px); overflow-y: auto; overscroll-behavior: contain;
      border: 1px solid var(--border); border-radius: 12px; background: var(--panel); box-shadow: 0 8px 24px #0007;
      pointer-events: auto; padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    #theme-wrap { padding: 8px; }
    #theme-wrap button { min-height: 44px; font-size: 13px; }
    #info-panel { min-height: 0; max-height: none; padding: 12px; }
    #neighbors-list { max-height: 120px; }
    .neighbor-link { min-height: 40px; display: flex; align-items: center; padding: 6px 9px; white-space: normal; overflow-wrap: anywhere; }
    #legend-wrap { max-height: 25dvh; padding: 10px 12px; }
    .legend-item { min-height: 44px; gap: 9px; padding: 5px 4px; }
    .legend-cb, #select-all-cb { width: 20px; height: 20px; }
    .legend-cb:checked::after, #select-all-cb:checked::after { left: 6px; top: 3px; }
    #select-all-cb:indeterminate::after { left: 4px; top: 8px; }
    #legend-controls { min-height: 44px; }
    #legend-controls label { min-height: 44px; padding: 0 4px; }
    #stats { padding: 8px 12px; }
  }
  @media (max-width: 900px) and (orientation: landscape) {
    #mobile-toolbar { max-width: min(620px, 70vw); }
    #mobile-drawer > .drawer-content { max-height: 58dvh; }
    #legend-wrap { max-height: 22dvh; }
  }
</style>
<script id="graphify-theme-init">
(function () {
  var pref = null;
  try { pref = localStorage.getItem('graphify-theme'); } catch (e) {}
  var t = pref === 'light' ? 'light'
    : pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light'
    : 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();
</script>
</head>
<body>
<div id="graph"><div id="graph-status" role="status" aria-live="polite">Loading interactive graph…</div></div>
<div id="sidebar">
  <div id="mobile-toolbar">
  <div id="hdr">
    <div class="t">CyberManju knowledge graph</div>
    <div class="s">symbol level · ${esc(version)} · ${commitLine}</div>
    <div class="s"><a href="./">← 3D wiki</a> · <a href="./llms.txt">llms.txt</a></div>
  </div>
  <div id="search-wrap">
    <input id="search" type="search" placeholder="Search symbols + modules..." autocomplete="off" aria-label="Search symbols and modules">
    <div id="search-results" role="listbox" aria-label="Search results"></div>
  </div>
  <a id="mobile-home" href="./" aria-label="Return to the 3D wiki">3D wiki</a>
  <details id="mobile-drawer" open>
    <summary aria-label="Show graph details, subjects, and theme controls">Details &amp; subjects</summary>
    <div class="drawer-content">
  <div id="theme-wrap" role="group" aria-label="Theme">
    <button type="button" data-theme-choice="light">Light</button>
    <button type="button" data-theme-choice="dark">Dark</button>
    <button type="button" data-theme-choice="system">System</button>
  </div>
  <div id="info-panel">
    <h3>Node Info</h3>
    <div id="info-content"><span class="empty">Click a node — every node is a real symbol or subject module. Hover for file:line + doc-comment.</span></div>
  </div>
  <div id="legend-wrap">
    <h3>Subjects</h3>
    <div id="legend-controls">
      <label><input type="checkbox" id="select-all-cb" checked onchange="toggleAllSubjects(!this.checked)">Select All</label>
    </div>
    <div id="legend"></div>
  </div>
  <div id="stats">${esc(stats)}</div>
    </div>
  </details>
  </div>
</div>
<script>
const graphStatus = document.getElementById('graph-status');
const visScript = document.getElementById('vis-network-script');
function showGraphLoadError() {
  graphStatus.dataset.state = 'error';
  graphStatus.textContent = 'Interactive graph could not load. Check the connection and reload this page.';
}
function initializeGraph() {
  if (!window.vis || !window.vis.Network || !window.vis.DataSet) { showGraphLoadError(); return; }
  graphStatus.hidden = true;
const RAW_NODES = ${payloadNodes};
const RAW_EDGES = ${payloadEdges};
const LEGEND = ${payloadLegend};
const mobileDrawer = document.getElementById('mobile-drawer');
const mobileLayout = window.matchMedia('(max-width: 900px)');
function syncMobileDrawer() { mobileDrawer.open = !mobileLayout.matches; }
syncMobileDrawer();
if (mobileLayout.addEventListener) mobileLayout.addEventListener('change', syncMobileDrawer);
else if (mobileLayout.addListener) mobileLayout.addListener(syncMobileDrawer);

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const nodesDS = new vis.DataSet(RAW_NODES.map((n, i) => ({
  id: n.id, label: n.label, shape: n.shape, color: n.color, size: n.size,
  font: n.font, title: n.title,
  x: 80 * Math.sqrt(i) * Math.cos(i * 2.4),
  y: 80 * Math.sqrt(i) * Math.sin(i * 2.4),
  subject: n.subject, kind: n.kind, file: n.file, line: n.line,
  docs: n.docs, degree: n.degree, community: n.community, hub: !!n.hub, god: !!n.god,
})));

const edgesDS = new vis.DataSet(RAW_EDGES.map((e, i) => ({
  id: i, from: e.from, to: e.to,
  label: '',
  title: e.title,
  dashes: e.dashes,
  width: e.width,
  color: e.color,
  arrows: e.cross ? { to: { enabled: true, scaleFactor: 0.4 } } : undefined,
})));

const container = document.getElementById('graph');
const network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      gravitationalConstant: -80,
      centralGravity: 0.008,
      springLength: 100,
      springConstant: 0.06,
      damping: 0.45,
      avoidOverlap: 0.6,
    },
    stabilization: { iterations: 250, fit: true },
  },
  interaction: {
    hover: true,
    tooltipDelay: 80,
    hideEdgesOnDrag: true,
    navigationButtons: false,
    keyboard: false,
    dragView: true,
    zoomView: true,
  },
  nodes: { borderWidth: 1.5 },
  edges: { smooth: { type: 'continuous', roundness: 0.15 }, selectionWidth: 3 },
});

const THEME_KEY = 'graphify-theme';
const themeMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
let themeLabelColor = '#ffffff';
function themePref() {
  let p = null;
  try { p = localStorage.getItem(THEME_KEY); } catch (e) {}
  return (p === 'light' || p === 'dark' || p === 'system') ? p : null;
}
function applyTheme(pref) {
  const t = pref === 'light' ? 'light' : (pref === 'system' && themeMQ && themeMQ.matches) ? 'light' : 'dark';
  const root = document.documentElement;
  if (!root) return;
  root.setAttribute('data-theme', t);
  document.querySelectorAll('[data-theme-choice]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === (pref || 'dark')));
  });
  const labelColor = getComputedStyle(root).getPropertyValue('--node-label').trim();
  if (labelColor && labelColor !== themeLabelColor) {
    themeLabelColor = labelColor;
    nodesDS.update(nodesDS.get().map(n => ({ id: n.id, font: Object.assign({}, n.font, { color: labelColor }) })));
  }
}
document.querySelectorAll('[data-theme-choice]').forEach(b => {
  b.addEventListener('click', () => {
    const pref = b.dataset.themeChoice;
    try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
    applyTheme(pref);
  });
});
if (themeMQ) {
  const onSchemeChange = () => { if (themePref() === 'system') applyTheme('system'); };
  if (themeMQ.addEventListener) themeMQ.addEventListener('change', onSchemeChange);
  else if (themeMQ.addListener) themeMQ.addListener(onSchemeChange);
}
applyTheme(themePref());

network.once('stabilizationIterationsDone', () => {
  network.setOptions({ physics: { enabled: false } });
});

function showInfo(nodeId) {
  const n = nodesDS.get(nodeId);
  if (!n) return;
  const neighborIds = network.getConnectedNodes(nodeId);
  const neighborItems = neighborIds.map(nid => {
    const nb = nodesDS.get(nid);
    const color = nb ? (nb.color && nb.color.background ? nb.color.background : nb.color) : '#555';
    return '<button type="button" class="neighbor-link" aria-label="Open neighbor ' + esc(nb ? nb.label : nid) + '" style="border-left-color:' + esc(color) + '" data-nid="' + esc(nid) + '">' + esc(nb ? nb.label : nid) + '</button>';
  }).join('');
  let html = '<div class="field"><b>' + esc(n.label) + '</b></div>';
  if (n.kind === 'module') {
    html += '<div class="field">Module hub — ' + (n.file || 'subject') + '</div>';
  } else {
    html += '<div class="field">Kind: ' + esc(n.god ? '★ god node' : n.kind || 'symbol') + '</div>';
    if (n.file) html += '<div class="field">Source: <code>' + esc(n.file) + ':' + esc(n.line) + '</code></div>';
  }
  if (n.subject) html += '<div class="field">Subject: <code>' + esc(n.subject) + '</code></div>';
  if (n.docs) html += '<div class="field">Docs: ' + esc(n.docs) + '</div>';
  html += '<div class="field">Degree: ' + esc(String(n.degree || 0)) + (n.community >= 0 ? ' · community #' + esc(String(n.community)) : '') + '</div>';
  if (neighborIds.length) {
    html += '<div class="field" style="margin-top:8px;color:var(--text-2);font-size:11px">Neighbors (' + neighborIds.length + ')</div><div id="neighbors-list">' + neighborItems + '</div>';
  }
  document.getElementById('info-content').innerHTML = html;
}

function focusNode(nodeId) {
  network.focus(nodeId, { scale: 1.4, animation: true });
  network.selectNodes([nodeId]);
  showInfo(nodeId);
}

document.addEventListener('click', e => {
  const el = e.target.closest('.neighbor-link');
  if (el && el.dataset.nid !== undefined) focusNode(el.dataset.nid);
});

const sidebarTip = document.createElement('div');
sidebarTip.className = 'vis-tooltip';
sidebarTip.style.cssText = 'white-space: normal; max-width: 360px; overflow-wrap: break-word;';
document.body.appendChild(sidebarTip);
let sidebarTipTimer = null;
let sidebarTipEl = null;
let sidebarTipZone = null;
function hideSidebarTip() {
  clearTimeout(sidebarTipTimer);
  sidebarTip.style.visibility = 'hidden';
  sidebarTip.textContent = '';
  sidebarTipEl = sidebarTipZone = null;
}
document.addEventListener('mouseover', e => {
  const zone = e.target.closest && e.target.closest('.legend-count, .legend-item, .search-item, .neighbor-link');
  const el = zone && zone.classList.contains('legend-item') ? zone.querySelector('.legend-label') : zone;
  if (!el || el === sidebarTipEl) return;
  hideSidebarTip();
  const isCount = el.classList.contains('legend-count');
  if (!isCount && el.scrollWidth <= el.clientWidth) return;
  const text = isCount ? (el.textContent + (el.textContent === '1' ? ' node' : ' nodes')) : el.textContent;
  sidebarTipEl = el;
  sidebarTipZone = zone;
  const x = e.clientX, y = e.clientY;
  sidebarTipTimer = setTimeout(() => {
    sidebarTip.textContent = text;
    sidebarTip.style.left = sidebarTip.style.top = '0px';
    sidebarTip.style.visibility = 'visible';
    const w = sidebarTip.offsetWidth, h = sidebarTip.offsetHeight;
    sidebarTip.style.left = Math.max(4, Math.min(x + 12, window.innerWidth - w - 4)) + 'px';
    sidebarTip.style.top = (y + 16 + h > window.innerHeight ? Math.max(4, y - h - 8) : y + 16) + 'px';
  }, 100);
});
document.addEventListener('mouseout', e => {
  if (sidebarTipZone && !sidebarTipZone.contains(e.relatedTarget)) hideSidebarTip();
});
document.addEventListener('mousedown', hideSidebarTip);

let hoveredNodeId = null;
network.on('hoverNode', params => {
  hoveredNodeId = params.node;
  container.style.cursor = 'pointer';
});
network.on('blurNode', () => {
  hoveredNodeId = null;
  container.style.cursor = 'default';
});
network.on('click', params => {
  if (params.nodes.length > 0) {
    showInfo(params.nodes[0]);
  } else {
    document.getElementById('info-content').innerHTML = '<span class="empty">Click a node to inspect it</span>';
  }
});

// Repaint after mobile browser chrome/orientation changes without refitting,
// preserving the current graph pan and zoom while using the resized canvas.
let graphResizeFrame = 0;
function redrawGraph() {
  cancelAnimationFrame(graphResizeFrame);
  graphResizeFrame = requestAnimationFrame(() => network.redraw());
}
window.addEventListener('resize', redrawGraph, { passive: true });
window.visualViewport?.addEventListener('resize', redrawGraph, { passive: true });
if (window.ResizeObserver) new ResizeObserver(redrawGraph).observe(container);

const searchInput = document.getElementById('search');
const searchResults = document.getElementById('search-results');
searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase().trim();
  searchResults.innerHTML = '';
  if (!q) { searchResults.style.display = 'none'; return; }
  const matches = RAW_NODES.filter(n => n.label.toLowerCase().includes(q) || (n.file && n.file.toLowerCase().includes(q))).slice(0, 24);
  if (!matches.length) { searchResults.style.display = 'none'; return; }
  searchResults.style.display = 'block';
  matches.forEach(n => {
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('role', 'option');
    el.className = 'search-item';
    const color = n.color && n.color.background ? n.color.background : n.color;
    el.innerHTML = esc(n.label) + (n.file ? '<small>' + esc(n.file.split('/').pop()) + ':' + esc(String(n.line)) + '</small>' : '<small>' + esc(n.subject || '') + '</small>');
    el.style.borderLeft = '3px solid ' + esc(color);
    el.style.paddingLeft = '8px';
    el.onclick = () => {
      network.focus(n.id, { scale: 1.5, animation: true });
      network.selectNodes([n.id]);
      showInfo(n.id);
      searchResults.style.display = 'none';
      searchInput.value = '';
    };
    searchResults.appendChild(el);
  });
});
document.addEventListener('click', e => {
  if (!searchResults.contains(e.target) && e.target !== searchInput)
    searchResults.style.display = 'none';
});

const hiddenSubjects = new Set();
const selectAllCb = document.getElementById('select-all-cb');

function updateSelectAllState() {
  const total = LEGEND.length;
  const hidden = hiddenSubjects.size;
  selectAllCb.checked = hidden === 0;
  selectAllCb.indeterminate = hidden > 0 && hidden < total;
}

function toggleAllSubjects(hide) {
  document.querySelectorAll('.legend-item').forEach(item => {
    hide ? item.classList.add('dimmed') : item.classList.remove('dimmed');
  });
  document.querySelectorAll('.legend-cb').forEach(cb => {
    cb.checked = !hide;
  });
  LEGEND.forEach(c => {
    if (hide) hiddenSubjects.add(c.cid); else hiddenSubjects.delete(c.cid);
  });
  const updates = RAW_NODES.map(n => ({ id: n.id, hidden: hide }));
  nodesDS.update(updates);
  updateSelectAllState();
}

const legendEl = document.getElementById('legend');
LEGEND.forEach(c => {
  const item = document.createElement('div');
  item.className = 'legend-item';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'legend-cb';
  cb.checked = true;
  cb.setAttribute('aria-label', 'Show subject ' + c.label);
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    if (cb.checked) {
      hiddenSubjects.delete(c.cid);
      item.classList.remove('dimmed');
    } else {
      hiddenSubjects.add(c.cid);
      item.classList.add('dimmed');
    }
    const updates = RAW_NODES
      .filter(n => n.subject === c.cid)
      .map(n => ({ id: n.id, hidden: !cb.checked }));
    nodesDS.update(updates);
    updateSelectAllState();
  });
  item.innerHTML = '<div class="legend-dot" style="background:' + esc(c.color) + '"></div>' +
    '<span class="legend-label">' + esc(c.label) + '</span>' +
    '<span class="legend-count">' + esc(String(c.count)) + '</span>';
  item.prepend(cb);
  item.onclick = (e) => {
    if (e.target === cb) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change'));
  };
  legendEl.appendChild(item);
});
window.toggleAllSubjects = toggleAllSubjects;
}
if (window.vis && window.vis.Network && window.vis.DataSet) initializeGraph();
else if (visScript.dataset.failed === 'true') showGraphLoadError();
else {
  visScript.addEventListener('load', initializeGraph, { once: true });
  visScript.addEventListener('error', showGraphLoadError, { once: true });
}
</script>
</body>
</html>
`;
}
