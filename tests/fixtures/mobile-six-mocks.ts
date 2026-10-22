// CyberManju OS — Mobile regression fixture services.
// Role: replace IO at the Vite fixture boundary, never in production builds.
// Exports: store, window and canal fixtures used only by mobile-six.vite.ts.
// Integrates: real TransferGraph and SecretsPanel presentation.
// Contracts: no network, real secrets, provider reads/writes/deletes or persistence.
import { reactive } from 'vue'
const mounts = ['source', 'destination'].map((id) => ({ id, configId: id, name: `Fixture ${id}`, backendType: 'local', createdAt: '', updatedAt: '' }))
const store = reactive({
  secrets: [],
  syncConfigs: mounts.map((m) => ({ id: m.id, name: m.name, backendType: m.backendType })),
  fetchSyncConfigs: async () => {},
  notifySuccess: () => {}, notifyError: () => {},
})
export const useAppStore = () => store
export const useWindowManager = () => ({ open: () => {} })
export const listVfsMounts = async () => mounts
export const listVfsDir = async () => [{ name: 'Example.txt', path: 'Example.txt', locator: 'fixture-only', isDir: false, sizeBytes: 12, modifiedAt: '' }]
const blocked = async () => { throw new Error('Fixture: IO intentionally unavailable') }
export const readVfsFile = blocked
export const writeVfsFile = blocked
export const deleteVfsFile = blocked
export const saveVfsMount = blocked
export const getVfsMasterPassphrase = async () => null
