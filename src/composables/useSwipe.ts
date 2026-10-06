import { onMounted, onUnmounted, type Ref } from 'vue'
import { swipeDirection, classifyTwoFingerGesture } from '@/utils/shellLayout'

export type SwipeDirection = 'left' | 'right' | 'up' | 'down'
export type TapType = 'single' | 'double'
export type EdgeZone = 'top' | 'bottom' | 'left' | 'right' | 'none'

export interface PinchEvent {
  scale: number
  initialDistance: number
  currentDistance: number
}

export interface LongPressEvent {
  x: number
  y: number
  duration: number
}

export interface EdgeSwipeEvent {
  direction: SwipeDirection
  edge: EdgeZone
  distance: number
}

export interface SwipeOptions {
  threshold?: number
  longPressThreshold?: number
  edgeZoneSize?: number
  doubleTapTimeout?: number

  onSwipe?: (direction: SwipeDirection) => void
  onTwoFingerSwipe?: (direction: SwipeDirection) => void
  onThreeFingerSwipe?: (direction: SwipeDirection) => void
  onFourFingerSwipe?: (direction: SwipeDirection) => void
  onPinchStart?: (e: PinchEvent) => void
  onPinchMove?: (e: PinchEvent) => void
  onPinchEnd?: (e: PinchEvent) => void
  onTap?: (type: TapType, x: number, y: number) => void
  onLongPress?: (e: LongPressEvent) => void
  onEdgeSwipe?: (e: EdgeSwipeEvent) => void
}

