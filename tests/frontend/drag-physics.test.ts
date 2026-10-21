// CyberManju OS — Drag physics tests (tests/frontend/drag-physics.test.ts).
// Role: Verify bounded inertial motion, gravity, cancellation and accessible release behavior.
// Exports: Vitest suites.
// Integrates: dragPhysics and home geometry.
// Contracts: Released surfaces cannot escape their component bounds or retain cancelled frames.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDragMomentum, stepDragPhysics } from '@/utils/dragPhysics'
const base = { left: 50, top: 50, width: 50, height: 50 }
const bounds = { left: 0, top: 0, width: 300, height: 400 }
afterEach(() => vi.unstubAllGlobals())
describe('bounded drag physics', () => {
  it('carries horizontal momentum, damps speed and accelerates downward', () => {
    const frame = stepDragPhysics({ position: { x: 0, y: 0 }, velocity: { x: 600, y: 0 } }, base, bounds, 1 / 60)
    expect(frame.position.x).toBeGreaterThan(0)
    expect(frame.velocity.x).toBeLessThan(600)
    expect(frame.velocity.y).toBeGreaterThan(0)
  })
  it('clips every frame to real component bounds, bounces, and settles on the floor', () => {
    let body = { position: { x: 195, y: 295 }, velocity: { x: 2000, y: 2000 } }
    body = stepDragPhysics(body, base, bounds, 1 / 60)
    expect(body.position).toEqual({ x: 200, y: 300 })
    expect(body.velocity.x).toBeLessThan(0)
    expect(body.velocity.y).toBeLessThan(0)
    for (let i = 0; i < 600; i++) {
      body = stepDragPhysics(body, base, bounds, 1 / 60)
      expect(body.position.x).toBeGreaterThanOrEqual(-50)
      expect(body.position.y).toBeLessThanOrEqual(300)
    }
    expect(body.position.y).toBe(300)
    expect(Math.hypot(body.velocity.x, body.velocity.y)).toBeLessThan(1)
  })
  it('bounds large elapsed frames and oversized surfaces', () => {
    const body = { position: { x: 0, y: 0 }, velocity: { x: 10, y: 10 } }
    expect(stepDragPhysics(body, base, bounds, 100)).toEqual(stepDragPhysics(body, base, bounds, 1 / 30))
    expect(stepDragPhysics(body, { ...base, width: 900, height: 900 }, bounds, 1 / 60).position).toEqual({ x: -50, y: -50 })
  })
  it('honors reduced motion without scheduling or flinging', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const raf = vi.fn(); vi.stubGlobal('requestAnimationFrame', raf)
    const update = vi.fn(); const complete = vi.fn()
    const motion = createDragMomentum()
    motion.sample({ x: 0, y: 0 }, 0); motion.sample({ x: 100, y: 100 }, 16)
    motion.release({ position: { x: 10, y: 20 }, base, bounds, update, complete })
    expect(update).toHaveBeenCalledWith({ x: 10, y: 20 })
    expect(complete).toHaveBeenCalledOnce()
    expect(raf).not.toHaveBeenCalled()
  })
  it('animates on frames, completes once, and cancels without committing', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    let callback: FrameRequestCallback = () => {}
    vi.stubGlobal('requestAnimationFrame', vi.fn((fn: FrameRequestCallback) => { callback = fn; return 1 }))
    const cancel = vi.fn(); vi.stubGlobal('cancelAnimationFrame', cancel)
    const motion = createDragMomentum(); const update = vi.fn(); const complete = vi.fn()
    motion.release({ position: { x: 0, y: 0 }, base, bounds, update, complete })
    callback(performance.now() + 16)
    expect(update).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
    motion.stop()
    expect(cancel).toHaveBeenCalledWith(1)
    expect(complete).not.toHaveBeenCalled()
    motion.release({ position: { x: 0, y: 300 }, base, bounds, update, complete })
    const start = performance.now()
    for (let i = 1; i < 20 && !complete.mock.calls.length; i++) callback(start + i * 16)
    expect(complete).toHaveBeenCalledOnce()
  })
})
