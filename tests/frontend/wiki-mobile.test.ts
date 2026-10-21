// CyberManju OS — Wiki mobile regression tests (tests/frontend/wiki-mobile.test.ts).
// Role: guard usable navigation, reader containment and canvas gesture sizing.
// Exports: none.
// Integrates: wiki-src HTML, styles and Three.js entry point; Vitest.
// Contracts: static wiki keeps 2D/3D switching reachable without desktop sidebars.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync('wiki-src/index.html', 'utf8')
const css = readFileSync('wiki-src/style.css', 'utf8')
const main = readFileSync('wiki-src/main.ts', 'utf8')

describe('mobile wiki shell', () => {
  it('keeps a named view switch, search and reader toggle available', () => {
    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('aria-label="Search modules and symbols"')
    expect(html).toContain('aria-controls="panel" aria-expanded="false"')
    expect(css).toContain('.toplinks { display: flex;')
    expect(css).not.toMatch(/\.toplinks\s*\{\s*display:\s*none/)
    expect(main).toContain("readerToggle.setAttribute('aria-expanded', String(open))")
    expect(main).toContain('panel.inert = mobile.matches && !open')
  })

  it('reserves real space for the scene, independently scrollable docs and safe areas', () => {
    expect(css).toContain('height: 100dvh')
    expect(css).toContain('env(safe-area-inset-bottom')
    expect(css).toContain('.reader-open .panel { display: block; }')
    expect(css).toContain('.panel { overflow-wrap: anywhere; overscroll-behavior: contain; }')
    expect(css).toContain('(orientation: landscape)')
    expect(css).toMatch(/#reader-toggle\s*\{[^}]*min-height:\s*44px/)
    expect(css).toContain('#scene canvas { touch-action: none; }')
  })

  it('sizes and picks against the actual canvas instead of the whole phone viewport', () => {
    expect(main).toContain('mount.clientWidth')
    expect(main).toContain('mount.clientHeight')
    expect(main).toContain('sceneObserver.observe(mount)')
    expect(main).toContain('camera.aspect = width / height')
    expect(main).toContain('((ev.clientX - rect.left) / rect.width) * 2 - 1')
    expect(main).toContain('((ev.clientY - rect.top) / rect.height) * 2 + 1')
    expect(main).not.toContain('ev.clientX / window.innerWidth')
  })

  it('does not navigate when a pinch, cancelled pointer or out-and-back drag ends', () => {
    expect(main).toContain('activePointers.add(ev.pointerId)')
    expect(main).toContain('activePointers.delete(ev.pointerId)')
    expect(main).toContain('if (!downAt || activePointers.size || gestureMoved)')
    expect(main).toContain("addEventListener('pointercancel'")
    expect(main).toContain('> 6) gestureMoved = true')
    expect(main).toContain("if (ev.pointerType === 'touch') return")
  })

  it('keeps actual documentation and module navigation usable without WebGL', () => {
    expect(main).toContain("document.body.classList.add('no-webgl')")
    expect(main).toContain("window.addEventListener('hashchange', showFallback)")
    expect(main).toContain("search.addEventListener('input', showFallback)")
    expect(main).toContain('Read full documentation')
    expect(css).toContain('.no-webgl .panel { left: max(8px, env(safe-area-inset-left, 0px)); top: var(--wiki-scene-top); height: auto; }')
  })

  it('leaves a visible way out of the 2D iframe', () => {
    expect(css).toContain('inset: var(--wiki-header-bottom, 68px) 0 0')
    expect(main).toContain("document.body.classList.toggle('view-2d', on)")
    expect(main).toContain("toggle2d.textContent = on ? '3D view' : '2D graph'")
    expect(css).toMatch(/\.top\s*\{[^}]*z-index:\s*50/s)
  })
})
