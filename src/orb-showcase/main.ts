// CyberManju OS — Orb showcase demo (src/orb-showcase/main.ts).
// Role: local-only appreciation page mounting the real OrbNavigator at display size.
// Exports: nothing (dev entry served at /orb-showcase.html by Vite; not in production builds).
// Integrates: src/components/OrbNavigator.vue + the shared home grid model, fully mocked screens.
// Contracts: fake studio behavior only — all eight directions navigate or create an adjacent screen;
// the maximum screen count bumps the Orb, and keyboard arrows mirror the same model.
import { computed, createApp, defineComponent, h, ref } from 'vue'
import OrbNavigator from '@/components/OrbNavigator.vue'
import { HOME_GRID_DIRECTIONS, MAX_WORKSPACES, homeGridNeighbors, homeGridPosition, homeGridTarget, homeHueForScreen, type HomeGridDelta, type HomeGridDirection } from '@/utils/homeWorkspaces'
import './style.css'

const SCREENS = ['Home', 'Mail', 'Notes', 'Music', 'Play', 'Maps', 'Ideas']

const App = defineComponent({
  setup() {
    const active = ref(0)
    const lastMove = ref('')
    const screens = ref([...SCREENS])
    const positions = ref(SCREENS.map((_, index) => homeGridPosition(index, SCREENS.length)))
    const neighbors = computed(() => homeGridNeighbors(active.value, screens.value.length, positions.value))
    const nameOf = (i: number) => (i >= 0 && i < screens.value.length ? screens.value[i] : '—')
    function directionName(delta: HomeGridDelta) {
      if (delta.dx > 0) return delta.dy < 0 ? 'up-right' : delta.dy > 0 ? 'down-right' : 'right'
      if (delta.dx < 0) return delta.dy < 0 ? 'up-left' : delta.dy > 0 ? 'down-left' : 'left'
      return delta.dy < 0 ? 'up' : 'down'
    }

    function navigate(delta: HomeGridDelta) {
      const origin = positions.value[active.value]!
      const targetPoint = homeGridTarget(origin, delta)
      let target = positions.value.findIndex(point => point.x === targetPoint.x && point.y === targetPoint.y)
      const direction = directionName(delta)
      if (target < 0) {
        if (screens.value.length >= MAX_WORKSPACES) { lastMove.value = 'screen limit — bumped, stayed'; return }
        screens.value.push(`Screen ${screens.value.length + 1}`)
        positions.value.push(targetPoint)
        target = screens.value.length - 1
      }
      active.value = target
      lastMove.value = `navigated ${direction} → ${screens.value[target]}`
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
    const symbols: Record<HomeGridDirection, string> = { right: '→', downRight: '↘', down: '↓', downLeft: '↙', left: '←', upLeft: '↖', up: '↑', upRight: '↗' }

    return () =>
      h('main', { class: 'stage' }, [
        h('div', { class: 'orb-wrap' }, [
          h(OrbNavigator, {
            screenIndex: active.value,
            screenCount: screens.value.length,
            screenPositions: positions.value,
            'aria-label': `Showcase orb. Screen ${active.value + 1} of ${screens.value.length}: ${screens.value[active.value]}.`,
            onNavigate: navigate,
            onOpenApps: () => { lastMove.value = 'drawer would open here' },
          }),
        ]),
        h('section', { class: 'readout' }, [
          h('h1', null, `Screen ${active.value + 1} / ${screens.value.length} — ${screens.value[active.value]}`),
          h('p', { class: 'neighbors' }, [
            ...HOME_GRID_DIRECTIONS.map(direction => h('span', { style: hint(neighbors.value[direction]) }, `${symbols[direction]} ${nameOf(neighbors.value[direction])}   `)),
          ]),
          h('p', { class: 'feedback' }, lastMove.value ? `last: ${lastMove.value}` : 'drag the orb in any direction · tap = next · double-tap = drawer · arrow keys work too'),
        ]),
        h('footer', { class: 'screens' },
          screens.value.map((title, i) =>
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
