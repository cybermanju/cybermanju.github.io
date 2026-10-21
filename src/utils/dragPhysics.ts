// CyberManju OS — Drag physics (src/utils/dragPhysics.ts).
// Role: Animate released surfaces inside measured bounds with momentum, gravity and soft collisions.
// Exports: stepDragPhysics, createDragMomentum.
// Integrates: home layout and desktop docks, requestAnimationFrame and reduced-motion preferences.
// Contracts: Screen-space pixels/seconds; finite bounded frames; stop never commits a cancelled move.
import { clampHomeOffset, type HomeOffset, type HomeRect } from '@/utils/homeLayout'

export interface DragBody { position: HomeOffset; velocity: HomeOffset }
export function stepDragPhysics(body: DragBody, base: HomeRect, bounds: HomeRect, seconds: number, gravity = 1100): DragBody {
  const dt = Math.max(0, Math.min(1 / 30, seconds))
  const damping = Math.exp(-3.8 * dt)
  const velocity = { x: body.velocity.x * damping, y: (body.velocity.y + gravity * dt) * damping }
  const proposed = { x: body.position.x + velocity.x * dt, y: body.position.y + velocity.y * dt }
  const position = clampHomeOffset(proposed, base, bounds)
  if (position.x !== proposed.x) velocity.x = Math.abs(velocity.x) > 35 ? -velocity.x * 0.25 : 0
  if (position.y !== proposed.y) velocity.y = Math.abs(velocity.y) > 65 ? -velocity.y * 0.22 : 0
  return { position, velocity }
}

export function createDragMomentum() {
  let frame: number | null = null
  let last: { point: HomeOffset; time: number } | null = null
  let velocity: HomeOffset = { x: 0, y: 0 }
  function stop() {
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    frame = null
    last = null
    velocity = { x: 0, y: 0 }
  }
  function sample(point: HomeOffset, time = performance.now()) {
    if (last) {
      const dt = (time - last.time) / 1000
      if (dt > 0 && dt < 0.12) {
        const limit = (v: number) => Math.max(-2200, Math.min(2200, v))
        velocity = { x: limit((point.x - last.point.x) / dt), y: limit((point.y - last.point.y) / dt) }
      } else velocity = { x: 0, y: 0 }
    }
    last = { point: { ...point }, time }
  }
  function release(options: { position: HomeOffset; base: HomeRect; bounds: HomeRect; update: (point: HomeOffset) => void; complete: () => void; gravity?: number }) {
    if (frame !== null) stop()
    const now = performance.now()
    let body: DragBody = { position: { ...options.position }, velocity: last && now - last.time < 120 ? { ...velocity } : { x: 0, y: 0 } }
    last = null
    if (typeof requestAnimationFrame !== 'function' || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      options.update(clampHomeOffset(body.position, options.base, options.bounds))
      options.complete()
      return
    }
    let previous = now
    let resting = 0
    const tick = (time: number) => {
      const dt = Math.max(0, Math.min(1 / 30, (time - previous) / 1000))
      previous = time
      body = stepDragPhysics(body, options.base, options.bounds, dt, options.gravity)
      options.update(body.position)
      resting = Math.hypot(body.velocity.x, body.velocity.y) < 3 ? resting + dt : 0
      // A deadline also bounds zero-gravity or externally throttled animations.
      if (resting > 0.08 || time - now > 4500) {
        frame = null
        velocity = { x: 0, y: 0 }
        options.complete()
      } else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }
  return { sample, release, stop }
}