function distance(t1: Touch, t2: Touch): number {
  const dx = t1.clientX - t2.clientX
  const dy = t1.clientY - t2.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function getEdge(x: number, y: number, w: number, h: number, zoneSize: number): EdgeZone {
  if (x <= zoneSize) return 'left'
  if (x >= w - zoneSize) return 'right'
  if (y <= zoneSize) return 'top'
  if (y >= h - zoneSize) return 'bottom'
  return 'none'
}

export function useSwipe(
  elementRef: Ref<HTMLElement | null>,
  options: SwipeOptions = {}
) {
  const threshold = options.threshold ?? 50
  const longPressThreshold = options.longPressThreshold ?? 600
  const edgeZoneSize = options.edgeZoneSize ?? 30
  const doubleTapTimeout = options.doubleTapTimeout ?? 300

  let startX = 0
  let startY = 0
  let startTime = 0
  let tracking = false
  let pinching = false
  let pinchFired = false
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let initialPinchDist = 0
  let lastPinchDist = 0
  /** Finger positions at gesture start (id → point), for centroid math. */
  let startPts: { id: number; x: number; y: number }[] = []
  let lastTapTime = 0
  let lastTapX = 0
  let lastTapY = 0
  let touchCountAtStart = 0
  let edgeAtStart: EdgeZone = 'none'

  /** Two-finger spread change (px) that counts as a pinch, not a swipe. */
  const PINCH_DEADZONE = 20

  function handleTouchStart(e: TouchEvent) {
    const touch = e.touches[0]
    startX = touch.clientX
    startY = touch.clientY
    startTime = Date.now()
    touchCountAtStart = e.touches.length
    startPts = Array.from(e.touches).map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }))

    const el = elementRef.value
    if (el) {
      edgeAtStart = getEdge(startX, startY, el.clientWidth, el.clientHeight, edgeZoneSize)
    }

    if (e.touches.length === 1) {
      tracking = true
      pinching = false
      pinchFired = false
      longPressTimer = setTimeout(() => {
        if (tracking && touchCountAtStart === 1) {
          options.onLongPress?.({ x: startX, y: startY, duration: longPressThreshold })
        }
      }, longPressThreshold)
    } else if (e.touches.length === 2) {
      // Two fingers: EITHER a parallel swipe (centroid travels, spread
      // constant) OR a pinch (spread changes). Decide on move/end via the
      // shared classifier — never assume pinch up front (that swallowed
      // every two-finger swipe before).
      tracking = true
      pinching = false
      pinchFired = false
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
      initialPinchDist = distance(e.touches[0], e.touches[1])
      lastPinchDist = initialPinchDist
    } else {
      tracking = true
      pinching = false
      pinchFired = false
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (tracking && !pinchFired && startPts.length === 2 && e.touches.length === 2) {
      const currentDist = distance(e.touches[0], e.touches[1])
      lastPinchDist = currentDist
      if (Math.abs(currentDist - initialPinchDist) > PINCH_DEADZONE) {
        // Spread is changing: this is a pinch, not a swipe.
        pinching = true
        pinchFired = true
        tracking = false
        options.onPinchStart?.({ scale: 1, initialDistance: initialPinchDist, currentDistance: initialPinchDist })
        options.onPinchMove?.({ scale: currentDist / initialPinchDist, initialDistance: initialPinchDist, currentDistance: currentDist })
        return
      }
      return
    }
    if (pinchFired && e.touches.length === 2) {
      const currentDist = distance(e.touches[0], e.touches[1])
      lastPinchDist = currentDist
      options.onPinchMove?.({ scale: currentDist / initialPinchDist, initialDistance: initialPinchDist, currentDistance: currentDist })
      return
    }
    if (tracking && longPressTimer) {
      const touch = e.touches[0]
      const dx = Math.abs(touch.clientX - startX)
      const dy = Math.abs(touch.clientY - startY)
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }

    if (pinchFired) {
      // Pinch ends when the second finger lifts; guard so the follow-up
      // single-finger touchend does not double-report.
      if (e.touches.length < 2) {
        pinchFired = false
        pinching = false
        tracking = false
        options.onPinchEnd?.({ scale: lastPinchDist / initialPinchDist, initialDistance: initialPinchDist, currentDistance: lastPinchDist })
      }
      return
    }

    if (!tracking || e.changedTouches.length === 0) { tracking = false; return }
    tracking = false

    const touchCount = touchCountAtStart
    const elapsed = Date.now() - startTime

    // Centroid displacement of the lifted fingers vs their start points.
    let dx = 0
    let dy = 0
    let matched = 0
    for (const t of Array.from(e.changedTouches)) {
      const s = startPts.find((p) => p.id === t.identifier)
      const bx = s ? s.x : startX
      const by = s ? s.y : startY
      dx += t.clientX - bx
      dy += t.clientY - by
      matched++
    }
    if (matched > 0) { dx /= matched; dy /= matched }
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)

    // Taps are single-finger only — multi-finger taps are ignored.
    if (touchCount === 1 && absDx < 10 && absDy < 10 && elapsed < 300) {
      const now = Date.now()
      if (now - lastTapTime < doubleTapTimeout && Math.abs(e.changedTouches[0].clientX - lastTapX) < 30 && Math.abs(e.changedTouches[0].clientY - lastTapY) < 30) {
        options.onTap?.('double', e.changedTouches[0].clientX, e.changedTouches[0].clientY)
        lastTapTime = 0
      } else {
        options.onTap?.('single', e.changedTouches[0].clientX, e.changedTouches[0].clientY)
        lastTapTime = now
        lastTapX = e.changedTouches[0].clientX
        lastTapY = e.changedTouches[0].clientY
      }
      return
    }

    if (touchCount === 2) {
      const cls = classifyTwoFingerGesture({
        startDist: initialPinchDist,
        endDist: lastPinchDist,
        dx,
        dy,
        swipeThreshold: threshold,
      })
      if (cls === 'pinch') {
        options.onPinchEnd?.({ scale: lastPinchDist / initialPinchDist, initialDistance: initialPinchDist, currentDistance: lastPinchDist })
        return
      }
      if (cls === 'tap' || cls === 'none') return
      const direction = cls.replace('swipe-', '') as SwipeDirection
      if (edgeAtStart !== 'none') {
        options.onEdgeSwipe?.({ direction, edge: edgeAtStart, distance: Math.max(absDx, absDy) })
      }
      options.onTwoFingerSwipe?.(direction)
      return
    }

    if (Math.max(absDx, absDy) < threshold) return

    const direction = swipeDirection(dx, dy)

    if (edgeAtStart !== 'none') {
      options.onEdgeSwipe?.({ direction, edge: edgeAtStart, distance: Math.max(absDx, absDy) })
    }

    switch (touchCount) {
      case 4: options.onFourFingerSwipe?.(direction); break
      case 3: options.onThreeFingerSwipe?.(direction); break
      default: options.onSwipe?.(direction); break
    }
  }

  function handleTouchCancel() {
    tracking = false
    pinching = false
    pinchFired = false
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
  }

  onMounted(() => {
    const el = elementRef.value
    if (el) {
      el.addEventListener('touchstart', handleTouchStart, { passive: true })
      el.addEventListener('touchmove', handleTouchMove, { passive: true })
      el.addEventListener('touchend', handleTouchEnd, { passive: true })
      el.addEventListener('touchcancel', handleTouchCancel)
    }
  })

  onUnmounted(() => {
    const el = elementRef.value
    if (el) {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', handleTouchCancel)
    }
    if (longPressTimer) clearTimeout(longPressTimer)
  })
}
