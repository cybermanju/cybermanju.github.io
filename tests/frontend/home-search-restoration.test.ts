// @vitest-environment happy-dom
// CyberManju OS — Home search restoration regression tests.
// Role: Keep the single unified Home search-and-commands surface visible and exercise explicit draft routing.
// Exports: Vitest suite.
// Integrates: Vue Test Utils, HomeCommandBar and MobileLauncher source contracts.
// Contracts: Inputs never submit a provider request or execute a shell command.
import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HomeCommandBar from '@/components/HomeCommandBar.vue'

const mocks = vi.hoisted(() => ({ open: vi.fn(), stage: vi.fn() }))
vi.mock('@/composables/useWindowManager', () => ({ useWindowManager: () => ({ open: mocks.open }) }))
vi.mock('@/composables/useHomeCommandHandoff', () => ({ stageHomeCommand: mocks.stage }))
const launcher = readFileSync('src/components/MobileLauncher.vue', 'utf8')
const barSource = readFileSync('src/components/HomeCommandBar.vue', 'utf8')
const render = () => mount(HomeCommandBar, { global: { stubs: { AppIcon: true } } })
beforeEach(() => vi.clearAllMocks())

describe('restored double-width Home search and commands', () => {
  it('renders one unified search-and-commands surface, without a second search or command bar', () => {
    expect(launcher.match(/<OmniSearchPanel\b/g)).toHaveLength(1)
    expect(launcher).toContain('<OmniSearchPanel ref="searchRef" home :before-open="hideNative" class="mla-unified-search" />')
    // The launcher no longer mounts HomeCommandBar: the unified search surface
    // owns draft routing, so no competing command row is allowed.
    expect(launcher).not.toContain('<HomeCommandBar')
    expect(launcher).toContain('aria-label="Search and commands"')
    expect(launcher).toContain(':deep(.omni-col) { position: static; width: 100%; min-width: 0; }')
    expect(barSource).not.toContain('width: min(680px, 100%)')
  })

  it('floats bounded results without clipping focus rings or consuming workspace height', () => {
    expect(launcher).toContain('position: absolute; inset: calc(100% + 6px) 0 auto;')
    expect(launcher).not.toContain('max-height: 45%; overflow: auto;')
    expect(launcher).toContain('@focusin="searchToolsOpen = true" @focusout="onSearchToolsBlur"')
    expect(launcher).not.toContain('searchToolsOpen.value = !searchToolsOpen.value')
  })

  it('disables empty drafts and keeps persistent, honest keyboard guidance', () => {
    const wrapper = render()
    for (const button of wrapper.findAll('button')) expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="status"]').text()).toContain('Draft only')
    wrapper.unmount()
  })

  it.each([
    { shiftKey: false, target: 'agent', status: 'Assistant' },
    { shiftKey: true, target: 'terminal', status: 'cybsh' },
  ])('Enter routes only a draft to $target (Shift=$shiftKey)', async ({ shiftKey, target, status }) => {
    const wrapper = render()
    await wrapper.get('input').setValue('  help  ')
    await wrapper.get('input').trigger('keydown', { key: 'Enter', shiftKey })
    expect(mocks.stage).toHaveBeenCalledExactlyOnceWith(target, 'help')
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(target)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('[role="status"]').text()).toContain(status)
    wrapper.unmount()
  })

  it.each(['Ask AI', 'cybsh'])('clicking %s explicitly chooses its draft destination', async label => {
    const wrapper = render()
    await wrapper.get('input').setValue('pwd')
    await wrapper.findAll('button').find(button => button.text() === label)!.trigger('click')
    expect(mocks.stage).toHaveBeenCalledExactlyOnceWith(label === 'Ask AI' ? 'agent' : 'terminal', 'pwd')
    wrapper.unmount()
  })

  it('does not hand off an IME candidate, even with Shift held', async () => {
    const wrapper = render()
    await wrapper.get('input').setValue('日本語')
    await wrapper.get('input').trigger('keydown', { key: 'Enter', shiftKey: true, isComposing: true })
    expect(mocks.stage).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
