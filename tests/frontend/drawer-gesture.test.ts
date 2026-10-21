// CyberManju OS — Drawer gesture tests (tests/frontend/drawer-gesture.test.ts).
// Role: guard finger-following motion, intentional flicks and scroll-safe cancellation.
// Exports: Vitest regression suite.
// Integrates: drawerGesture policy and mobile drawer/launcher bindings.
// Contracts: no native runtime; invalid samples and sideways gestures never commit.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { drawerGestureProgress, shouldCommitDrawerGesture } from '@/utils/drawerGesture'

const drawer = readFileSync('src/components/AppDrawer.vue', 'utf8')
const launcher = readFileSync('src/components/MobileLauncher.vue', 'utf8')

describe('drawer gesture policy', () => {
  it('maps distance to bounded sheet progress without overshoot', () => {
    expect(drawerGestureProgress(100, 800)).toBe(0.125)
    expect(drawerGestureProgress(-20, 800)).toBe(0)
    expect(drawerGestureProgress(900, 800)).toBe(1)
  })
  it.each([NaN, Infinity, -Infinity])('rejects invalid samples %s', sample => {
    expect(drawerGestureProgress(sample)).toBe(0)
    expect(drawerGestureProgress(10, sample)).toBe(0)
    expect(shouldCommitDrawerGesture(sample, 0, 100)).toBe(false)
    expect(shouldCommitDrawerGesture(100, sample, 100)).toBe(false)
    expect(shouldCommitDrawerGesture(100, 0, sample)).toBe(false)
  })
  it('rejects missing or nonpositive sheet extent', () => {
    expect(drawerGestureProgress(10, 0)).toBe(0)
    expect(drawerGestureProgress(10, -1)).toBe(0)
  })
  it('commits deliberate long drags in either open/close direction', () => {
    expect(shouldCommitDrawerGesture(96, 0, 600)).toBe(true)
    expect(shouldCommitDrawerGesture(240, 20, 1000)).toBe(true)
  })
  it('allows a short quick flick, not a tap or slow partial pull', () => {
    expect(shouldCommitDrawerGesture(60, 5, 80)).toBe(true)
    expect(shouldCommitDrawerGesture(39, 0, 20)).toBe(false)
    expect(shouldCommitDrawerGesture(60, 0, 500)).toBe(false)
    expect(shouldCommitDrawerGesture(60, 0, 0)).toBe(false)
  })
  it('rejects reverse travel, horizontal movement and diagonal flicks', () => {
    expect(shouldCommitDrawerGesture(-200, 0, 100)).toBe(false)
    expect(shouldCommitDrawerGesture(200, 60, 100)).toBe(false)
    expect(shouldCommitDrawerGesture(40, 45, 50)).toBe(false)
    expect(shouldCommitDrawerGesture(40, -45, 50)).toBe(false)
  })
})

describe('drawer motion integration', () => {
  it('tracks downward drags live and suppresses the release click', () => {
    expect(drawer).toContain('@touchmove="onSheetTouchMove"')
    expect(drawer).toContain('sheetOffset.value = Math.max(0, distance)')
    expect(drawer).toContain('@click.capture="onDrawerClickCapture"')
    expect(drawer).toContain('if (e.cancelable) e.preventDefault()')
    expect(drawer).toContain('onPressEnd()')
  })
  it('keeps canceled previews mounted until the sheet has settled', () => {
    expect(drawer).toContain('|| previewSettling')
    expect(drawer).toContain('previewSettling.value = true')
    expect(drawer).toContain('if (previewTimer) clearTimeout(previewTimer)')
    expect(drawer).toContain('if (leaveFrame) cancelAnimationFrame(leaveFrame)')
    expect(drawer).toContain('@before-leave="prepareDrawerLeave"')
    expect(drawer).toContain("veil.classList.remove('is-dragging')")
    expect(drawer).toContain("sheet.style.transform = 'translate3d(0, 100%, 0)'")
    expect(drawer).toContain(':duration="motion.duration(380)"')
    expect(drawer).toContain('.is-dragging .app-drawer { will-change: transform; transition: none; }')
  })
  it('coalesces home preview updates and cancels pending frames on exit', () => {
    expect(launcher).toContain('queueDrawerProgress(drawerGestureProgress(')
    expect(launcher).toContain('if (drawerFrame) cancelAnimationFrame(drawerFrame)')
    expect(launcher).toContain('onUnmounted(resetDrawerGesture)')
    expect(launcher).toContain('@touchmove="onTouchMove"')
    expect(launcher).toContain('shouldCommitDrawerGesture(vertical, horizontal, Date.now() - drawerStartTime)')
  })
})
