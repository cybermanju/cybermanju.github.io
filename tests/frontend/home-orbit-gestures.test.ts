// CyberManju OS — App-local Orbit gesture lifecycle regression.
// Role: execute the real SFC touch handlers against deferred native-hide results.
// Exports: Vitest suite. Integrates: TypeScript transpilation and homeWorkspaces classifier.
// Contracts: no screen change or pinch transform before successful native suspension.
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { classifyHomeGesture } from '@/utils/homeWorkspaces'
const source = readFileSync('src/components/HomeWorkspaceStudio.vue', 'utf8')
function setup(hidden: Promise<boolean>) {
  const chunk = source.slice(source.indexOf('let gesture:'), source.indexOf('onMounted(() =>'))
  const compiled = ts.transpileModule(chunk, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const props = { blocked: false }, overview = { value: false }, zoom = { value: 1 }
  const nativeHome = { suspend: vi.fn(() => hidden) }, navigate = vi.fn()
  const handlers = new Function('nativeHome', 'props', 'picker', 'dragging', 'editing', 'overview', 'zoom', 'panX', 'panY', 'innerWidth', 'innerHeight', 'classifyHomeGesture', 'activeIndex', 'navigate', `${compiled};return {touchStart,touchMove,touchEnd,resetTouch};`)(nativeHome, props, { value: null }, { value: null }, { value: false }, overview, zoom, { value: 0 }, { value: 0 }, 390, 760, classifyHomeGesture, { value: 1 }, navigate)
  const point = (x: number, y = 300) => ({ clientX: x, clientY: y })
  const event = (points: ReturnType<typeof point>[]) => ({ touches: points, target: { closest: () => null }, preventDefault: vi.fn() })
  return { ...handlers, props, overview, zoom, nativeHome, navigate, point, event }
}
describe('Orbit native-hide gesture barrier', () => {
  it('does not page until hide resolves true', async () => {
    let resolve!: (ok: boolean) => void
    const f = setup(new Promise<boolean>(done => { resolve = done }))
    f.touchStart(f.event([f.point(240)])); f.touchMove(f.event([f.point(120)]))
    const end = f.touchEnd(f.event([])); await Promise.resolve()
    expect(f.navigate).not.toHaveBeenCalled()
    resolve(true); await end; expect(f.navigate).toHaveBeenCalledExactlyOnceWith(2)
  })
  it('fails closed after an unsuccessful hide', async () => {
    const f = setup(Promise.resolve(false))
    f.touchStart(f.event([f.point(240)])); f.touchMove(f.event([f.point(120)])); await f.touchEnd(f.event([]))
    expect(f.navigate).not.toHaveBeenCalled(); expect(f.overview.value).toBe(false)
  })
  it('does not animate pinch while hide is pending or failed', () => {
    const f = setup(new Promise<boolean>(() => {})); f.overview.value = true
    const event = (points: any[]) => ({ ...f.event(points), target: { closest: () => ({}) } })
    f.touchStart(event([f.point(100), f.point(200)])); f.touchMove(event([f.point(60), f.point(240)]))
    expect(f.zoom.value).toBe(1)
  })
  it('ignores blocked, edge and vertical-only screen gestures', async () => {
    const f = setup(Promise.resolve(true)); f.props.blocked = true
    f.touchStart(f.event([f.point(200)])); expect(f.nativeHome.suspend).not.toHaveBeenCalled()
    f.props.blocked = false; f.touchStart(f.event([f.point(4)])); expect(f.nativeHome.suspend).not.toHaveBeenCalled()
    f.touchStart(f.event([f.point(200)])); f.touchMove(f.event([f.point(200, 450)])); await f.touchEnd(f.event([]))
    expect(f.navigate).not.toHaveBeenCalled()
  })
})
