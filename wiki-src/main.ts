// CyberManju OS — wiki 3D app (wiki-src/main.ts).
// Role: Three.js scenery (orbiting module nodes around a manju mascot) + reader panels.
// Exports: boot() — fetches subjects.json, builds scene + rail + panel + hash routing.
// Integrates: built by vite.config.wiki.ts into dist-wasm/wiki/; data from
//   scripts/generate-wiki.mjs (subjects.json); static twins at wiki/<id>.html.
// Contracts: fully static (no backend); honors prefers-reduced-motion; read-only fetch.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

interface TopSymbol {
  name: string;
  kind: string;
  docs: string;
  file: string;
}

interface Subject {
  id: string;
  title: string;
  tag: string;
  blurb: string;
  color: string;
  fileCount: number;
  symbolCount: number;
  contracts: string[];
  top: TopSymbol[];
}

interface WikiData {
  version: string;
  subjects: Subject[];
}

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function glowSprite(color: string, size: number, opacity: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color + 'aa');
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(size, size, 1);
  return sp;
}

function textSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '700 46px "Baloo 2", system-ui, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 56;
  c.width = w;
  c.height = 84;
  const g2 = c.getContext('2d')!;
  g2.font = font;
  g2.textBaseline = 'middle';
  // Pill backdrop so labels read over the starfield.
  g2.fillStyle = 'rgba(13,7,20,0.72)';
  g2.beginPath();
  g2.roundRect(2, 6, w - 4, 72, 36);
  g2.fill();
  g2.strokeStyle = 'rgba(168,85,247,0.55)';
  g2.lineWidth = 2;
  g2.stroke();
  g2.fillStyle = '#f5f3ff';
  g2.fillText(text, 28, 44);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  const h = 1.05;
  sp.scale.set((h * w) / 84, h, 1);
  return sp;
}

