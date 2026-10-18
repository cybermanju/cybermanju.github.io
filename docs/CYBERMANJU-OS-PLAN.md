// CyberManju OS — Master Plan (docs/CYBERMANJU-OS-PLAN.md).
// Role: Complete architecture and implementation roadmap for transforming CyberManju from a Tauri app into a bootable, installable OS with GPU-accelerated shell, modular WASM apps, and decentralized P2P sync.
// Exports: Phase plans, architecture diagrams, technology decisions, integration specs, packaging guides.
// Integrates: niri (Wayland compositor), GPUI/gpui-shell (GPU shell), Ubuntu 26.04 (base), COSMIC DE (optional), WASM modular apps, GitHub Pages static API, LUKS2+ML-KEM encryption, NVIDIA/AMD drivers, low-latency kernel.
// Contracts: All phases respect the AGENTS.md rules (no local cargo, no npm ci from scratch, file headers enforced). CI gates: meta-check, rust-check, docker-build, audit, wasm-build, deploy-pages.

# CyberManju OS — Master Plan

> **Vision:** Transform CyberManju from a Tauri desktop app into a bootable, installable OS featuring a GPU-accelerated native shell (GPUI), modular WASM-as-apps that run identically on GitHub Pages and on the desktop, decentralized P2P sync, quantum-resistant full-disk encryption, and a choice of niri or COSMIC as the Wayland compositor.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Assessment](#2-current-state-assessment)
3. [Target Architecture](#3-target-architecture)
4. [Phase 0: Foundation — Bootable ISO](#phase-0-foundation--bootable-iso)
5. [Phase 1: GPUI Shell with Vue Rendering](#phase-1-gpui-shell-with-vue-rendering)
6. [Phase 2: WASM-as-Apps — Modular Processes](#phase-2-wasm-as-apps--modular-processes)
7. [Phase 3: GitHub Pages Static API Endpoints](#phase-3-github-pages-static-api-endpoints)
8. [Phase 4: Ubuntu Packaging — COSMIC from Source](#phase-4-ubuntu-packaging--cosmic-from-source)
9. [Phase 5: Low-Latency Kernel and Driver Detection](#phase-5-low-latency-kernel-and-driver-detection)
10. [Phase 6: Decentralized P2P Sync](#phase-6-decentralized-p2p-sync)
11. [Phase 7: Full OS Integration](#phase-7-full-os-integration)
12. [Technology Deep Dives](#technology-deep-dives)
13. [Risk Register](#risk-register)
14. [Timeline Summary](#timeline-summary)

---

## 1. Executive Summary

### What exists today

| Component | Technology | Lines | Status |
|---|---|---|---|
| Frontend | Vue 3 + TypeScript + Pinia | ~49 components, 34 composables, 74 utils | Production |
| Backend | Tauri v2 (Rust), 18-crate workspace | ~175 command handlers | Production |
| WASM | `crates/os-wasm` (agent/artifact/canal/compression/crypto/db/opfs/os) | wasm-pack | Production |
| Crypto | ChaCha20Poly1305, ML-KEM-1024, ML-DSA-65, SLH-DSA-128f, Argon2id, BLAKE3 | `crates/crypto` | Production |
| DB | redb (single file, JSON rows), 40 tables | `crates/db` | Production |
| Search | Tantivy 0.22 BM25 + `crates/scene` heuristic | 17 categories, 10 langs | Production |
| Sync | Backends/pipeline/scrub/repair/gc/lease | `crates/sync` | Production |

### What does NOT exist

| Missing piece | Why it matters |
|---|---|
| Kernel / bootloader / initramfs | Without these, no boot |
| Boot process (UEFI, systemd-boot) | Without this, no EFI flash |
| Display server / compositor | Without this, no GUI |
| System shell (panel, launcher, notifications) | Without this, no desktop |
| Installer (disk partitioning, encryption, EFI setup) | Without this, no install |
| Package management integration | Without this, no updates |
| Service management (systemd units) | Without this, no background processes |

### The plan in one sentence

Build a **custom Ubuntu 26.04 ISO** with **niri** as the Wayland compositor, **GPUI** as the GPU-accelerated shell layer, **CyberManju Tauri** as the primary app, **modular WASM processes** that run identically on GitHub Pages and on the desktop, **LUKS2+ML-KEM** full-disk encryption, and a **custom Rust installer** — targeting a bootable alpha in 8 weeks and a daily-driver beta in 20 weeks.

---

## 2. Current State Assessment

### What CyberManju actually is

CyberManju OS is a **desktop application**, not an OS:

- **Frontend:** Vue 3 web app (49 components, Pinia store, 34 composables, 74 utils)
- **Backend:** Tauri v2 (Rust), 18-crate workspace, ~175 handlers
- **Deployment:** Native binaries, Flatpak, Docker container, WASM for GitHub Pages
- **Storage:** `crates/disk` abstraction over redb, plus sync/encryption — all userspace
- **No:** kernel, bootloader, init system, display server, hardware drivers, package manager, service management

### The gap to a real OS

```
Current:  [Vue app] → [Tauri window] → [Host OS compositor] → [Host OS kernel]
Target:   [Vue app] → [Tauri window] → [niri compositor] → [Linux kernel] → [Custom boot]
                ↑
          [GPUI shell] → [GPU] → [Vulkan]
```

### Key technology facts (verified October 2026)

| Fact | Source |
|---|---|
| Rust in kernel since v6.1, `CONFIG_RUST` | kernel.org docs 7.3.0-rc7 |
| Only arm64 and x86_64 are "Maintained" level | kernel.org arch-support |
| 2 unstable features remain (arbitrary_self_types, derive_coerce_pointee) | goals.rust-lang.org |
| Rust for Linux stabilizing on stable Rust, target 2026-2027 | LPC 2026 presentation |
| COSMIC DE 1.0 released Dec 2025, ~200k lines Rust | System76 |
| niri is stable for daily use, 28.5k stars | github.com/niri-wm/niri |
| GPUI is pre-1.0, requires latest stable Rust | Zed project |
| GPUI webview on Linux = XWayland only (not native Wayland) | gpui-webview docs |
| Ubuntu `linux-nvidia-lowlatency` 6.8.0-1064.67.1 | Launchpad |
| AMD Radeon Software 26.16, open-source `amdgpu` recommended | AMD release notes |
| NVIDIA GeForce 617.42 WHQL | TechPowerUp |

---

## 3. Target Architecture

### Full system diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  CyberManju OS ISO (Ubuntu 26.04 base)                              │
│                                                                      │
│  ┌─── BOOT ─────────────────────────────────────────────────────┐   │
│  │ systemd-boot → initramfs → LUKS2 unlock (ML-KEM key wrap)    │   │
│  │ Kernel: linux-nvidia-lowlatency 6.8.0-1064.67.1             │   │
│  │   └─ CONFIG_RUST=y (for future Rust drivers)                │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─── DISPLAY ──────────────────────────────────────────────────┐   │
│  │ niri (Wayland compositor, Rust, scrollable-tiling)          │   │
│  │   ├── gpui-shell (GPU-accelerated system bar/launcher/CC)   │   │
│  │   │   └── WGPU → Vulkan → GPU                                │   │
│  │   ├── CyberManju Tauri (Vue 3 in WebKitGTK, one window)     │   │
│  │   │   ├── files panel                                        │   │
│  │   │   ├── agent chat                                         │   │
│  │   │   ├── vault management                                   │   │
│  │   │   └── sync dashboard                                     │   │
│  │   ├── WASM modular apps (WASMtime runtime)                   │   │
│  │   │   ├── vault-app.wasm  (vault management as a window)    │   │
│  │   │   ├── sync-app.wasm  (sync dashboard as a window)       │   │
│  │   │   ├── agent-app.wasm  (agent chat as a window)          │   │
│  │   │   └── ... (per-feature WASM modules)                    │   │
│  │   └── Native apps (terminal, browser, etc.)                 │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─── SERVICES (systemd) ───────────────────────────────────────┐   │
│  │ cybermanju-agent    (AI agent loop, crates/agent)            │   │
│  │ cybermanju-sync     (file sync, crates/sync)                 │   │
│  │ cybermanju-vault    (encrypted volume, crates/crypto)        │   │
│  │ cybermanju-wasm     (WASM app runtime, WASMtime)             │   │
│  │ cybermanju-install  (first-boot setup wizard)                │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─── CRYPTO ───────────────────────────────────────────────────┐   │
│  │ LUKS2 full-disk encryption                                    │   │
│  │   └─ Argon2id KDF + ChaCha20Poly1305                         │   │
│  │   └─ ML-KEM-1024 key wrapping (quantum-resistant)            │   │
│  │   └─ BLAKE3 integrity verification                           │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─── P2P SYNC ─────────────────────────────────────────────────┐   │
│  │ iroh/libp2p (Rust P2P)                                       │   │
│  │   └─ Device-to-device encrypted sync                         │   │
│  │   └─ CRDT conflict resolution (Automerge)                    │   │
│  │   └─ WebRTC for real-time collaboration                     │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─── DRIVERS ──────────────────────────────────────────────────┐   │
│  │ NVIDIA: 617.42 WHQL (or Ubuntu 580)                          │   │
│  │ AMD: amdgpu open-source (kernel) + Mesa (userspace)          │   │
│  │ Intel: i915/Xe (kernel) + Mesa (userspace)                   │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─── INSTALLER ────────────────────────────────────────────────┐   │
│  │ Custom Rust binary (runs from initramfs/live USB)            │   │
│  │   ├── Disk partitioning (GPT + EFI)                          │   │
│  │   ├── LUKS2 encryption setup                                 │   │
│  │   ├── Btrfs subvolume layout                                 │   │
│  │   ├── Bootloader installation (systemd-boot)                 │   │
│  │   ├── First-boot initialization                              │   │
│  │   └── Driver detection + kernel selection                    │   │
│  └───────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Layer responsibility matrix

| Layer | Responsibility | Technology | Reuse |
|---|---|---|---|
| Boot | UEFI, initramfs, disk unlock | systemd-boot, dracut | Existing |
| Kernel | Hardware, drivers, scheduling | Linux 6.8 low-latency | Existing |
| Display | Compositing, window management | niri | Existing |
| Shell | Bar, launcher, notifications, control center | GPUI/gpui-shell | Fork + extend |
| App | File manager, agent, vault, sync | Tauri + Vue 3 | Existing |
| WASM | Modular per-feature apps | WASMtime + crates/os-wasm | Build |
| P2P | Decentralized sync, RTC | iroh + Automerge | Build |
| Install | Disk, encryption, bootloader | Custom Rust | Build |
| Package | Updates, dependencies | apt + custom repo | Existing |

---

## Phase 0: Foundation — Bootable ISO

### Goal

A minimal bootable ISO that starts Ubuntu 26.04 with niri as the compositor and CyberManju Tauri as the only app. No installer, no encryption, no custom shell — just prove the boot chain works.

### Steps

0.1 **Base ISO selection**
   - Start from Ubuntu 26.04 LTS (or 25.10 if 26.04 not yet released)
   - Alternative: Arch ISO (rolling release, newer packages)

0.2 **Package selection** (live USB or chroot)
   ```bash
   apt install niri Vulkan mesa-utils
   apt install tauri-deps webkit2gtk-4.1-dev libgtk-3-dev
   apt install linux-nvidia-lowlatency  # or linux-lowlatency
   ```

0.3 **Autostart niri + CyberManju**
   - Create `~/.config/autostart/niri.desktop`
   - Create `~/.config/autostart/cybermanju.desktop`
   - Or use a systemd user service

0.4 **EFI boot test**
   - Write ISO to USB: `dd if=cybermanju-os-alpha.iso of=/dev/sdX bs=4M`
   - Boot on target hardware with UEFI enabled
   - Verify niri starts, CyberManju Tauri window appears

### Deliverables

- [ ] Bootable ISO image
- [ ] niri compositor running
- [ ] CyberManju Tauri window visible
- [ ] Basic input (keyboard/mouse) working

### Time estimate

**1 week** — this is pure assembly, no invention.

---

## Phase 1: GPUI Shell with Vue Rendering

### Goal

Build a GPU-accelerated desktop shell using GPUI that provides system bar, launcher, control center, and optionally renders Vue components.

### 1A: gpui-shell as system chrome (proven path)

Fork [gpui-shell](https://github.com/andre-brandao/gpui-shell) and add CyberManju-specific modules:

```
gpui-shell (fork)
├── crates/
│   ├── app/           — main shell binary
│   ├── services/      — D-Bus services (audio, network, bluetooth)
│   ├── ui/            — GPUI components
│   ├── assets/        — icons, themes
│   ├── story/         — storybook/examples
│   └── cybermanju/   — NEW: CyberManju integration
│       ├── vault_widget.rs    — vault status in status bar
│       ├── agent_widget.rs    — agent activity indicator
│       ├── sync_widget.rs     — sync progress widget
│       ├── vault_action.rs    — unlock/lock vault from launcher
│       ├── agent_action.rs    — start/stop agent from launcher
│       └── sync_action.rs     — trigger sync from launcher
```

**What this replaces:** waybar + rofi + swaync + wlogout

**Integration model:**
```
niri (compositor)
  ├── gpui-shell (layer-shell status bar, launcher popup, control center popup)
  │     └── GPU-rendered via WGPU → Vulkan
  ├── CyberManju Tauri (regular Wayland window, Vue in WebKitGTK)
  └── Native apps
```

gpui-shell and CyberManju are **separate Wayland clients**. They communicate via:
- **D-Bus** (gpui-shell exposes vault/agent/sync state)
- **niri IPC** (window management: focus, move, workspace assignment)
- **Files** (shared state in `~/.config/cybermanju/`)

### 1B: GPUI plugin to render Vue (research + prototype)

This is the ambitious part. There are **four approaches**, ranked by feasibility:

#### Approach 1: GPUI WebView via Wry (experimental, XWayland only)

**Status:** Exists as `gpui-webview` (experimental). Uses Wry (same webview library as Tauri).

**Problem:** On Linux, Wry/WebKitGTK can only embed into X11 windows. GPUI's Wayland backend hands Wry a Wayland handle, which is rejected. The app must run on XWayland.

**Workaround:** Launch gpui-shell with `GDK_BACKEND=x11` or `UI_BACKEND=x11` to force XWayland. Works but adds a compatibility layer.

**Code sketch:**
```rust
// In gpui-shell, add a VuePanel entity
use gpui_webview::WebView;

struct VuePanel {
    webview: Entity<WebView>,
}

impl VuePanel {
    fn new(cx: &mut App) -> Self {
        let webview = cx.new(|cx| {
            WebView::build(wry::WebViewBuilder::new(), window, cx)
                .expect("Failed to create WebView")
        });
        webview.update(cx, |view, _| {
            view.load_url("http://localhost:7456/vault"); // local Vue dev server
        });
        Self { webview }
    }
}

impl Render for VuePanel {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div().flex_1().child(self.webview.clone())
    }
}
```

**Verdict:** Works but forces XWayland. Acceptable for prototype, not ideal for production.

#### Approach 2: GPUI Kit's gpui-shell JavaScript extension host (promising)

**Status:** GPUI Kit has a `gpui-shell` crate that "opens a Rust host to JavaScript extensions, one granted capability at a time."

This is the **most promising** approach for Vue integration:
- GPUI provides the GPU-accelerated rendering surface
- JavaScript extensions run inside GPUI's runtime
- Vue can be mounted inside a JS extension
- Capabilities are granted per-extension (filesystem, network, IPC)

**Architecture:**
```
gpui-shell (Rust host)
  ├── native bar (GPUI div → GPU)
  ├── native launcher (GPUI div → GPU)
  └── JS extension host
       ├── Vue runtime (mounted via capability)
       │   └── http://localhost:7456/vault → Vue app
       ├── D-Bus bridge (via capability)
       └── File system bridge (via capability)
```

**What to research:**
- [ ] GPUI Kit's `gpui-shell` crate API
- [ ] How to mount Vue inside the JS extension host
- [ ] Capability model: what can JS extensions access?
- [ ] Whether Vue's reactivity works inside the extension host

#### Approach 3: Vue compiled to WASM, rendered in GPUI via canvas (research)

**Status:** No existing implementation. Would require:
- Compile Vue to WASM (via `wasm-pack` or a custom Vue-WASM compiler)
- Render Vue's virtual DOM to a GPUI canvas element
- Bridge events between GPUI input and Vue's event system

**Verdict:** Too speculative. Would take months of research with no guarantee of success.

#### Approach 4: Hybrid — GPUI for shell chrome, Tauri for Vue app (pragmatic)

**Status:** This is what we have today. GPUI renders the bar/launcher/control center. Tauri renders the Vue app in a separate window.

**This is the recommended production approach.** The Vue app does not need to be inside GPUI. The shell chrome (bar, launcher, notifications) is native GPUI. The app is Tauri. They coexist on niris.

### Recommended Phase 1 implementation

| Sub-phase | Approach | Effort | Risk |
|---|---|---|---|
| 1A | Fork gpui-shell, add CyberManju widgets | 1-2 weeks | Low |
| 1B-1 | Prototype: gpui-webview with XWayland | 3-5 days | Medium |
| 1B-2 | Research: GPUI Kit JS extension host | 1 week | Medium |
| 1B-3 | Prototype: Vue inside JS extension host | 1-2 weeks | High |
| 1C | Production: gpui-shell (native) + Tauri (Vue) | 0 (already works) | None |

**Phase 1 deliverables:**
- [ ] gpui-shell fork with CyberManju vault/agent/sync widgets
- [ ] Prototype: Vue panel inside GPUI via webview (XWayland)
- [ ] Research report: GPUI Kit JS extension host feasibility
- [ ] Production: gpui-shell bar + Tauri app coexisting on niri

---

## Phase 2: WASM-as-Apps — Modular Processes

### Goal

Create a system where individual CyberManju features (vault, agent, sync, files) are compiled to standalone WASM modules that run as separate windows on the desktop AND as interactive elements on GitHub Pages.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  WASM Module SDK (Rust crate: cybermanju-wasm-sdk)       │
│                                                          │
│  #[cybermanju_wasm_app]                                  │
│  pub struct VaultApp {                                   │
│      // Declarative app definition                       │
│  }                                                       │
│                                                          │
│  impl CyberManjuApp for VaultApp {                       │
│      fn name() -> &'static str { "vault" }               │
│      fn version() -> &'static str { "0.1.0" }            │
│      fn render(&self, ctx: &AppContext) -> View { ... }  │
│      fn on_event(&self, event: AppEvent) { ... }         │
│  }                                                       │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│  WASM Module (per feature)                               │
│                                                          │
│  vault.wasm    — vault management                        │
│  sync.wasm     — sync dashboard                          │
│  agent.wasm    — agent chat                              │
│  files.wasm    — file manager                            │
│  crypto.wasm   — crypto utilities                        │
│  settings.wasm — system settings                        │
└──────────────────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Desktop OS  │  │  GitHub Pages │  │  Browser     │
│  (WASMtime)  │  │  (WASM in JS) │  │  (direct)    │
│              │  │               │  │              │
│  WASM app    │  │  WASM app     │  │  WASM app    │
│  = native    │  │  = interactive │  │  = embedded  │
│    window    │  │    web element │  │    in page   │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Module manifest

Each WASM module carries a manifest:

```json
{
  "name": "vault",
  "version": "0.1.0",
  "description": "CyberManju Vault Manager",
  "capabilities": ["vault:read", "vault:write", "crypto:derive"],
  "display": {
    "default_size": [800, 600],
    "min_size": [400, 300],
    "resizable": true
  },
  "api": {
    "input": "jsonl",
    "output": "jsonl"
  }
}
```

### Desktop runtime (WASMtime)

```rust
// cybermanju-wasm runtime (systemd service)
use wasmtime::{Engine, Store, Instance};

struct WasmAppRuntime {
    engine: Store<()>,
    apps: HashMap<String, WasmApp>,
}

impl WasmAppRuntime {
    fn spawn_app(&mut self, module: &[u8]) -> WasmApp {
        // Compile WASM module
        // Create WASMtime instance
        // Map JSONL stdin/stdout to Wayland window
        // Return window handle
    }
}
```

### Web runtime (GitHub Pages)

```javascript
// In browser, load the same WASM module
const vault = await CyberManjuWasm.load('vault.wasm');
vault.mount(document.getElementById('vault-panel'));
// Interactive, but constrained by browser sandbox
```

### JSONL protocol (universal wire format)

All WASM apps communicate via JSONL (JSON Lines):

```jsonl
{"type":"render","component":"vault-list","props":{"filter":"all"}}
{"type":"action","action":"unlock","params":{"vault-id":"personal"}}
{"type":"event","event":"vault-unlocked","data":{"vault-id":"personal","timestamp":1699999999}}
{"type":"state","state":{"vaults":[{"id":"personal","status":"unlocked","size":"2.3GB"}]}}
```

This same protocol works:
- **Desktop:** WASM stdin/stdout → JSONL → Wayland window content
- **Web:** `fetch()` / WebSocket → JSONL → DOM rendering
- **P2P:** iroh connection → JSONL → CRDT state sync

### Deliverables

- [ ] `cybermanju-wasm-sdk` crate (app definition macro, JSONL protocol, capability system)
- [ ] `vault.wasm` module (vault management)
- [ ] `sync.wasm` module (sync dashboard)
- [ ] `agent.wasm` module (agent chat)
- [ ] `cybermanju-wasm` systemd service (desktop runtime)
- [ ] GitHub Pages WASM loader (JavaScript SDK)

### Time estimate

**3-4 weeks** for SDK + 3 core modules.

---

## Phase 3: GitHub Pages Static API Endpoints

### Goal

Make GitHub Pages serve as the "online" endpoint for the same WASM modules and JSONL streams that run on the desktop.

### Architecture

```
GitHub Pages (cybermanju.github.io)
├── index.html              → Vue shell (existing)
├── dist-wasm/              → WASM modules (existing build)
│   ├── vault.wasm
│   ├── sync.wasm
│   ├── agent.wasm
│   └── ...
├── api/                    → Cloudflare Workers (WASM-compatible edge)
│   ├── vault-status        → JSONL stream (vault state from IPFS/CRDT)
│   ├── sync-stream         → JSONL stream (sync events)
│   ├── agent-prompt        → JSONL stream (agent responses)
│   └── p2p-signal          → WebRTC signaling (via Durable Objects)
└── .well-known/
    └── cybermanju          → P2P node advertisement (libp2p multiaddr)
```

### Cloudflare Workers as JSONL endpoints

Since GitHub Pages is static-only, we use **Cloudflare Workers** (which support WASM) as the compute layer:

```javascript
// Cloudflare Worker: vault-status
export default {
  async fetch(request) {
    // Fetch vault state from IPFS or CRDT store
    const state = await CRDTStore.get('vault-state');
    // Return as JSONL stream
    return new Response(state.toJSONL(), {
      headers: { 'Content-Type': 'application/x-ndjson' }
    });
  }
}
```

### P2P signaling via Durable Objects

```javascript
// Cloudflare Durable Object: P2P signaling
export class P2PSignaling {
  onMessage(ws, message) {
    // WebRTC offer/answer exchange
    // Device discovery via libp2p peer ID
  }
}
```

### Offline-first behavior

```javascript
// In the browser Vue app
if (navigator.onLine) {
  // Fetch from Cloudflare Worker (online mode)
  const vault = await fetch('https://api.cybermanju.dev/vault-status');
} else {
  // Load from local WASM + IPFS cache (offline mode)
  const vault = await CyberManjuWasm.load('vault.wasm');
  vault.setState(await IPFS.get('vault-state'));
}
```

### Deliverables

- [ ] Cloudflare Workers API (vault, sync, agent endpoints)
- [ ] P2P signaling Durable Object
- [ ] GitHub Pages WASM loader SDK
- [ ] IPFS/CRDT integration for offline-first state
- [ ] Offline-first Vue component (auto-fallback to local WASM)

### Time estimate

**2-3 weeks** for Workers API + P2P signaling + offline-first.

---

## Phase 4: Ubuntu Packaging — COSMIC from Source

### Goal

Rebuild COSMIC DE from source to work natively on Ubuntu 26.04, and optionally replace niri with `cosmic-comp` (or run COSMIC session on top of niri).

### 4A: COSMIC DE built from source for Ubuntu

COSMIC targets Pop!_OS. To run on Ubuntu:

```bash
# Clone COSMIC components
git clone https://github.com/pop-os/cosmic-comp.git
git clone https://github.com/pop-os/cosmic-session.git
git clone https://github.com/pop-os/cosmic-panel.git
git clone https://github.com/pop-os/cosmic-applets.git

# Build each (requires Rust + systemd-devel)
cargo build --release

# Install to /usr/local
# Create .desktop session file
# Create systemd user units
```

### 4B: COSMIC session on niri (community-proven)

The community has already built `cosmic-niri-session` — a session manager that starts COSMIC components under niri instead of `cosmic-comp`:

```bash
# start-cosmic-ext-niri (from cosmic-ext-extra-sessions)
export XDG_CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:=niri}"
export XDG_SESSION_TYPE="${XDG_SESSION_TYPE:=wayland}"
export XCURSOR_THEME="${XCURSOR_THEME:=Cosmic}"
export _JAVA_AWT_WM_NONREPARENTING=1
export GDK_BACKEND=wayland,x11
export MOZ_ENABLE_WAYLAND=1
exec /usr/bin/cosmic-session niri
```

### 4C: What breaks when removing cosmic-comp

| Feature | cosmic-comp | niri | Gap? |
|---|---|---|---|
| Window management | COSMIC tiling/floating | niri scrollable tiling | Different paradigm — both work |
| Animations | Built-in | Built-in | No gap |
| Workspaces | Dynamic | Dynamic | No gap |
| Notifications | cosmic-notifications (layer-shell) | Any notification daemon | No gap |
| Screen sharing | cosmic-comp portal | niri portal | No gap |
| COSMIC theming | Full | Partial (GTK) | Visual inconsistency |
| COSMIC settings integration | Deep | Generic | Some toggles may not map |

### 4D: Ubuntu source integration

For deep Ubuntu integration, download Ubuntu source packages:

```bash
# Get Ubuntu kernel source
apt source linux

# Get systemd source
apt source systemd

# Get Mesa source
apt source mesa

# Rebuild with custom patches
# (e.g., add CONFIG_RUST=y, enable low-latency preempt)
```

### Deliverables

- [ ] COSMIC DE built from source, running on Ubuntu 26.04
- [ ] COSMIC-on-niri session file (`/usr/share/wayland-sessions/cosmic-on-niri.desktop`)
- [ ] Ubuntu .deb packages for COSMIC components
- [ ] Source-built kernel with `CONFIG_RUST=y`
- [ ] Comparison report: niri vs cosmic-comp for CyberManju

### Time estimate

**3-4 weeks** for COSMIC build + Ubuntu packaging + source kernel.

---

## Phase 5: Low-Latency Kernel and Driver Detection

### Goal

Automatically detect hardware and select the optimal kernel + driver combination at install time.

### Detection logic

```
┌─────────────────────────────────────────────┐
│  Installer detects hardware                 │
│                                              │
│  lspci → GPU vendor?                        │
│    ├── NVIDIA → linux-nvidia-lowlatency     │
│    ├── AMD    → linux-lowlatency + amdgpu    │
│    └── Intel  → linux-lowlatency + i915/Xe   │
│                                              │
│  CPU?                                        │
│    ├── AMD   → enable_pcie_amd_nb           │
│    └── Intel → enable_pcie_mmcfg             │
│                                              │
│  RAM?                                        │
│    ├── < 8GB  → zram + swap on SSD          │
│    └── >= 8GB → standard swap               │
│                                              │
│  Storage?                                    │
│    ├── NVMe → noatime, discard, fstrim       │
│    └── SATA → noatime                       │
└─────────────────────────────────────────────┘
```

### Kernel options

| Kernel | Use case | Source |
|---|---|---|
| `linux-lowlatency` | General low-latency (AMD/Intel) | Ubuntu repos |
| `linux-nvidia-lowlatency` | NVIDIA GPUs | Ubuntu repos (6.8.0-1064.67.1) |
| `linux-lowlatency-hwe` | Hardware Enablement (newer) | Ubuntu repos |
| Custom-built | Maximum control, CONFIG_RUST=y | Source |

### Custom kernel build (optional, for Phase 7)

```bash
# Download Ubuntu kernel source
apt source linux

# Modify .config
echo "CONFIG_RUST=y" >> .config
echo "CONFIG_PREEMPT_DYNAMIC=y" >> .config

# Build
make -j$(nproc) deb-pkg

# Install
dpkg -i ../linux-image-*.deb
```

### Driver setup

**NVIDIA:**
```bash
# Option A: Ubuntu packaged (stable, slightly older)
apt install nvidia-driver-580

# Option B: NVIDIA repo (latest)
add-apt-repository ppa:graphics-drivers/ppa
apt install nvidia-driver-617

# Verify Wayland
nvidia-smi
echo $XDG_SESSION_TYPE  # should print "wayland"
```

**AMD:**
```bash
# Open-source amdgpu (recommended)
apt install mesa-vulkan-drivers libvulkan1

# ROCm (only if needed for compute)
apt install amdgpu-install
amdgpu-install --usecase=rocm
```

**Low-latency tuning:**
```bash
# CPU governor
echo 'performance' | tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# IRQ affinity
apt install irqbalance
systemctl enable irqbalance

# Real-time limits for audio
echo '@audio - rtprio 95' >> /etc/security/limits.conf
echo '@audio - memlock unlimited' >> /etc/security/limits.conf
```

### Deliverables

- [ ] Hardware detection script (installer component)
- [ ] Automatic kernel selection logic
- [ ] Driver installation automation
- [ ] Low-latency system tuning
- [ ] NVIDIA Wayland verification
- [ ] AMD amdgpu verification

### Time estimate

**1-2 weeks** for detection + automation + tuning.

---

## Phase 6: Decentralized P2P Sync

### Goal

Device-to-device encrypted sync without central servers, using the same WASM modules and JSONL protocol.

### Technology stack

| Component | Library | Status |
|---|---|---|
| P2P networking | `iroh` (Rust) | Production |
| CRDT | `automerge` (Rust/WASM) | Production |
| Transport | QUIC (via iroh) | Production |
| Signaling | Cloudflare Durable Objects | Build |
| NAT traversal | holepunch (iroh) | Production |
| WebRTC | `webrtc-rs` or browser WebRTC | Production |

### Architecture

```
┌──────────────┐         ┌──────────────┐
│  Device A    │         │  Device B    │
│  (Desktop)   │         │  (Laptop)    │
│              │         │              │
│  vault.wasm  │◄───────►│  vault.wasm  │
│  sync.wasm   │  iroh   │  sync.wasm   │
│  agent.wasm  │  QUIC   │  agent.wasm  │
│              │         │              │
│  CRDT state  │◄───────►│  CRDT state  │
└──────────────┘  sync   └──────────────┘
        │                       │
        └───────┬───────────────┘
                ▼
        ┌──────────────┐
        │  Cloudflare  │
        │  Signaling   │
        │  (Durable    │
        │   Objects)   │
        └──────────────┘
```

### JSONL over P2P

```rust
// Device A sends sync message
let message = SyncMessage {
    crdt_op: automerge::Op::Set {
        key: "vault/personal".into(),
        value: json!({"status": "unlocked"}),
    },
};
iroh.send(peer_id, message.to_jsonl()).await?;

// Device B receives and applies
let msg = iroh.recv().await?;
let op: automerge::Op = serde_json::from_str(&msg.to_jsonl())?;
doc.apply(op)?;
```

### Security model

| Layer | Mechanism |
|---|---|
| Transport | QUIC with TLS 1.3 |
| Authentication | ML-KEM-1024 key exchange |
| Encryption | ChaCha20Poly1305 per-message |
| Integrity | BLAKE3 hashes |
| Authorization | Per-vault access control lists |

### Deliverables

- [ ] `cybermanju-p2p` crate (iroh integration, CRDT sync)
- [ ] Device pairing UI (QR code + ML-KEM key exchange)
- [ ] Offline-first sync (queue and reconcile)
- [ ] WebRTC bridge for real-time collaboration
- [ ] Cloudflare Durable Object signaling server

### Time estimate

**4-6 weeks** for full P2P stack.

---

## Phase 7: Full OS Integration

### Goal

Combine all phases into a single bootable ISO with installer, first-boot experience, and all components integrated.

### 7A: Custom installer

```rust
// cybermanju-install (runs from initramfs/live USB)
fn main() {
    let hw = detect_hardware();
    let kernel = select_kernel(&hw);
    let layout = partition_disk(&hw);
    setup_luks2(&layout);
    install_bootloader(&layout);
    install_base_system(&kernel);
    install_cybermanju();
    configure_first_boot();
    reboot();
}
```

### 7B: First-boot experience

```
1. Boot from USB → initramfs
2. Welcome screen (language, keyboard)
3. Disk partitioning (guided + advanced)
4. Encryption setup (LUKS2 + ML-KEM)
5. User account creation
6. Driver installation (auto-detected)
7. Kernel selection (auto-detected)
8. System installation → reboot
9. First boot → niri + gpui-shell + CyberManju Tauri
10. WASM apps loaded from GitHub Pages
```

### 7C: Systemd integration

```ini
# /etc/systemd/system/cybermanju@.service
[Unit]
Description=CyberManju %i
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/cybermanju-%i
Restart=on-failure

[Install]
WantedBy=graphical-session.target
```

### 7D: Update system

```bash
# Custom apt repository
deb [trusted=yes] https://repo.cybermanju.dev/debian ./

# Update
apt update && apt upgrade
```

### Deliverables

- [ ] Custom installer binary
- [ ] First-boot wizard (Vue-based, running in initramfs)
- [ ] systemd service units
- [ ] Custom apt repository
- [ ] Full ISO build pipeline (CI)
- [ ] Hardware compatibility list

### Time estimate

**4-6 weeks** for installer + first-boot + integration.

---

## Technology Deep Dives

### Deep Dive 1: GPUI rendering pipeline

```
Declarative UI (div, text, lists)
    ↓
Taffy layout engine (flexbox/grid, subpixel precision)
    ↓
Scene (drawing primitives: quads, text runs, paths)
    ↓
WGPU renderer (cross-platform: Vulkan/Metal/DirectX)
    ↓
GPU
```

| Platform | Windowing | Renderer | WebView |
|---|---|---|---|
| macOS | Native Cocoa | Metal | WKWebView (overlays work) |
| Linux | Wayland or X11 | WGPU (Vulkan) | WebKitGTK (X11/XWayland only) |
| Windows | Win32 | DirectX | WebView2 (partial) |
| Web (WASM) | Canvas | WGPU/WebGL2 | N/A |

**Key limitation:** GPUI does not use native OS controls. Every widget is custom-rendered to GPU. This means:
- Full control over appearance
- Consistent cross-platform look
- No native theme integration
- Must implement everything (text inputs, buttons, dropdowns, scrollbars)

### Deep Dive 2: niri architecture

niri is a scrollable-tiling Wayland compositor written in Rust, built on smithay.

```
niri
├── Window management (scrollable tiling, dynamic workspaces)
├── Input handling (keyboard, mouse, touchpad, tablets)
├── Output management (multi-monitor, mixed DPI, fractional scaling)
├── XWayland (via xwayland-satellite)
├── Screencasting (xdg-desktop-portal-gne)
├── Animations (custom shaders, Oklab/Oklch gradients)
└── IPC (JSON-based, for external control)
```

**Why niri over other compositors:**
- Rust (memory-safe, matches CyberManju's stack)
- Stable for daily use
- Excellent NVIDIA support
- Integrated XWayland via xwayland-satellite
- Live-reloading config
- No dependencies on GNOME/KDE libraries

### Deep Dive 3: WASM module system

```
┌─────────────────────────────────────────────┐
│  WASM Module (per feature)                   │
│                                              │
│  +--------------------------------------+    │
│  | cybermanju_wasm_sdk! {              |    │
│  |   name: "vault",                    |    │
│  |   version: "0.1.0",                 |    │
│  |   capabilities: ["vault:read"],     |    │
│  |                                      |    │
│  |   fn render(&self) -> View {         |    │
│  |     VaultList::new()                |    │
│  |   }                                 |    │
│  | }                                   |    │
│  +--------------------------------------+    │
│                                              │
│  +--------------------------------------+    │
│  | WASM exports:                       |    │
│  |   init() — initialize module        |    │
│  |   render() → JSONL — get UI state   |    │
│  |   handle_event(JSONL) — process     |    │
│  |   get_state() → JSONL — get state   |    │
│  +--------------------------------------+    │
└─────────────────────────────────────────────┘
```

### Deep Dive 4: COSMIC vs niri comparison

| Feature | niri | COSMIC (cosmic-comp) |
|---|---|---|
| Language | Rust | Rust |
| Tiling | Scrollable columns | Traditional + floating |
| Workspaces | Dynamic, per-monitor | Dynamic, per-monitor |
| Animations | Custom shaders | Built-in |
| Notifications | Any daemon | cosmic-notifications (integrated) |
| Settings | Text config | COSMIC Settings (GUI) |
| Panel | Any (gpui-shell, waybar) | cosmic-panel (integrated) |
| Apps | Any | COSMIC apps (integrated) |
| XWayland | xwayland-satellite | Built-in |
| NVIDIA | Good | Good (newer) |
| Stability | Stable | 1.0 (Dec 2025) |
| Customization | Unlimited (IPC + config) | COSMIC ecosystem |

**Recommendation:** Use **niri** as the primary compositor. Optionally support COSMIC as an alternative session. The CyberManju shell (gpui-shell) works under both.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GPUI pre-1.0, breaking changes | High | Medium | Fork and pin version. Use Tauri for production Vue app. |
| GPUI WebView forces XWayland on Linux | Certain | Low | Accept XWayland for prototype. Production uses Tauri for Vue. |
| COSMIC build fails on Ubuntu | Medium | High | Use community PPA. Have niri-only fallback. |
| NVIDIA Wayland issues | Medium | High | Test extensively. Have X11 fallback. |
| WASM module complexity | Medium | Medium | Start with 2-3 simple modules. Expand gradually. |
| P2P sync correctness | Medium | High | Extensive testing. Use battle-tested CRDTs (Automerge). |
| Installer disk corruption | Low | Critical | Validate partitioning. Have recovery mode. |
| Scope creep | High | Medium | Strict phase boundaries. Ship alpha before adding features. |

---

## Timeline Summary

| Phase | Duration | Cumulative | Deliverable |
|---|---|---|---|
| Phase 0: Bootable ISO | 1 week | Week 1 | Bootable alpha |
| Phase 1A: gpui-shell fork | 2 weeks | Week 3 | GPU shell with CyberManju widgets |
| Phase 1B: Vue-in-GPUI prototype | 2 weeks | Week 5 | Research + prototype |
| Phase 2: WASM-as-apps | 3 weeks | Week 8 | Modular WASM modules |
| Phase 3: GitHub Pages API | 2 weeks | Week 10 | Online endpoints |
| Phase 4: COSMIC packaging | 3 weeks | Week 13 | COSMIC on Ubuntu |
| Phase 5: Kernel + drivers | 1 week | Week 14 | Auto-detect + tuning |
| Phase 6: P2P sync | 4 weeks | Week 18 | Decentralized sync |
| Phase 7: Full integration | 4 weeks | Week 22 | Daily-driver beta |
| **Total** | **22 weeks** | **~5 months** | **Full OS** |

### Milestones

| Milestone | Date | Criteria |
|---|---|---|
| **M1: Boots** | Week 1 | ISO boots, niri runs, CyberManju Tauri window appears |
| **M2: GPU Shell** | Week 3 | gpui-shell with CyberManju widgets on niri |
| **M3: WASM Apps** | Week 8 | vault.wasm, sync.wasm, agent.wasm as separate windows |
| **M4: Online** | Week 10 | GitHub Pages API returns JSONL streams |
| **M5: COSMIC** | Week 13 | COSMIC DE built from source, running on Ubuntu |
| **M6: Drivers** | Week 14 | Auto-detection + low-latency kernel working |
| **M7: P2P** | Week 18 | Device-to-device sync working |
| **M8: Beta** | Week 22 | Full ISO with installer, first-boot, all features |

---

## Appendix A: Repository Structure (Target)

```
cybermanju.github.io/
├── crates/
│   ├── agent/              (existing)
│   ├── os/                 (existing)
│   ├── os-wasm/            (existing)
│   ├── disk/               (existing)
│   ├── sync/               (existing)
│   ├── crypto/             (existing)
│   ├── compression/        (existing)
│   ├── search/             (existing)
│   ├── web/                (existing)
│   ├── types/              (existing)
│   ├── db/                 (existing)
│   ├── erasure/            (existing)
│   ├── faces/              (existing)
│   ├── scene/              (existing)
│   ├── tests/              (existing)
│   ├── gpui-shell/         (NEW: fork of gpui-shell + CyberManju integration)
│   ├── wasm-sdk/           (NEW: WASM module SDK)
│   ├── wasm-runtime/       (NEW: WASMtime desktop runtime)
│   ├── p2p/                (NEW: iroh P2P sync)
│   └── installer/          (NEW: custom OS installer)
├── src/                    (existing Vue frontend)
├── src-tauri/              (existing Tauri backend)
├── dist-wasm/              (existing WASM build)
├── docs/
│   ├── CYBERMANJU-OS-PLAN.md  (this file)
│   ├── GPUI-INTEGRATION.md    (GPUI integration guide)
│   ├── WASM-APPS.md           (WASM app development guide)
│   └── PACKAGING.md           (Ubuntu packaging guide)
├── iso/                    (NEW: ISO build scripts)
│   ├── build.sh
│   ├── preseed.cfg
│   └── systemd/
└── .github/
    └── workflows/
        └── iso-build.yml   (NEW: ISO CI pipeline)
```

## Appendix B: Key Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| niri | latest (26.04+) | Wayland compositor |
| gpui | pre-1.0 (pin) | GPU UI framework |
| gpui-shell | fork | Desktop shell |
| gpui-webview | experimental | Vue in GPUI (XWayland) |
| WASMtime | latest | WASM runtime on desktop |
| iroh | latest | P2P networking |
| automerge | latest | CRDT sync |
| systemd-boot | latest | Bootloader |
| dracut | latest | initramfs |
| Mesa | latest | Vulkan/OpenGL |
| NVIDIA driver | 617.42 (or 580 Ubuntu) | GPU driver |
| AMD amdgpu | kernel | GPU driver |

## Appendix C: Community Projects Referenced

| Project | URL | Role |
|---|---|---|
| niri | github.com/niri-wm/niri | Compositor |
| gpui-shell | github.com/andre-brandao/gpui-shell | Shell base |
| gpui-kit | gpui-kit.com | Component library |
| gpui-ce | github.com/gpui-ce/gpui-ce | GPUI community fork |
| gpui-standalone | github.com/gpui-standalone/gpui | GPUI standalone |
| cosmic-niri-session | github.com/dandenkijin/cosmic-niri-session | COSMIC on niri |
| cosmic-ext-extra-sessions | github.com/Drakulix/cosmic-ext-extra-sessions | COSMIC session extensions |
| gpui-webview | github.com/longbridge/gpui-kit/crates/webview | Vue in GPUI |
| COSMIC DE | github.com/pop-os/cosmic-comp | Alternative DE |
| iroh | github.com/n0-computer/iroh | P2P |
| automerge | github.com/automerge/automerge | CRDT |

---

*Plan created: 2026-10-18. Last verified against upstream: 2026-10-18.*
