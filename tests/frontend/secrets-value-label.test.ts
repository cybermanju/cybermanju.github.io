// @vitest-environment happy-dom
// CyberManju OS — Secret value label accessibility regression.
// Role: mount the real editor and verify visible label association without revealing secrets.
// Integrates: Vue Test Utils, Vitest; store IO and icons are stubbed.
// Contracts: secret plaintext never enters accessible names, and editing does not reveal it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import SecretsPanel from '@/components/SecretsPanel.vue'

const io = vi.hoisted(() => ({
  revealSecret: vi.fn(),
  secrets: [{ id: 'example', title: 'Example login', kind: 'login', username: 'person', url: '', tags: [], hasValue: true, favorite: false, updatedAt: '2026-10-01' }],
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => io }))
vi.mock('@/composables/useNotifications', () => ({ useNotifications: () => ({ notify: vi.fn() }) }))
vi.mock('@/components/AppIcon.vue', () => ({ default: { template: '<i aria-hidden="true" />' } }))

afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks() })

function editor() {
  const wrapper = mount(SecretsPanel, { attachTo: document.body })
  return wrapper
}
async function clickText(text: string) {
  const button = [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === text)
  expect(button, `button ${text}`).toBeTruthy()
  button!.click()
  await nextTick()
}
function assertVisibleLabel() {
  const input = document.querySelector<HTMLInputElement>('.sp-value-input')!
  const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find(el => el.textContent?.trim() === 'Value')!
  expect(label).toBeTruthy()
  expect(label.htmlFor).toBe(input.id)
  expect(input.id).not.toBe('')
  expect(document.getElementById(label.htmlFor)).toBe(input)
  expect(input.type).toBe('password')
  expect(input.value).toBe('')
  expect(label.textContent).toBe('Value')
  expect(input.hasAttribute('aria-label')).toBe(false)
  expect(input.hasAttribute('aria-valuetext')).toBe(false)
  return input
}

describe('Secret editor Value accessible label', () => {
  it('labels a new password input with the visible Value label', async () => {
    const wrapper = editor()
    await clickText('Add')
    const input = assertVisibleLabel()
    input.value = 'fake-test-only-123'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Value')
    expect(io.revealSecret).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not reveal or prefill stored plaintext when editing', async () => {
    const wrapper = editor()
    document.querySelector<HTMLButtonElement>('.sp-row')!.click()
    await nextTick()
    await clickText('Edit')
    assertVisibleLabel()
    expect(io.revealSecret).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps association while the user explicitly toggles visibility', async () => {
    const wrapper = editor()
    await clickText('Add')
    const input = assertVisibleLabel()
    const id = input.id
    await clickText('Show')
    expect(input.type).toBe('text')
    expect(document.querySelector(`label[for="${id}"]`)?.textContent).toBe('Value')
    await clickText('Hide')
    expect(input.type).toBe('password')
    expect(io.revealSecret).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
