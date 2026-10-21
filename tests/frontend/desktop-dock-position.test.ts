// CyberManju OS — desktop dock position tests (tests/frontend/desktop-dock-position.test.ts).
// Role: Verify persistent desktop dock move/reset/accessibility contracts.
// Exports: Vitest test suite.
// Integrates: node:fs, vitest, @vue/compiler-sfc.
// Contracts: desktop-only dock behavior; mobile launcher remains owned elsewhere.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileStyle, parse } from '@vue/compiler-sfc'

const dock = fs.readFileSync('src/components/Dock.vue', 'utf8')
const shortcutDock = fs.readFileSync('src/components/ShellShortcutDock.vue', 'utf8')

describe('desktop dock positioning', () => {
  it('keeps app clicks intact and bounds the dock, controls, and hit area to the component', () => {
    expect(dock).toContain('@pointerdown.stop="startDockDrag"')
    expect(dock).toContain('aria-label="Move dock"')
    expect(dock).toContain('aria-label="Reset dock position"')
    expect(dock).toContain('@click.stop="resetDockPosition"')
    expect(dock).toContain('function resetDockPosition()')
    expect(dock).toContain("e.key === 'Home'")
    expect(dock).toContain("'cybermanju_desktop_dock_position_v1'")
    expect(dock).toContain('window.addEventListener(\'pointermove\', moveDock)')
    expect(dock).toContain('const parent = container?.parentElement')
    expect(dock).toContain('if (!e.isPrimary || e.button !== 0) return')
    expect(dock).toContain('e.preventDefault()')
    expect(dock).toContain('target.setPointerCapture(e.pointerId)')
    expect(dock).toContain('window.addEventListener(\'pointercancel\', onDockPointerCancel)')
    expect(dock).toContain('window.addEventListener(\'blur\', cancelDockDrag)')
    expect(dock).toContain('dockPosition.value = { x: origin.dockX, y: origin.dockY }')
    expect(dock).toContain('const dockMomentum = createDragMomentum()')
    expect(dock).toContain('dockMomentum.sample(delta)')
    expect(dock).toContain('dockMomentum.release({')
    expect(dock).toContain('dockMomentum.stop()')
    expect(dock).toContain('if (!origin.moved)')
    expect(dock).toContain("if (e.key === 'Escape')")
    expect(dock).toContain('const rects = [container.getBoundingClientRect(), dockControlsEl.value?.getBoundingClientRect()]')
    expect(dock).toContain('bounds: { left: parentRect.left, top: parentRect.top, width: parentRect.width, height: parentRect.height }')
    expect(dock).toContain('x: Math.max(minX, Math.min(minX + Math.max(0, bounds.width - base.width), point.x))')
    expect(dock).toContain('y: Math.max(minY, Math.min(minY + Math.max(0, bounds.height - base.height), point.y))')
    expect(dock).toContain('if (dragOrigin) finishDockDrag(false)')
    expect(dock).toContain('width: max-content;')
    expect(dock).toContain('pointer-events: none;')
    expect(dock).toContain('pointer-events: auto;')
    expect(dock).toContain('.dock-container.layout-full {')
    expect(dock).toContain('onControls || inBottomStrip')
    expect(dock).toContain('@mouseenter="onDockEnter" @mouseleave="onDockLeave"')
    expect(dock).toContain('@click="handleDockClick(app.panelType)"')
    expect(dock).toContain('@click="handleOpenWindowClick(win.id)"')
  })

  it('makes the shortcut dock primary-pointer draggable with bounded widget hit areas and cancellable momentum', () => {
    expect(shortcutDock).toContain('@pointerdown.stop="startDockDrag"')
    expect(shortcutDock).toContain('aria-label="Move shortcut dock"')
    expect(shortcutDock).toContain('aria-label="Reset shortcut dock position"')
    expect(shortcutDock).toContain("'cybermanju_shell_shortcut_dock_position_v1'")
    expect(shortcutDock).toContain('window.addEventListener(\'pointermove\', moveDock)')
    expect(shortcutDock).toContain('if (!e.isPrimary || e.button !== 0) return')
    expect(shortcutDock).toContain('e.preventDefault()')
    expect(shortcutDock).toContain('target.setPointerCapture(e.pointerId)')
    expect(shortcutDock).toContain('window.addEventListener(\'pointercancel\', onDockPointerCancel)')
    expect(shortcutDock).toContain('window.addEventListener(\'blur\', cancelDockDrag)')
    expect(shortcutDock).toContain('dockPosition.value = origin.previousPosition')
    expect(shortcutDock).toContain('const dockMomentum = createDragMomentum()')
    expect(shortcutDock).toContain('dockMomentum.sample(delta)')
    expect(shortcutDock).toContain('dockMomentum.release({')
    expect(shortcutDock).toContain('dockMomentum.stop()')
    expect(shortcutDock).toContain('if (!origin.moved)')
    expect(shortcutDock).toContain("if (e.key === 'Escape')")
    expect(shortcutDock).toContain('base: { left: 0, top: 0, width: rect.width, height: rect.height }')
    expect(shortcutDock).toContain('bounds: { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }')
    expect(shortcutDock).toContain('Math.min(Math.max(0, window.innerWidth - width)')
    expect(shortcutDock).toContain('Math.min(Math.max(0, window.innerHeight - height)')
    expect(shortcutDock).toContain('if (dragOrigin) finishDockDrag(false)')
    expect(shortcutDock).toMatch(/watch\(expanded, async \(\) => \{\s*if \(dragOrigin\) finishDockDrag\(false\)\s*await nextTick\(\)\s*clampDockPosition\(\)/)
    expect(shortcutDock).toContain('touch-action: none;')
    expect(shortcutDock).toContain('bottom: 12px;')
  })

  it('keeps both Vue SFCs and their scoped styles compilable', () => {
    for (const [name, source] of [['Dock.vue', dock], ['ShellShortcutDock.vue', shortcutDock]] as const) {
      const { descriptor, errors } = parse(source, { filename: name })
      expect(errors, `${name} parse errors`).toEqual([])
      for (const [index, style] of descriptor.styles.entries()) {
        const result = compileStyle({ source: style.content, filename: name, id: `dock-position-${index}`, scoped: style.scoped })
        expect(result.errors, `${name} style ${index} compile errors`).toEqual([])
      }
    }
  })
})
