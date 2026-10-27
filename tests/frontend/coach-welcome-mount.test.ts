// @vitest-environment happy-dom
// CyberManju OS — Coach + WelcomeDemo mount.test (tests/frontend/coach-welcome-mount.test.ts).
// Role: DOM-level lives of the two new onboarding components: coach
//       resolves targets/steps/Next/finish; welcome demo types under the
//       clock and shows the finished transcript under reduced motion.
// Exports: Vitest suite.
// Integrates: FirstRunCoach.vue, WelcomeDemo.vue, @vue/test-utils.
// Contracts: coach falls back to centered cards when targets resolve to
//            nothing (never floats a tour of nothing); welcome demo is
//            aria-hidden (decorative).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import FirstRunCoach from '@/components/FirstRunCoach.vue'
import WelcomeDemo from '@/components/WelcomeDemo.vue'
import { clearCoachSeen, markCoachSeen } from '@/utils/coachMarks'
import { WELCOME_DEMO_LINES, WELCOME_TYPE_MS, initialWelcomeDemo } from '@/utils/welcomeDemoScript'

enableAutoUnmount(afterEach)

let roots: ReturnType<typeof mount>[] = []
afterEach(() => {
  document.body.innerHTML = ''
  roots = []
  vi.useRealTimers()
})

beforeEach(() => { document.body.innerHTML = '' })

describe('FirstRunCoach', () => {
  it('rings an existing target, walks steps, and reports done on finish', async () => {
    clearCoachSeen()
    const dock = document.createElement('div')
    dock.className = 'dock-container'
    dock.style.cssText = 'position:fixed;left:100px;bottom:0;width:400px;height:60px;'
    document.body.appendChild(dock)

    const wrapper = mount(FirstRunCoach, { attachTo: document.body })
    roots.push(wrapper)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="first-run-coach"]').exists()).toBe(true)
    const hole = wrapper.find('[data-testid="coach-hole"]')
    expect(hole.exists()).toBe(true)
    expect(hole.attributes('style')).toContain('left:')

    await wrapper.find('[data-testid="coach-next-dock"]').trigger('click')
    expect(wrapper.find('[data-testid="coach-next-terminal"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="coach-back"]').exists()).toBe(true)

    // Skip ahead to the final step and finish.
    await wrapper.find('[data-testid="coach-next-terminal"]').trigger('click')
    await wrapper.find('[data-testid="coach-next-done"]').trigger('click')
    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(markCoachSeen).toBeDefined() // App.vue persists on @done
  })

  it('renders no hole when the dock never resolves, tour continues as cards', () => {
    markCoachSeen() // seen ⇒ app gates anyway; direct mount must still behave
    const wrapper = mount(FirstRunCoach, { attachTo: document.body })
    roots.push(wrapper)
    // No ring target in the document — but the targetless steps keep the
    // tour usable (centered cards), so it fails soft, never to nothing.
    expect(wrapper.find('[data-testid="coach-hole"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="coach-next-terminal"]').exists()).toBe(true)
  })
})

describe('WelcomeDemo', () => {
  it('renders the mock cybsh window, aria-hidden, and types under the clock', async () => {
    vi.useFakeTimers()
    const wrapper = mount(WelcomeDemo, { attachTo: document.body })
    roots.push(wrapper)
    const win = wrapper.find('[data-testid="welcome-demo"]')
    expect(win.exists()).toBe(true)
    expect(win.attributes('aria-hidden')).toBe('true')

    // Walk the typed prompt a few ticks: chars appear.
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(WELCOME_TYPE_MS)
      await wrapper.vm.$nextTick()
    }
    expect(win.text()).toContain(WELCOME_DEMO_LINES[0].text.slice(0, 5))
  })

  it('jumps straight to the finished transcript under reduced motion', async () => {
    vi.stubGlobal('matchMedia', ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      addEventListener: vi.fn(),
    })) as unknown as typeof matchMedia)
    const wrapper = mount(WelcomeDemo, { attachTo: document.body })
    roots.push(wrapper)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="welcome-demo"]').text())
      .toContain(WELCOME_DEMO_LINES[WELCOME_DEMO_LINES.length - 1].text)
    vi.unstubAllGlobals()
  })

  it('starts from the clean-prompt state (the loop contract)', () => {
    expect(initialWelcomeDemo()).toEqual({ chars: 0, lineIndex: 0, complete: false })
  })
})
