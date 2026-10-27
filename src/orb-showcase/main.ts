// CyberManju OS — Orb showcase demo (src/orb-showcase/main.ts).
// Role: local-only appreciation page mounting the real OrbNavigator at display size.
// Exports: nothing (dev entry served at /orb-showcase.html by Vite; not in production builds).
// Integrates: src/components/OrbNavigator.vue + the shared home grid model, fully mocked screens.
// Contracts: fake studio behavior only — left/right page linearly, up/down jump grid rows,
// walls bump the orb without moving; keyboard arrows mirror the same model.
import { computed, createApp, defineComponent, h, ref } from 'vue'
import OrbNavigator from '@/components/OrbNavigator.vue'
import { homeGridCols, homeGridNeighbors, homeHueForScreen, type HomeGridDelta } from '@/utils/homeWorkspaces'
import './style.css'

const SCREENS = ['Home', 'Mail', 'Notes', 'Music', 'Play', 'Maps', 'Ideas']

const App = defineComponent({
  setup() {
    const active = ref(0)
    const lastMove = ref('')
    const cols = computed(() => homeGridCols(SCREENS.length))
    const neighbors = computed(() => homeGridNeighbors(active.value, SCREENS.length))
    const nameOf = (i: number) => (i >= 0 && i < SCREENS.length ? SCREENS[i] : '—')

    function navigate(delta: HomeGridDelta) {
      const colsNow = homeGridCols(SCREENS.length)
      const target = delta.dy ? active.value + delta.dy * colsNow : active.value + delta.dx
      if (target < 0 || target > SCREENS.length - 1) { lastMove.value = 'wall — bumped, stayed'; return }
      const dirName = delta.dy ? delta.dy < 0 ? 'up' : 'down' : delta.dx > 0 ? 'right' : 'left'
      active.value = target
      lastMove.value = `navigated ${dirName} → ${SCREENS[target]}`
    }
    function keydown(event: KeyboardEvent) {
      const map: Record<string, HomeGridDelta> = {
        ArrowLeft: { dx: 1, dy: 0 }, // drag content right reveals the left screen — same mapping as pointer drag
        ArrowRight: { dx: -1, dy: 0 },
        ArrowUp: { dx: 0, dy: -1 },
        ArrowDown: { dx: 0, dy: 1 },
      }
      const delta = map[event.key]
      if (delta) { event.preventDefault(); navigate(delta) }
    }
    window.addEventListener('keydown', keydown)

    const hue = (i: number) => `hsl(${homeHueForScreen(i)} 60% 60%)`
    const hint = (i: number) => ({ color: i >= 0 ? hue(i) : 'transparent', opacity: i >= 0 ? 0.85 : 0.25 })

    return () =>
      h('main', { class: 'stage' }, [
        h('div', { class: 'orb-wrap' }, [
          h(OrbNavigator, {
            screenIndex: active.value,
            screenCount: SCREENS.length,
            'aria-label': `Showcase orb. Screen ${active.value + 1} of ${SCREENS.length}: ${SCREENS[active.value]}.`,
            onNavigate: navigate,
            onOpenApps: () => { lastMove.value = 'drawer would open here' },
          }),
        ]),
        h('section', { class: 'readout' }, [
          h('h1', null, `Screen ${active.value + 1} / ${SCREENS.length} — ${SCREENS[active.value]}`),
          h('p', { class: 'neighbors' }, [
            h('span', { style: hint(neighbors.value.left) }, `← ${nameOf(neighbors.value.left)}   `),
            h('span', { style: hint(neighbors.value.right) }, `${nameOf(neighbors.value.right)} →   `),
            h('span', { style: hint(neighbors.value.up) }, `↑ ${nameOf(neighbors.value.up)}   `),
            h('span', { style: hint(neighbors.value.down) }, `${nameOf(neighbors.value.down)} ↓`),
          ]),
          h('p', { class: 'feedback' }, lastMove.value ? `last: ${lastMove.value}` : 'drag the orb in any direction · tap = next · double-tap = drawer · arrow keys work too'),
        ]),
        h('footer', { class: 'screens' },
          SCREENS.map((title, i) =>
            h('button', {
              key: i,
              class: ['screen-chip', i === active.value ? 'active' : ''],
              style: { boxShadow: i === active.value ? `0 0 0 2px ${hue(i)}` : '' },
              onClick: () => { if (i !== active.value) { lastMove.value = `jumped to ${title}`; active.value = i } },
            }, [
              h('span', { class: 'dot', style: { background: hue(i) }, 'aria-hidden': 'true' }),
              `${i + 1} ${title}`,
            ]),
          ),
        ),
      ])
  },
})

createApp(App).mount('#app')
