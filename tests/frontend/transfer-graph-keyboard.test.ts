// @vitest-environment happy-dom
// CyberManju OS — Transfer graph keyboard workflow regression.
// Role: exercise native keyboard-equivalent planning controls and ensure planning does no transfer IO.
// Integrates: Vue Test Utils, mocked provider canal/store; real TransferGraph component.
// Contracts: transfers execute only after Apply; destinations are mounted; default operation is cp.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { nextTick } from 'vue'
import TransferGraph from '@/components/TransferGraph.vue'

const io = vi.hoisted(() => ({
  fetchSyncConfigs: vi.fn(async () => undefined),
  syncConfigs: [{ id: 'cfg', name: 'Destination', backendType: 'local' }],
  notifySuccess: vi.fn(), notifyError: vi.fn(),
  listVfsMounts: vi.fn(async () => [
    { id: 'source', configId: 'src-cfg', name: 'Source', backendType: 'local' },
    { id: 'dest', configId: 'cfg', name: 'Destination', backendType: 'local' },
  ]),
  listVfsDir: vi.fn(async (mountId: string) => mountId === 'source'
    ? [{ name: 'file.txt', path: 'file.txt', locator: 'file.txt', isDir: false, sizeBytes: 4 }]
    : []),
  readVfsFile: vi.fn(async () => ({ bytes: new Uint8Array([1, 2]), magic: '' })),
  writeVfsFile: vi.fn(async () => undefined), deleteVfsFile: vi.fn(async () => undefined),
  saveVfsMount: vi.fn(async () => undefined), getVfsMasterPassphrase: vi.fn(async () => ''),
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => io }))
vi.mock('@/composables/useWindowManager', () => ({ useWindowManager: () => ({ open: vi.fn() }) }))
vi.mock('@/composables/useProviderCanal', () => ({
  listVfsMounts: io.listVfsMounts, listVfsDir: io.listVfsDir,
  readVfsFile: io.readVfsFile, writeVfsFile: io.writeVfsFile, deleteVfsFile: io.deleteVfsFile,
  saveVfsMount: io.saveVfsMount, getVfsMasterPassphrase: io.getVfsMasterPassphrase,
  TRANSFER_WRITE_CAP_BYTES: 5242880,
}))
vi.mock('@/components/AppIcon.vue', () => ({ default: { template: '<i aria-hidden="true" />' } }))
vi.mock('@/components/ProviderLogo.vue', () => ({ default: { template: '<i aria-hidden="true" />' } }))

afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks() })

async function settle() {
  for (let i = 0; i < 8; i += 1) await nextTick()
}

describe('TransferGraph keyboard transfer workflow', () => {
  it('plans with native controls and performs no file IO until Apply', async () => {
    const wrapper = mount(TransferGraph, { attachTo: document.body })
    await settle()
    const sourceSelect = wrapper.get('select[aria-label="Source mount"]')
    await sourceSelect.setValue('source')
    await settle()
    const pin = wrapper.findAll('button').find(b => b.text().includes('+ Board'))
    expect(pin).toBeTruthy()
    await pin!.trigger('click')
    await settle()
    await wrapper.get('select[aria-label="Pinned source file or folder"]').setValue(wrapper.vm.$.setupState.fileNodes[0].id)
    await wrapper.get('select[aria-label="Mounted destination provider"]').setValue('cfg')
    await wrapper.get('input[aria-label="Destination folder"]').setValue('archive')
    const plan = wrapper.findAll('button').find(b => b.text().includes('Plan transfer'))
    expect(plan).toBeTruthy()
    await plan!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('CP')
    expect(io.readVfsFile).not.toHaveBeenCalled()
    expect(io.writeVfsFile).not.toHaveBeenCalled()
    expect(io.deleteVfsFile).not.toHaveBeenCalled()
    const apply = wrapper.findAll('button').find(b => b.text().includes('Apply (1)'))
    expect(apply).toBeTruthy()
    await apply!.trigger('click')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(io.readVfsFile).toHaveBeenCalled()
    expect(io.writeVfsFile).toHaveBeenCalled()
    expect(io.deleteVfsFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('exposes labels, keyboard plan action, and a responsive focus treatment', async () => {
    const wrapper = mount(TransferGraph)
    await settle()
    expect(wrapper.get('[aria-label="Pinned source file or folder"]').element.tagName).toBe('SELECT')
    expect(wrapper.get('[aria-label="Mounted destination provider"]').element.tagName).toBe('SELECT')
    expect(wrapper.get('[aria-label="Destination folder"]').element.tagName).toBe('INPUT')
    expect(wrapper.get('button:disabled').exists()).toBe(true)
    expect(wrapper.html()).toContain('Plan transfer')
    const componentSource = readFileSync('src/components/TransferGraph.vue', 'utf8')
    expect(componentSource).toContain('.tf :focus-visible')
    expect(componentSource).toContain('@media (max-width: 768px)')
    expect(componentSource).toContain('flex-basis: 100%')
    wrapper.unmount()
  })

  it('cancels selection and clears a reviewed plan without IO', async () => {
    const wrapper = mount(TransferGraph, { attachTo: document.body })
    await settle()
    await wrapper.findAll('button').find(b => b.text() === '+ Board')!.trigger('click')
    await wrapper.get('select[aria-label="Mounted destination provider"]').setValue('cfg')
    await wrapper.findAll('button').find(b => b.text() === 'Cancel selection')!.trigger('click')
    expect((wrapper.get('select[aria-label="Mounted destination provider"]').element as HTMLSelectElement).value).toBe('')
    expect(wrapper.findAll('button').find(b => b.text() === 'Plan transfer')!.attributes('disabled')).toBeDefined()
    const source = wrapper.get('select[aria-label="Pinned source file or folder"]')
    await source.setValue(source.findAll('option')[1].attributes('value'))
    await wrapper.get('select[aria-label="Mounted destination provider"]').setValue('cfg')
    await wrapper.findAll('button').find(b => b.text() === 'Plan transfer')!.trigger('click')
    await wrapper.findAll('button').find(b => b.text() === 'Clear')!.trigger('click')
    expect(wrapper.find('[aria-label="Planned transfers"]').exists()).toBe(false)
    expect(io.readVfsFile).not.toHaveBeenCalled()
    expect(io.writeVfsFile).not.toHaveBeenCalled()
    expect(io.deleteVfsFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('locks keyboard planning while Apply is in progress and preserves cancellation', async () => {
    let release!: (value: { bytes: Uint8Array; magic: string }) => void
    io.readVfsFile.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const wrapper = mount(TransferGraph, { attachTo: document.body })
    await settle()
    await wrapper.findAll('button').find(b => b.text() === '+ Board')!.trigger('click')
    await wrapper.get('select[aria-label="Mounted destination provider"]').setValue('cfg')
    await wrapper.findAll('button').find(b => b.text() === 'Plan transfer')!.trigger('click')
    await wrapper.findAll('button').find(b => b.text() === 'Apply (1)')!.trigger('click')
    await settle()
    expect(wrapper.get('select[aria-label="Pinned source file or folder"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('select[aria-label="Mounted destination provider"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[aria-label="Destination folder"]').attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find(b => b.text() === 'Cancel')!.trigger('click')
    release({ bytes: new Uint8Array([1, 2]), magic: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(io.deleteVfsFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