function manjuFace(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  const ink = '#2b1247';
  // Eyes (anime ovals + highlights).
  for (const x of [86, 170]) {
    g.fillStyle = ink;
    g.beginPath();
    g.ellipse(x, 108, 17, 24, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x + 5, 100, 6, 0, Math.PI * 2);
    g.fill();
  }
  // Blush.
  g.fillStyle = 'rgba(255,77,109,0.55)';
  for (const x of [52, 204]) {
    g.beginPath();
    g.ellipse(x, 152, 20, 11, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Smile.
  g.strokeStyle = ink;
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(128, 138, 20, Math.PI * 0.2, Math.PI * 0.8);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

async function boot(): Promise<void> {
  const panel = document.getElementById('panel')!;
  const rail = document.getElementById('rail')!;
  const tooltip = document.getElementById('tooltip')!;
  const search = document.getElementById('search') as HTMLInputElement;

  // Skeleton while subjects.json loads (replaced on first render).
  panel.innerHTML = `<div class="tag">loading…</div><h1>CyberManju wiki</h1>
    <div class="skel" style="width:92%"></div><div class="skel" style="width:78%"></div>
    <div class="skel" style="width:85%"></div><div class="skel" style="width:60%"></div>`;

  let data: WikiData;
  try {
    const res = await fetch('./subjects.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as WikiData;
  } catch (err) {
    panel.innerHTML = `<h1>Wiki data missing</h1><p class="empty">Could not load <code>subjects.json</code> (${esc(
      String(err),
    )}). Run <code>npm run wiki</code> to regenerate it.</p>`;
    return;
  }
  const byId = new Map(data.subjects.map((s) => [s.id, s]));

  // ── Scene ────────────────────────────────────────────────
  const mount = document.getElementById('scene')!;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0d0714, 0.011);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    400,
  );
  camera.position.set(0, 8.5, 30);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 9;
  controls.maxDistance = 70;
  controls.maxPolarAngle = 1.68;
  controls.autoRotate = !REDUCED;
  controls.autoRotateSpeed = 0.55;
  renderer.domElement.addEventListener('pointerdown', () => {
    controls.autoRotate = false;
  });

  scene.add(new THREE.HemisphereLight(0xc4b5fd, 0x1a0f2e, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(12, 20, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe879f9, 0.6);
  rim.position.set(-14, 4, -12);
  scene.add(rim);

  // Starfield.
  {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const r = 45 + Math.random() * 55;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[k * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[k * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.7 - 6;
      pos[k * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xcbb8ff,
        size: 0.35,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    stars.name = 'stars';
    scene.add(stars);
  }

  // Nebulae (animated-video-background feel, zero video files).
  const nebulae: THREE.Sprite[] = [];
  for (const [color, x, y, z, size, op] of [
    ['#7c3aed', -32, 10, -34, 55, 0.2],
    ['#ff4d6d', 30, 4, -30, 44, 0.15],
    ['#a855f7', 4, 16, -42, 60, 0.18],
    ['#e879f9', -8, -2, 30, 36, 0.1],
  ] as const) {
    const sp = glowSprite(color, size, op);
    sp.position.set(x, y, z);
    scene.add(sp);
    nebulae.push(sp);
  }

  // Floor grid.
  const grid = new THREE.GridHelper(90, 45, 0xa855f7, 0x3b1a5e);
  const gridMat = grid.material as THREE.Material;
  gridMat.transparent = true;
  gridMat.opacity = 0.26;
  grid.position.y = -4.5;
  scene.add(grid);

  // ── Manju mascot ─────────────────────────────────────────
  const mascot = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0xfff3e2, roughness: 0.6 }),
  );
  body.scale.set(1, 0.82, 0.95);
  mascot.add(body);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({ map: manjuFace(), transparent: true }),
  );
  face.position.set(0, 0.18, 1.44);
  mascot.add(face);
  const halo = glowSprite('#e879f9', 5.2, 0.35);
  mascot.add(halo);
  mascot.position.y = 1.6;
  scene.add(mascot);

  // ── Subject nodes on two tilted rings ────────────────────
  const nodes: THREE.Mesh[] = [];
  const nodeById = new Map<string, THREE.Mesh>();
  const lines: THREE.Line[] = [];
  const ringDefs = [
    { r: 11.5, y: 3.4, tilt: 0.12 },
    { r: 15.0, y: -0.6, tilt: -0.1 },
  ];
  data.subjects.forEach((sub, ix) => {
    const ring = ringDefs[ix % 2];
    const per = Math.ceil(data.subjects.length / 2);
    const slot = Math.floor(ix / 2);
    const a = (slot / per) * Math.PI * 2 + (ix % 2 ? Math.PI / per : 0);
    const pos = new THREE.Vector3(
      Math.cos(a) * ring.r,
      ring.y + Math.sin(a * 2) * ring.r * ring.tilt,
      Math.sin(a) * ring.r,
    );
    const color = new THREE.Color(sub.color);
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.85, 1),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.55,
        roughness: 0.3,
        metalness: 0.15,
      }),
    );
    mesh.position.copy(pos);
    mesh.userData.id = sub.id;
    scene.add(mesh);
    nodes.push(mesh);
    nodeById.set(sub.id, mesh);

    const orbit = new THREE.Mesh(
      new THREE.TorusGeometry(1.3, 0.028, 10, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
      }),
    );
    orbit.position.copy(pos);
    orbit.rotation.x = Math.PI / 2.4;
    scene.add(orbit);

    const label = textSprite(sub.title);
    label.position.copy(pos).add(new THREE.Vector3(0, 1.7, 0));
    scene.add(label);

    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 1.6, 0),
      pos,
    ]);
    const link = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: 0xa855f7,
        transparent: true,
        opacity: 0.22,
      }),
    );
    scene.add(link);
    lines.push(link);
  });

  // Festival lanterns drifting upward.
  const lanterns: { sp: THREE.Sprite; speed: number }[] = [];
  if (!REDUCED) {
    for (let k = 0; k < 70; k++) {
      const sp = glowSprite(k % 3 ? '#ffb37a' : '#e879f9', 0.5 + Math.random() * 0.7, 0.5);
      sp.position.set(
        (Math.random() - 0.5) * 60,
        -4 + Math.random() * 16,
        (Math.random() - 0.5) * 60,
      );
      scene.add(sp);
      lanterns.push({ sp, speed: 0.25 + Math.random() * 0.55 });
    }
  }

  // Selection beacon: light pillar + expanding ring, recolored per subject.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.55, 7, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beacon.visible = false;
  scene.add(beacon);
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.1, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  pulse.visible = false;
  pulse.rotation.x = -Math.PI / 2;
  scene.add(pulse);

  // Shooting stars: one streak every few seconds.
  const shooters: { sp: THREE.Sprite; vel: THREE.Vector3; life: number }[] = [];
  let nextShooter = 3;
  function spawnShooter(now: number): void {
    const sp = glowSprite('#f5f3ff', 2.6, 0.9);
    sp.position.set((Math.random() - 0.5) * 70, 18 + Math.random() * 10, -30 - Math.random() * 20);
    sp.scale.set(7, 1.1, 1);
    scene.add(sp);
    shooters.push({
      sp,
      vel: new THREE.Vector3(-(14 + Math.random() * 10), -5 - Math.random() * 3, 0),
      life: now + 1.1,
    });
    nextShooter = now + 2.5 + Math.random() * 4;
  }

  // Mascot blink state (squash-and-stretch, no texture swap needed).
  let blinkAt = 2.5;

  // ── Reader UI ────────────────────────────────────────────
  let selected: string | null = null;
  const focusTarget = new THREE.Vector3(0, 1.5, 0);
  // Camera fly-to goal; null once the user grabs the camera.
  let camGoal: THREE.Vector3 | null = null;

  function flyTo(point: THREE.Vector3): void {
    if (REDUCED) return;
    const dir = point.clone().sub(new THREE.Vector3(0, 1.5, 0));
    if (dir.lengthSq() < 0.01) dir.set(0, 0.35, 1);
    dir.normalize();
    camGoal = point.clone().add(dir.multiplyScalar(9.5)).add(new THREE.Vector3(0, 3.2, 0));
  }

  function flyHome(): void {
    if (REDUCED) return;
    camGoal = new THREE.Vector3(0, 8.5, 30);
  }

  function renderRail(filter = ''): void {
    const q = filter.trim().toLowerCase();
    rail.innerHTML = '';
    for (const sub of data.subjects) {
      if (
        q &&
        !sub.title.toLowerCase().includes(q) &&
        !sub.tag.toLowerCase().includes(q) &&
        !sub.id.includes(q) &&
        !sub.top.some((t) => t.name.toLowerCase().includes(q))
      ) {
        continue;
      }
      const b = document.createElement('button');
      b.style.setProperty('--dot', sub.color);
      if (sub.id === selected) b.classList.add('on');
      b.innerHTML = `<span class="dot"></span><span>${esc(sub.title)}</span><span class="meta">${sub.fileCount}f</span>`;
      b.addEventListener('click', () => {
        window.location.hash = `#/${sub.id}`;
      });
      rail.appendChild(b);
    }
    if (!rail.children.length) {
      rail.innerHTML = '<p class="empty" style="padding:8px">No modules match.</p>';
    }
  }

  function symbolMatches(q: string, cap: number): { sub: Subject; sym: TopSymbol }[] {
    const out: { sub: Subject; sym: TopSymbol }[] = [];
    if (!q) return out;
    for (const sub of data.subjects) {
      for (const sym of sub.top) {
        if (sym.name.toLowerCase().includes(q)) {
          out.push({ sub, sym });
          if (out.length >= cap) return out;
        }
      }
    }
    return out;
  }

  function renderPanel(): void {
    const q = search.value.trim().toLowerCase();
    if (!selected || !byId.has(selected)) {
      const totalFiles = data.subjects.reduce((a, s) => a + s.fileCount, 0);
      const totalSyms = data.subjects.reduce((a, s) => a + s.symbolCount, 0);
      panel.style.setProperty('--ac', '#a855f7');
      document.title = 'CyberManju OS — 3D wiki';
      const hits = symbolMatches(q, 12);
      const hitsHtml = hits.length
        ? `<h2>Symbol matches</h2><div class="chips matches">${hits
            .map(
              ({ sub, sym }) =>
                `<button data-go="${sub.id}" title="${esc(sym.file)}${sym.docs ? ` — ${esc(sym.docs)}` : ''}"><code>${esc(sym.name)}</code><span>${esc(sub.title)}</span></button>`,
            )
            .join('')}</div>`
        : '';
      panel.innerHTML = `
        <div class="tag">quantum-resistant file manager + OS layer · v${esc(data.version)}</div>
        <h1>CyberManju wiki</h1>
        <p class="blurb">Orbit the manju — every glowing module is a part of the system.
        Click one (or pick from the rail) to read what it owns, what it exposes,
        and how it plugs into the whole.</p>
        <div class="stats"><span>${data.subjects.length} subjects</span><span>${totalFiles} files</span><span>${totalSyms} symbols</span></div>
        ${hitsHtml}
        <h2>For agents</h2>
        <ul class="links"><li><a href="../llms.txt">llms.txt</a></li><li><a href="./overview.txt">overview.txt</a></li></ul>
        <h2>For humans</h2>
        <ul class="links"><li><a href="./overview.html">static pages</a></li><li><a href="../">open the app</a></li></ul>
        <p class="keys"><kbd>/</kbd> search · <kbd>↑↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> overview</p>`;
      panel.querySelectorAll('button[data-go]').forEach((b) => {
        b.addEventListener('click', () => {
          window.location.hash = `#/${(b as HTMLButtonElement).dataset.go}`;
        });
      });
      return;
    }
    const sub = byId.get(selected)!;
    const ix = data.subjects.findIndex((s) => s.id === sub.id);
    const prev = data.subjects[(ix - 1 + data.subjects.length) % data.subjects.length];
    const next = data.subjects[(ix + 1) % data.subjects.length];
    panel.style.setProperty('--ac', sub.color);
    document.title = `${sub.title} — CyberManju wiki`;
    const syms = sub.top
      .slice(0, 24)
      .map(
        (s) =>
          `<code title="${esc(s.file)}${s.docs ? ` — ${esc(s.docs)}` : ''}">${esc(s.name)}</code>`,
      )
      .join('');
    const pageUrl = `${window.location.origin}${window.location.pathname}#/${sub.id}`;
    panel.innerHTML = `
      <div class="crumbs"><button data-go="">wiki</button><span>/</span><b>${esc(sub.title)}</b>
        <button class="copy" data-copy="${esc(pageUrl)}" title="Copy link to this module">copy link</button></div>
      <div class="tag">${esc(sub.tag)}</div>
      <h1>${esc(sub.title)}</h1>
      <p class="blurb">${esc(sub.blurb)}</p>
      <div class="stats"><span>${sub.fileCount} files</span><span>${sub.symbolCount} symbols</span><span>v${esc(data.version)}</span></div>
      <h2>Top symbols</h2><div class="chips">${syms}</div>
      <h2>Contracts</h2><div class="chips">${sub.contracts.length ? sub.contracts.map((c) => `<code>${esc(c)}</code>`).join('') : '<code>none — pure logic</code>'}</div>
      <h2>Read offline</h2>
      <ul class="links">
        <li><a href="./${sub.id}.txt">.txt for LLMs</a></li>
        <li><a href="./${sub.id}.json">.json</a></li>
        <li><a href="./${sub.id}.html">static page</a></li>
      </ul>
      <div class="pager">
        <button data-go="${prev.id}">← ${esc(prev.title)}</button>
        <button data-go="${next.id}">${esc(next.title)} →</button>
      </div>`;
    panel.querySelectorAll('button[data-go]').forEach((b) => {
      const go = (b as HTMLButtonElement).dataset.go;
      b.addEventListener('click', () => {
        window.location.hash = go ? `#/${go}` : '#/';
      });
    });
    const copy = panel.querySelector('button[data-copy]');
    if (copy) {
      copy.addEventListener('click', async () => {
        const url = (copy as HTMLButtonElement).dataset.copy ?? pageUrl;
        try {
          await navigator.clipboard.writeText(url);
          copy.textContent = 'copied ✓';
        } catch {
          copy.textContent = url;
        }
        window.setTimeout(() => {
          if (copy.isConnected) copy.textContent = 'copy link';
        }, 1600);
      });
    }
  }

  function select(id: string | null): void {
    selected = id && byId.has(id) ? id : null;
    renderRail(search.value);
    renderPanel();
    const mesh = selected ? nodeById.get(selected) : undefined;
    if (mesh) {
      focusTarget.copy(mesh.position);
      flyTo(mesh.position);
      const sub = byId.get(selected!);
      if (sub) {
        beacon.visible = true;
        pulse.visible = true;
        beacon.position.copy(mesh.position).add(new THREE.Vector3(0, 1.2, 0));
        pulse.position.copy(mesh.position).add(new THREE.Vector3(0, -1.4, 0));
        const c = new THREE.Color(sub.color);
        (beacon.material as THREE.MeshBasicMaterial).color.copy(c);
        (pulse.material as THREE.MeshBasicMaterial).color.copy(c);
      }
    } else {
      focusTarget.set(0, 1.5, 0);
      beacon.visible = false;
      pulse.visible = false;
      flyHome();
    }
  }

  function route(): void {
    const m = window.location.hash.match(/^#\/([\w-]+)/);
    select(m ? m[1] : null);
  }
  window.addEventListener('hashchange', route);

  search.addEventListener('input', () => {
    renderRail(search.value);
    // Live symbol matches surface in the overview panel.
    if (!selected) renderPanel();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = rail.querySelector('button');
      if (first) (first as HTMLButtonElement).click();
    }
  });

  // Global keys: `/` focuses search, arrows walk the rail, Esc goes home.
  // (Skipped while typing anywhere except the search box itself.)
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      e.preventDefault();
      search.focus();
      return;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const order = [...rail.querySelectorAll('button')].map(
      (b) => b.textContent ?? '',
    );
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const ids = data.subjects
        .filter((s) => order.some((t) => t.includes(s.title)))
        .map((s) => s.id);
      const pool = ids.length ? ids : data.subjects.map((s) => s.id);
      let ix = pool.indexOf(selected ?? '');
      ix = e.key === 'ArrowDown' ? (ix + 1) % pool.length : (ix - 1 + pool.length) % pool.length;
      window.location.hash = `#/${pool[ix]}`;
    } else if (e.key === 'Escape') {
      if (window.location.hash) window.location.hash = '#/';
    }
  });

  // ── Picking ──────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let hovered: string | null = null;
  let downAt: [number, number] | null = null;

  function pick(ev: { clientX: number; clientY: number }): string | null {
    ptr.x = (ev.clientX / window.innerWidth) * 2 - 1;
    ptr.y = -(ev.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(nodes, false)[0];
    return hit ? (hit.object.userData.id as string) : null;
  }

  renderer.domElement.addEventListener('pointermove', (ev) => {
    const id = pick(ev);
    hovered = id;
    renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    if (id && byId.has(id)) {
      const sub = byId.get(id)!;
      tooltip.hidden = false;
      tooltip.textContent = `${sub.title} — ${sub.tag}`;
      tooltip.style.left = `${ev.clientX + 14}px`;
      tooltip.style.top = `${ev.clientY + 10}px`;
    } else {
      tooltip.hidden = true;
    }
  });
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    downAt = [ev.clientX, ev.clientY];
    // The user grabbed the camera: cancel any in-flight fly-to.
    camGoal = null;
    tooltip.hidden = true;
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!downAt) return;
    const dx = ev.clientX - downAt[0];
    const dy = ev.clientY - downAt[1];
    downAt = null;
    if (dx * dx + dy * dy > 36) return; // was a drag, not a tap
    const id = pick(ev);
    window.location.hash = id ? `#/${id}` : '#/';
  });
  renderer.domElement.addEventListener('dblclick', (ev) => {
    if (!pick(ev)) window.location.hash = '#/';
  });

  // Pause rendering when the tab is hidden (battery + GPU).
  let hidden = false;
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
  });

  // ── Loop ─────────────────────────────────────────────────
  const clock = new THREE.Clock();
  function tick(): void {
    requestAnimationFrame(tick);
    if (hidden) return;
    const t = clock.getElapsedTime();
    if (!REDUCED) {
      // Mascot life: bob + slow look-around + a blink (squash) every ~4s.
      const sinceBlink = t - blinkAt;
      const squash = sinceBlink > 0 && sinceBlink < 0.16 ? 0.9 : 1;
      mascot.position.y = 1.6 + Math.sin(t * 1.8) * 0.32;
      mascot.rotation.y = Math.sin(t * 0.4) * 0.35;
      mascot.scale.set(2 - squash, squash, 1);
      if (sinceBlink > 4 + (blinkAt % 1.7)) blinkAt = t;
      const stars = scene.getObjectByName('stars');
      if (stars) stars.rotation.y = t * 0.008;
      nebulae.forEach((n, k) => {
        n.position.y += Math.sin(t * 0.24 + k * 2.1) * 0.0016;
      });
      for (const { sp, speed } of lanterns) {
        sp.position.y += speed * 0.016;
        if (sp.position.y > 13) sp.position.y = -4;
      }
      if (t >= nextShooter) spawnShooter(t);
      for (let k = shooters.length - 1; k >= 0; k--) {
        const s = shooters[k];
        s.sp.position.addScaledVector(s.vel, 0.016);
        const left = s.life - t;
        (s.sp.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(0.9, left));
        if (left <= 0) {
          scene.remove(s.sp);
          (s.sp.material.map as THREE.Texture).dispose();
          s.sp.material.dispose();
          shooters.splice(k, 1);
        }
      }
      // Beacon breathing + expanding pulse ring on the selected node.
      if (beacon.visible) {
        const bm = beacon.material as THREE.MeshBasicMaterial;
        bm.opacity = 0.22 + Math.sin(t * 3) * 0.08;
        const cycle = (t % 1.6) / 1.6;
        pulse.scale.setScalar(1 + cycle * 2.2);
        (pulse.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - cycle);
      }
    }
    nodes.forEach((mesh) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const id = mesh.userData.id as string;
      const active = id === selected || id === hovered;
      mat.emissiveIntensity += ((active ? 1.25 : 0.55) - mat.emissiveIntensity) * 0.15;
      const s = id === selected ? 1 + Math.sin(t * 4) * 0.1 : 1;
      mesh.scale.setScalar(s);
      mesh.rotation.y += active ? 0.012 : 0.003;
      mesh.rotation.x += 0.001;
    });
    // Highlight the selected module's link back to the manju.
    lines.forEach((link, ix) => {
      const on = data.subjects[ix]?.id === selected;
      const lm = link.material as THREE.LineBasicMaterial;
      lm.opacity += ((on ? 0.65 : 0.22) - lm.opacity) * 0.15;
    });
    if (camGoal) {
      camera.position.lerp(camGoal, 0.045);
      if (camera.position.distanceTo(camGoal) < 0.2) camGoal = null;
    }
    controls.target.lerp(focusTarget, 0.06);
    controls.update();
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderRail();
  route();
  tick();
}

void boot();
