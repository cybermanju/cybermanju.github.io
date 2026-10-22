// CyberManju OS — Shortcuts automation host (src/automation/host.ts).
// Role: Compose the UI-independent workflow repository, service and opt-in capabilities.
// Exports: createShortcutsAutomationHost, ShortcutsAutomationHost and host options.
// Integrates: IndexedDB storage, runner authorization, integration adapters and closed Android catalog.
// Contracts: Explicit owner/environment namespace; no permissive policy, memory fallback or persisted outputs/secrets.
import { createAutomationRegistry, type IntegrationOptions, type NativeActionBridge } from './actions'
import { registerAndroidNativeActions } from './nativeActions'
import { WorkflowRepository } from './repository'
import { ActionRegistry, type ActionDefinition, type ExecutionJournal, type RunnerOptions } from './runner'
import { WorkflowService } from './service'
import { IndexedDBAutomationStorage, type AutomationStorage } from './storage'

export interface ShortcutsAutomationHostOptions {
  /** Caller-selected stable owner/environment namespace; never derive this from a workflow or run ID. */
  databaseName: string
  /** Required host policy. No action is implicitly authorized by installing an adapter. */
  authorize: RunnerOptions['authorize']
  integrations?: IntegrationOptions
  /** Installs only registerAndroidNativeActions' closed catalog; no ambient/native bridge lookup. */
  nativeBridge?: NativeActionBridge
  /** Test seam only. Production uses the dedicated IndexedDB database, without fallback. */
  storage?: AutomationStorage
  /** Optional stronger host journal, claimed after (never instead of) the storage-backed journal. */
  journal?: ExecutionJournal
}

export interface ShortcutsAutomationHost {
  readonly repository: WorkflowRepository
  readonly service: WorkflowService
  /** Custom adapters must truthfully declare their effects; write registrations require persistent storage. */
  readonly registry: ActionRegistry
  readonly durability: AutomationStorage['durability']
}

/** Enforce the same durability rule for initial integrations and later custom adapter registration. */
class HostActionRegistry extends ActionRegistry {
  constructor(source: ActionRegistry, private readonly durability: AutomationStorage['durability']) {
    super()
    for (const { id } of source.list()) this.register(source.get(id)!)
  }

  override register(definition: ActionDefinition): this {
    if (definition.effect === 'write' && this.durability !== 'persistent') {
      throw new Error('persistent_storage_required')
    }
    return super.register(definition)
  }
}

/**
 * Create one host per authenticated owner/environment. The namespace is not an authentication boundary.
 * IndexedDB opens lazily: open/transaction failures reject persistence and prevent service dispatch.
 * `persistent` describes the storage contract, not a guarantee against OS/browser data eviction.
 * Outputs remain run-local; secret resolution belongs only to explicit integration adapters.
 */
export function createShortcutsAutomationHost(options: ShortcutsAutomationHostOptions): ShortcutsAutomationHost {
  if (!options || typeof options.databaseName !== 'string' || !options.databaseName.trim() ||
    options.databaseName !== options.databaseName.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(options.databaseName)) {
    throw new Error('invalid_database_name')
  }
  if (typeof options.authorize !== 'function') throw new Error('missing_authorization_policy')
  if (options.nativeBridge !== undefined && typeof options.nativeBridge !== 'function') throw new Error('invalid_bridge')
  if (options.journal !== undefined && (!options.journal || typeof options.journal.claim !== 'function')) {
    throw new Error('missing_policy_or_journal')
  }

  const storage = options.storage ?? new IndexedDBAutomationStorage({ databaseName: options.databaseName })
  if (!storage || !['persistent', 'session'].includes(storage.durability) ||
    typeof storage.get !== 'function' || typeof storage.list !== 'function' || typeof storage.update !== 'function') {
    throw new Error('storage_unavailable')
  }
  const registry = new HostActionRegistry(createAutomationRegistry(options.integrations), storage.durability)
  if (options.nativeBridge !== undefined) registerAndroidNativeActions(registry, options.nativeBridge)
  const repository = new WorkflowRepository(storage)
  const additionalJournal = options.journal
  const journal: ExecutionJournal = additionalJournal === undefined ? repository.executionJournal : {
    async claim(key) {
      if (await repository.executionJournal.claim(key) !== true) return false
      return additionalJournal.claim(key)
    },
  }
  const service = new WorkflowService({ repository, registry, authorize: options.authorize, journal })
  return Object.freeze({ repository, service, registry, durability: storage.durability })
}
