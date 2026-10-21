// CyberManju OS — Search viewport fitting (src/composables/useSearchViewport.ts).
// Role: Fill the visible mobile space below search without extending behind a software keyboard.
// Exports: searchResultsHeight, useSearchViewport.
// Integrates: OmniSearchPanel, VisualViewport and ResizeObserver.
// Contracts: Viewport offsets count once; invalid startup geometry retains the last usable measurement.
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

export function searchResultsHeight(barBottom: number, layoutHeight: number, visibleHeight = layoutHeight, offsetTop = 0): number | null {
  if (![barBottom, layoutHeight, visibleHeight, offsetTop].every(Number.isFinite) || layoutHeight <= 0 || visibleHeight <= 0) return null
  const visibleBottom = Math.min(layoutHeight, offsetTop + visibleHeight)
  // Match the dropdown's 12px top margin and leave an 8px lower edge gap.
  return Math.max(0, Math.floor(visibleBottom - barBottom - 12 - 8))
}

export function useSearchViewport(bar: Ref<HTMLElement | null>, results: Ref<HTMLElement | null>) {
  const height = ref<number | null>(null)
  let viewport: VisualViewport | null = null
  let observer: ResizeObserver | undefined
  let frame: number | undefined

  function measure() {
    frame = undefined
    if (!bar.value || !results.value) return
    const next = searchResultsHeight(bar.value.getBoundingClientRect().bottom, window.innerHeight, viewport?.height ?? window.innerHeight, viewport?.offsetTop ?? 0)
    if (next !== null) height.value = next
  }
  function schedule() {
    if (frame === undefined) frame = window.requestAnimationFrame(measure)
  }
  const stop = watch([bar, results], schedule, { flush: 'post' })
  onMounted(() => {
    viewport = window.visualViewport
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    // Capture ancestor scrollers as well as document scrolling/panning.
    window.addEventListener('scroll', schedule, true)
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule)
      if (bar.value) observer.observe(bar.value)
    }
    schedule()
  })
  onUnmounted(() => {
    stop()
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    observer?.disconnect()
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('scroll', schedule, true)
  })
  return computed(() => height.value === null ? {} : { '--omni-mobile-results-height': `${height.value}px` })
}
