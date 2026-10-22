// CyberManju OS — Shortcut service result view (src/utils/shortcutStatus.ts).
// Role: Present typed host rejections without exposing raw messages or request payloads.
// Exports: Structurally compatible service-result view and bounded fixed-label helpers.
// Integrates: Public automation RunResult; service itself remains owned by the host.
// Contracts: No runner/service/schema changes, secret resolution, persistence or raw issue rendering.
import { identifier, type RunResult } from '@/automation'

// Structural mirrors of the host service's public result, available without importing its runtime.
export interface ShortcutValidationIssue {
  code: 'invalid_workflow' | 'plaintext_secret' | 'cyclic_workflow' | 'unreachable_node' |
    'unregistered_action' | 'invalid_input' | 'binding_not_available' | 'input_deferred'
  severity: 'error' | 'info'
  nodeId?: string
}
export type ShortcutRejectionCode = 'not_found' | 'revision_conflict' | 'invalid_run' | 'validation_failed' | 'run_conflict' | 'storage_unavailable' | 'pending_run'
export type ShortcutRunResult = RunResult | { status: 'rejected'; code: ShortcutRejectionCode; issues?: ShortcutValidationIssue[] }
const rejectionLabels: Record<ShortcutRejectionCode, string> = {
  not_found: 'Atalho salvo não encontrado (not_found).',
  revision_conflict: 'A revisão salva mudou; reconcilie o rascunho (revision_conflict).',
  invalid_run: 'A identificação da execução é inválida (invalid_run).',
  validation_failed: 'O workflow não passou na validação do host (validation_failed).',
  run_conflict: 'Há conflito com uma execução já registrada (run_conflict).',
  storage_unavailable: 'O armazenamento necessário não está disponível (storage_unavailable).',
  pending_run: 'Há uma execução pendente; reconcilie antes de iniciar outra (pending_run).',
}
const issueLabels: Record<ShortcutValidationIssue['code'], string> = {
  invalid_workflow: 'Workflow inválido', plaintext_secret: 'Credencial inline não permitida',
  cyclic_workflow: 'Ciclo no workflow', unreachable_node: 'Nó sem caminho de entrada',
  unregistered_action: 'Ação não registrada', invalid_input: 'Input inválido',
  binding_not_available: 'Referência de saída indisponível neste caminho', input_deferred: 'Input depende de saída de uma etapa anterior',
}
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)
export function rejectionLabel(code: string): string {
  return own(rejectionLabels, code) ? rejectionLabels[code as ShortcutRejectionCode] : 'Rejeição não reconhecida; consulte o host.'
}
export function validationIssueLabel(code: ShortcutValidationIssue['code']): string { return issueLabels[code] }
/** Preserve only whitelisted typed metadata; no free-form messages, outputs, values or extras. */
export function boundedValidationIssues(value: unknown): ShortcutValidationIssue[] {
  if (!Array.isArray(value)) return []
  const issues: ShortcutValidationIssue[] = []
  for (const issue of value.slice(0, 32)) {
    if (!issue || typeof issue !== 'object' || typeof issue.code !== 'string' || !own(issueLabels, issue.code) || !['error', 'info'].includes(issue.severity)) continue
    issues.push({ code: issue.code, severity: issue.severity, ...(identifier(issue.nodeId) ? { nodeId: issue.nodeId } : {}) })
  }
  return issues
}
