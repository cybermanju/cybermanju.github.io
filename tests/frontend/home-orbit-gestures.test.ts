// CyberManju OS — App-local Home gesture lifecycle regression.
// Role: execute real SFC touch handlers against deferred native-hide results.
// Integrates: TypeScript transpilation and Home gesture classification.
// Contracts: no transition before native suspension, no widget or system-edge capture.
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { classifyHomeGesture } from '@/utils/homeWorkspaces'
import { useHomeTouchSafety } from '@/composables/useHomeTouchSafety'

const source = readFileSync('src/components/HomeWorkspaceStudio.vue', 'utf8')
function setup(hidden: Promise<boolean>) {
  const keys = source.slice(source.indexOf('function workspaceKeys('), source.indexOf('async function closeOverview('))
  const navigation = source.slice(source.indexOf('async function navigate('), source.indexOf('async function launch('))
  const gestures = source.slice(source.indexOf('let gesture:'), source.indexOf('function removeApp('))
  const lifecycle = source.slice(source.indexOf('watch(() => [props.blocked'), source.indexOf('</script>'))
  const compiled = ts.transpileModule(keys + navigation + gestures + lifecycle, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const props = { blocked: false }, overview = { value: false }, zoom = { value: 1 }, panX = { value: 0 }, panY = { value: 0 }
  const picker = { value: null as string | null }, editing = { value: false }, dragging = { value: null as unknown }, activeIndex = { value: 1 }
  const state = { value: { pages: [{ id: 'first' }, { id: 'second' }, { id: 'third' }], activeId: 'second' } }, message = { value: '' }
  const nativeHome = { suspend: vi.fn(() => hidden), schedule: vi.fn() }, toggleOverview = vi.fn(), closeOverview = vi.fn()
  const window = new EventTarget(), unmounts: Array<() => void> = []
  const addListener = vi.spyOn(window, 'addEventListener'), removeListener = vi.spyOn(window, 'removeEventListener')
  // UI announcement behavior is covered by mounted Home tests; this adapter
  // preserves the native barrier/deferred Promise for the extracted gesture handlers.
  const handlers = new Function('nativeHome', 'suspendHome', 'props', 'picker', 'dragging', 'editing', 'overview', 'zoom', 'panX', 'panY', 'innerWidth', 'innerHeight', 'classifyHomeGesture', 'activeIndex', 'state', 'message', 'toggleOverview', 'closeOverview', 'window', 'onMounted', 'onUnmounted', 'watch', 'androidApps', 'document', 'useHomeTouchSafety', 'emptyPress', `${compiled};return {touchStart,touchMove,touchEnd,resetTouch,cancelTouch,workspaceKeys};`)(nativeHome, () => nativeHome.suspend(), props, picker, dragging, editing, overview, zoom, panX, panY, 390, 760, classifyHomeGesture, activeIndex, state, message, toggleOverview, closeOverview, window, (fn: () => void) => fn(), (fn: () => void) => unmounts.push(fn), vi.fn(), { supported: false }, new EventTarget(), useHomeTouchSafety, { click: vi.fn() })
  const target = (selector = '') => ({ closest: (s: string) => selector && selector.split(',').some(part => s.split(',').map(x => x.trim()).includes(part.trim())) ? {} : null })
  const point = (x: number, y = 300, selector = '') => ({ clientX: x, clientY: y, target: target(selector) })
  const event = (points: ReturnType<typeof point>[], selector = '') => ({ touches: points.map((p, identifier) => ({ ...p, identifier })), target: target(selector), cancelable: true, preventDefault: vi.fn(), stopPropagation: vi.fn() })
  return { ...handlers, props, overview, zoom, panX, panY, picker, editing, dragging, activeIndex, state, nativeHome, toggleOverview, closeOverview, point, event,
    blur: () => window.dispatchEvent(new Event('blur')), unmount: () => unmounts.forEach(fn => fn()), addListener, removeListener }
}
const settle = () => Promise.resolve()
describe('Orbit native-hide gesture barrier', () => {
  it('waits for native hide before paging', async () => {
    let resolve!: (ok: boolean) => void
    const f = setup(new Promise<boolean>(done => { resolve = done }))
    f.touchStart(f.event([f.point(240)])); f.touchMove(f.event([f.point(120)]))
    const end = f.touchEnd(f.event([])); await settle(); expect(f.state.value.activeId).toBe('second')
    resolve(true); await end; expect(f.state.value.activeId).toBe('third')
  })
  it('fails closed when native hide fails', async () => {
    const f = setup(Promise.resolve(false)); f.touchStart(f.event([f.point(240)])); f.touchMove(f.event([f.point(120)])); await f.touchEnd(f.event([]))
    expect(f.state.value.activeId).toBe('second')
  })
  it.each([[240, 120], [120, 240]])('allows two-finger directional swipe outside overview: %i to %i', async (from, to) => {
    const f = setup(Promise.resolve(true)); f.touchStart(f.event([f.point(from, 300), f.point(from + 30, 300)])); await settle()
    f.touchMove(f.event([f.point(to, 300), f.point(to + 30, 300)])); await f.touchEnd(f.event([]))
    expect(f.state.value.activeId).not.toBe('second')
  })
  it('rejects two-finger pinch outside overview without navigation', async () => {
    const f = setup(Promise.resolve(true)); f.touchStart(f.event([f.point(100), f.point(200)])); await settle()
    f.touchMove(f.event([f.point(60), f.point(240)])); await f.touchEnd(f.event([])); expect(f.state.value.activeId).toBe('second')
  })
  it('allows two fingers to pan/pinch only in overview and never navigate', async () => {
    const f = setup(Promise.resolve(true)); f.overview.value = true; f.touchStart(f.event([f.point(100), f.point(200)])); await settle()
    const move = f.event([f.point(80, 320), f.point(180, 320)]); f.touchMove(move); await f.touchEnd(f.event([]))
    expect(f.panY.value).toBe(20); expect(move.preventDefault).toHaveBeenCalled(); expect(f.state.value.activeId).toBe('second')
  })
  it('opens overview with three-finger upward swipe and closes with downward swipe', async () => {
    const f = setup(Promise.resolve(true)); const fingers = (y: number) => [f.point(100,y), f.point(150,y), f.point(200,y)]
    f.touchStart(f.event(fingers(300))); await settle(); f.touchMove(f.event(fingers(150))); await f.touchEnd(f.event([])); expect(f.overview.value).toBe(true)
    f.touchStart(f.event(fingers(150))); await settle(); f.touchMove(f.event(fingers(300))); await f.touchEnd(f.event([])); expect(f.overview.value).toBe(false)
  })
  it.each(['input','textarea','select','[contenteditable]','.workspace-widget','[data-native-placement]','.studio-picker'])('protects touch target matching %s for all contact counts', async selector => {
    for (const n of [1,2,3]) { const f = setup(Promise.resolve(true)); const pts = Array.from({length:n}, (_,i) => f.point(100+i*30)); f.touchStart(f.event(pts, selector)); await settle(); f.touchMove(f.event(pts.map(p => f.point(p.clientX-100,p.clientY-100)), selector)); await f.touchEnd(f.event([])); expect(f.nativeHome.suspend).not.toHaveBeenCalled(); expect(f.state.value.activeId).toBe('second'); expect(f.overview.value).toBe(false) }
  })
  it('requires every touch to be inside all safe edges, even when centroid is valid', () => {
    for (const pts of [[{x:4,y:300},{x:200,y:300}], [{x:200,y:2},{x:220,y:300}], [{x:200,y:400},{x:220,y:758}]]) { const f=setup(Promise.resolve(true)); f.touchStart(f.event(pts.map(p=>f.point(p.x,p.y)))); expect(f.nativeHome.suspend).not.toHaveBeenCalled() }
  })
  it('ignores blocked and picker states; reset/cancel invalidates pending hide after touchEnd', async () => {
    const blocked=setup(Promise.resolve(true)); blocked.props.blocked=true; blocked.touchStart(blocked.event([blocked.point(200)])); expect(blocked.nativeHome.suspend).not.toHaveBeenCalled()
    const picked=setup(Promise.resolve(true)); picked.picker.value='apps'; picked.touchStart(picked.event([picked.point(200)])); expect(picked.nativeHome.suspend).not.toHaveBeenCalled()
    { let resolve!: (ok:boolean)=>void; const f=setup(new Promise<boolean>(r=>resolve=r)); f.touchStart(f.event([f.point(240)])); f.touchMove(f.event([f.point(120)])); const ended=f.touchEnd(f.event([])); f.resetTouch(); resolve(true); await ended; expect(f.state.value.activeId).toBe('second') }
  })
  it('Escape closes overview on button targets; Alt+O is suppressed from form/editable targets', () => {
    const f=setup(Promise.resolve(true)); f.overview.value=true
    const key=(key:string,target:string,altKey=false)=>({key,target:{closest:(s:string)=>target && (s.split(',').includes(target) || s===target)?{}:null},altKey,isComposing:false,preventDefault:vi.fn(),stopPropagation:vi.fn()})
    const esc=key('Escape','button'); f.workspaceKeys(esc); expect(esc.preventDefault).toHaveBeenCalled(); expect(f.closeOverview).toHaveBeenCalled()
    for(const sel of ['input','textarea','select','[contenteditable]','.workspace-widget']) { const e=key('o',sel,true); f.workspaceKeys(e); expect(e.preventDefault).not.toHaveBeenCalled(); expect(f.toggleOverview).not.toHaveBeenCalled() }
    const alt=key('O','',true); f.workspaceKeys(alt); expect(alt.preventDefault).toHaveBeenCalled(); expect(f.toggleOverview).toHaveBeenCalledOnce()
  })

  it.each([2, 3])('allows initial sequential formation of %i fingers without retrying suspension', async count => {
    const f = setup(Promise.resolve(true))
    const fingers = (n: number, y = 300) => Array.from({ length: n }, (_, i) => f.point(120 + i * 30, y))
    for (let n = 1; n <= count; n++) f.touchStart(f.event(fingers(n)))
    expect(f.nativeHome.suspend).toHaveBeenCalledTimes(1)
    await settle()
    f.touchMove(f.event(fingers(count, 150)))
    await f.touchEnd(f.event([]))
    expect(f.overview.value).toBe(count === 3)
    expect(f.state.value.activeId).toBe(count === 2 ? 'third' : 'second')
  })

  it.each([1, 2])('locks a moving %i-finger sequence after adding a finger until every contact lifts', async count => {
    const f = setup(Promise.resolve(true))
    const fingers = (n: number, y = 300) => Array.from({ length: n }, (_, i) => f.point(120 + i * 30, y))
    f.touchStart(f.event(fingers(count))); await settle()
    f.touchMove(f.event(fingers(count, 270)))
    f.touchStart(f.event(fingers(count + 1, 270)))
    f.touchMove(f.event(fingers(count + 1, 130)))
    await f.touchEnd(f.event(fingers(1, 130)))
    f.touchStart(f.event(fingers(3, 130)))
    f.touchMove(f.event(fingers(3, 40)))
    await f.touchEnd(f.event([]))
    expect(f.overview.value).toBe(false)
    expect(f.state.value.activeId).toBe('second')
    expect(f.nativeHome.suspend).toHaveBeenCalledTimes(1)
    expect(f.nativeHome.schedule).not.toHaveBeenCalled()
    // Full release is the only way to enroll a fresh sequence.
    f.touchStart(f.event(fingers(3))); await settle()
    f.touchMove(f.event(fingers(3, 150))); await f.touchEnd(f.event([]))
    expect(f.overview.value).toBe(true)
  })

  it.each(['move', 'end'])('invalidates a count decrease detected by touch%s, even if the original count returns', async via => {
    const f = setup(Promise.resolve(true))
    const two = [f.point(240), f.point(270)]
    f.touchStart(f.event(two)); await settle()
    f.touchMove(f.event([f.point(210), f.point(240)]))
    if (via === 'move') f.touchMove(f.event([f.point(210)]))
    else await f.touchEnd(f.event([f.point(210)]))
    f.touchStart(f.event(two)); f.touchMove(f.event([f.point(100), f.point(130)]))
    await f.touchEnd(f.event([]))
    expect(f.state.value.activeId).toBe('second')
    expect(f.nativeHome.suspend).toHaveBeenCalledTimes(1)
    expect(f.nativeHome.schedule).not.toHaveBeenCalled()
  })

  it.each(['input', 'textarea', 'select', '[contenteditable]', '.workspace-widget', '[data-native-placement]', '.studio-picker'])('keeps %s exclusion sticky when a later finger starts outside', async selector => {
    const f = setup(Promise.resolve(true))
    f.touchStart(f.event([f.point(240, 300, selector)], selector))
    // The old target may disappear or be absent from the next event; the sequence stays excluded.
    f.touchStart(f.event([f.point(240), f.point(270)]))
    f.touchMove(f.event([f.point(100), f.point(130)])); await f.touchEnd(f.event([]))
    expect(f.state.value.activeId).toBe('second')
    expect(f.nativeHome.suspend).not.toHaveBeenCalled()
    expect(f.nativeHome.schedule).not.toHaveBeenCalled()
  })

  it.each(['input', '.workspace-widget', '[data-native-placement]'])('checks every contact target for %s, not only the new event target', async selector => {
    const f = setup(Promise.resolve(true))
    f.touchStart(f.event([f.point(240, 300, selector), f.point(270)]))
    f.touchMove(f.event([f.point(100), f.point(130)])); await f.touchEnd(f.event([]))
    expect(f.nativeHome.suspend).not.toHaveBeenCalled()
    expect(f.state.value.activeId).toBe('second')
  })

  it('invalidates when a contact is added on an excluded target during initial formation', async () => {
    const f = setup(Promise.resolve(true))
    f.touchStart(f.event([f.point(240)]))
    f.touchStart(f.event([f.point(240), f.point(270, 300, '.workspace-widget')]))
    f.touchStart(f.event([f.point(240), f.point(270), f.point(300)]))
    f.touchMove(f.event([f.point(100), f.point(130), f.point(160)])); await f.touchEnd(f.event([]))
    expect(f.nativeHome.suspend).toHaveBeenCalledTimes(1)
    expect(f.state.value.activeId).toBe('second')
    expect(f.nativeHome.schedule).not.toHaveBeenCalled()
  })

  it('registers a global blur invalidator and removes the same listener on unmount', () => {
    const f = setup(Promise.resolve(true))
    const registration = f.addListener.mock.calls.find(([name]) => name === 'blur')
    expect(registration).toBeDefined()
    f.unmount()
    expect(f.removeListener).toHaveBeenCalledWith('blur', registration![1])
  })

  it.each([2, 3])('blur invalidates an active %i-finger gesture and locks it until release', async count => {
    const f = setup(Promise.resolve(true))
    const points = (y: number) => Array.from({ length: count }, (_, i) => f.point(120 + i * 30, y))
    f.touchStart(f.event(points(300))); await settle()
    f.touchMove(f.event(points(270))); f.blur()
    f.touchStart(f.event(points(270))); f.touchMove(f.event(points(100)))
    await f.touchEnd(f.event([]))
    expect(f.overview.value).toBe(false)
    expect(f.state.value.activeId).toBe('second')
    expect(f.nativeHome.suspend).toHaveBeenCalledTimes(1)
    expect(f.nativeHome.schedule).not.toHaveBeenCalled()
  })

  it.each([2, 3])('ignores a late initial suspension after blur for %i fingers', async count => {
    let resolve!: (ok: boolean) => void
    const f = setup(new Promise<boolean>(done => { resolve = done }))
    const points = (y: number) => Array.from({ length: count }, (_, i) => f.point(120 + i * 30, y))
    f.touchStart(f.event(points(300))); f.touchMove(f.event(points(150)))
    const ended = f.touchEnd(f.event([])); f.blur(); resolve(true); await ended
    expect(f.overview.value).toBe(false)
    expect(f.state.value.activeId).toBe('second')
    expect(f.nativeHome.suspend).toHaveBeenCalledTimes(1)
    expect(f.nativeHome.schedule).not.toHaveBeenCalled()
  })

  it.each([2, 3])('ignores a late transition suspension after blur for %i fingers, without schedule or retry', async count => {
    let resolve!: (ok: boolean) => void
    const f = setup(Promise.resolve(true))
    f.nativeHome.suspend.mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done }))
    const points = (y: number) => Array.from({ length: count }, (_, i) => f.point(120 + i * 30, y))
    f.touchStart(f.event(points(300))); await settle(); f.touchMove(f.event(points(150)))
    const ended = f.touchEnd(f.event([])); await settle()
    expect(f.nativeHome.suspend).toHaveBeenCalledTimes(2)
    f.blur(); resolve(true); await ended
    expect(f.overview.value).toBe(false)
    expect(f.state.value.activeId).toBe('second')
    expect(f.nativeHome.suspend).toHaveBeenCalledTimes(2)
    expect(f.nativeHome.schedule).not.toHaveBeenCalled()
  })
  it('accepts a staggered parallel horizontal swipe and separate finger releases', async () => {
    const f = setup(Promise.resolve(true))
    f.touchStart(f.event([f.point(240), f.point(270)])); await settle()
    // Browser delivers the leading finger before the other; this is not a pinch.
    f.touchMove(f.event([f.point(210), f.point(270)]))
    f.touchMove(f.event([f.point(120), f.point(150)]))
    await f.touchEnd(f.event([f.point(120)]))
    expect(f.state.value.activeId).toBe('second')
    await f.touchEnd(f.event([])); expect(f.state.value.activeId).toBe('third')
    expect(f.state.value.pages).toHaveLength(3)
  })
  it.each(['cancel', 'move', 'readd', 'blur'])('aborts a qualified swipe on %s during separate release', async reason => {
    const f = setup(Promise.resolve(true))
    f.touchStart(f.event([f.point(240), f.point(270)])); await settle()
    f.touchMove(f.event([f.point(120), f.point(150)]))
    await f.touchEnd(f.event([f.point(120)]))
    if (reason === 'cancel') f.cancelTouch(f.event([f.point(120)]))
    if (reason === 'move') f.touchMove(f.event([f.point(100)]))
    if (reason === 'readd') f.touchStart(f.event([f.point(120), f.point(150)]))
    if (reason === 'blur') f.blur()
    await f.touchEnd(f.event([])); expect(f.state.value.activeId).toBe('second')
    expect(f.state.value.pages).toHaveLength(3)
  })
  it.each(['button', 'a', '[role="button"]', '.workspace-app'])('never enrolls a multi-contact gesture over %s', async selector => {
    const f = setup(Promise.resolve(true))
    f.touchStart(f.event([f.point(240, 300, selector), f.point(270)]))
    f.touchMove(f.event([f.point(120), f.point(150)])); await f.touchEnd(f.event([]))
    expect(f.nativeHome.suspend).not.toHaveBeenCalled(); expect(f.state.value.activeId).toBe('second')
  })
  it('claims a safe multi-contact move before a slow native hide, without navigating early', async () => {
    let resolve!: (ok: boolean) => void
    const f = setup(new Promise<boolean>(done => { resolve = done }))
    f.touchStart(f.event([f.point(240), f.point(270)]))
    const move = f.event([f.point(220), f.point(270)])
    f.touchMove(move); expect(move.preventDefault).toHaveBeenCalled()
    f.touchMove(f.event([f.point(120), f.point(150)]))
    const ended = f.touchEnd(f.event([])); expect(f.state.value.activeId).toBe('second')
    resolve(true); await ended; expect(f.state.value.activeId).toBe('third')
  })

  it('rejects a replaced contact even when the finger count is unchanged', async () => {
    const f = setup(Promise.resolve(true))
    f.touchStart(f.event([f.point(240), f.point(270)])); await settle()
    const move = f.event([f.point(120), f.point(150)]); move.touches[1]!.identifier = 99
    f.touchMove(move); await f.touchEnd(f.event([])); expect(f.state.value.activeId).toBe('second')
  })
  it('rejects movement coalesced into the last lift during frozen release', async () => {
    const f = setup(Promise.resolve(true))
    f.touchStart(f.event([f.point(240), f.point(270)])); await settle()
    f.touchMove(f.event([f.point(120), f.point(150)])); await f.touchEnd(f.event([f.point(120)]))
    await f.touchEnd({ ...f.event([]), changedTouches: [{ ...f.point(190), identifier: 0 }] })
    expect(f.state.value.activeId).toBe('second')
  })

})
