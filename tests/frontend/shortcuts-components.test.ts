// CyberManju OS — Shortcuts component tests (tests/frontend/shortcuts-components.test.ts).
// Role: Render real Vue SFCs to verify UI states and the host integration boundary.
// Exports: Vitest component regression suite.
// Integrates: Public automation types, Vue SSR and the actual Shortcuts components.
// Contracts: No execution/persistence mock promoted as production runtime.
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ShortcutsPanel from '@/components/ShortcutsPanel.vue'
import ShortcutRunStatus from '@/components/shortcuts/ShortcutRunStatus.vue'
import ShortcutNodeEditor from '@/components/shortcuts/ShortcutNodeEditor.vue'
import type { RunResult, ActionResult, Workflow } from '@/automation'
import type { ShortcutRunResult } from '@/utils/shortcutStatus'
import { MODULE_METADATA } from '@/types'
import { resolvePanel } from '@/utils/panels'

const workflow: Workflow = { schemaVersion: 1, id: 'test-workflow', revision: 3, entryNodeId: 'transform', nodes: [
  { id: 'end', type: 'end' },
  { id: 'transform', type: 'action', actionId: 'core.script', input: { steps: [{ id: 'text', op: 'text.upper', args: ['oi'] }] }, next: 'end' },
] }
const renderPanel = (props = {}) => renderToString(createSSRApp({ render: () => h(ShortcutsPanel, props) }))
const renderResult = (result?: ShortcutRunResult, running = false) => renderToString(createSSRApp({ render: () => h(ShortcutRunStatus, { result, running }) }))
const halted = (result: ActionResult): RunResult => ({ status: 'halted', nodeId: 'transform', steps: 1, result })

describe('real Shortcuts component rendering', () => {
  it('advertises only core.script by default and leaves execution/persistence disconnected', async () => {
    const html = await renderPanel()
    expect(html).toContain('core.script')
    expect(html).not.toContain('<code>core.http</code>')
    expect(html).not.toContain('<code>android.dial</code>')
    expect(html).toContain('conexão com o host pendente')
    expect(html).toContain('Sem agendamento ou execução em segundo plano')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Solicitar salvamento<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Revisar e executar<\/button>/)
    expect(html).toContain('type="search"')
  })
  it('respects the supplied registry, including an explicitly empty one', async () => {
    const none = await renderPanel({ actions: [] })
    expect(none).not.toContain('<code>core.script</code>')
    expect(none).toContain('Nenhuma ação encontrada')
    const native = await renderPanel({ actions: [{ id: 'android.dial', effect: 'write' }] })
    expect(native).toContain('Abrir discador')
    expect(native).not.toContain('<code>core.script</code>')
    expect(native).toContain('depende da ação do usuário')
  })
  it('uses only registry effects for all Android integrations, including URL and map', async () => {
    const ids = ['android.open_url', 'android.open_map', 'android.dial', 'android.share_text', 'android.create_calendar_event']
    const html = await renderPanel({ actions: ids.map(id => ({ id, effect: 'write' })) })
    expect(html.match(/>Efeito externo<\/span>/g)).toHaveLength(ids.length)
    const read = await renderPanel({ actions: [{ id: 'android.open_url', effect: 'read' }] })
    expect(read).toContain('>Leitura</span>')
    expect(read).not.toContain('>Efeito externo</span>')
  })
  it('renders action before end regardless of storage-array order', async () => {
    const html = await renderPanel({ modelValue: workflow })
    const nodes = html.match(/<li\b[^>]*class="[^"]*\bworkflow-node\b[^"]*"[\s\S]*?<\/li>/g) ?? []
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toContain('Transformar dados')
    expect(nodes[1]).toContain('Fim')
    expect(html).toContain('Próximo → end')
  })
  it('blocks execution for unsupported actions even when host allows requests', async () => {
    const html = await renderPanel({ modelValue: workflow, actions: [], canRun: true, canSave: true })
    expect(html).toContain('A execução está bloqueada')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Revisar e executar<\/button>/)
  })
  it('fail-closes on invalid workflows from the host', async () => {
    const html = await renderPanel({ modelValue: { ...workflow, revision: 0 }, canRun: true, canSave: true })
    expect(html).toContain('workflow recebido é inválido')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Solicitar salvamento<\/button>/)
  })
  it('never offers a second run when a result still needs reconciliation', async () => {
    for (const result of [halted({ status: 'unknown', idempotencyKey: 'opaque' }), halted({ status: 'accepted', jobId: 'job' }), halted({ status: 'needs_confirmation', confirmationId: 'confirmation', summary: 'Revisar', expiresAt: '2030-01-01T12:00:00Z' })]) {
      const html = await renderPanel({ modelValue: workflow, canRun: true, result })
      expect(html).toMatch(/<button[^>]*disabled[^>]*>Revisar e executar<\/button>/)
      expect(html).not.toMatch(/<button[^>]*>(Retomar|Tentar novamente|Aprovar)<\/button>/)
      expect(html).toContain('Rascunho bloqueado até o host reconciliar')
      expect(html).toMatch(/<button[^>]*disabled[^>]*>Novo atalho<\/button>/)
    }
  })
  it('renders all action results without misrepresenting accepted/confirmation/unknown', async () => {
    expect(await renderResult(halted({ status: 'accepted', jobId: 'job' }))).toContain('não significa que a execução foi concluída')
    const confirmation = await renderResult(halted({ status: 'needs_confirmation', confirmationId: 'c', summary: '<img src=x onerror=alert(1)>', expiresAt: '2030-01-01T12:00:00Z' }))
    expect(confirmation).toContain('&lt;img')
    expect(confirmation).not.toContain('<img')
    expect(confirmation).toContain('Confirme diretamente no host')
    expect(await renderResult(halted({ status: 'unknown', idempotencyKey: 'private-key' }))).toContain('não tente novamente')
    expect(await renderResult(halted({ status: 'unknown', idempotencyKey: 'private-key' }))).not.toContain('private-key')
    expect(await renderResult(halted({ status: 'denied', code: 'policy_denied' }))).toContain('ação foi negada')
    expect(await renderResult(halted({ status: 'failed', code: 'network', retryable: true }))).toContain('Não houve nova tentativa automática')
    expect(await renderResult(halted({ status: 'succeeded', output: 'private-data' }))).not.toContain('private-data')
  })
  it('renders running, idle and runner failure separately and conceals completed outputs', async () => {
    expect(await renderResult()).toContain('Nenhum resultado')
    expect(await renderResult(undefined, true)).toContain('Execução em andamento')
    expect(await renderResult({ status: 'failed', code: 'revision_conflict', steps: 0 })).toContain('Execução interrompida pelo runner')
    const completed = await renderResult({ status: 'completed', steps: 2, outputs: { transform: 'private-data' } })
    expect(completed).toContain('Execução concluída')
    expect(completed).toContain('Revelar saída privada')
    expect(completed).not.toContain('private-data')
    expect(completed).toContain('aria-live="polite"')
  })
  it('preserves rejected as a separate service state with fixed labels and bounded typed issues', async () => {
    for (const code of ['not_found', 'revision_conflict', 'invalid_run', 'validation_failed', 'run_conflict', 'storage_unavailable'] as const) {
      const result: ShortcutRunResult = { status: 'rejected', code, issues: [{ code: 'invalid_input', severity: 'error', nodeId: 'transform' }] }
      const html = await renderResult(result)
      expect(html).toContain('Execução rejeitada pelo serviço antes do runner')
      expect(html).toContain(code); expect(html).toContain('Input inválido'); expect(html).toContain('transform')
      expect(html).not.toContain('Execução interrompida pelo runner')
      const panel = await renderPanel({ modelValue: workflow, savedWorkflow: workflow, canRun: true, result })
      expect(panel).toMatch(/<button[^>]*disabled[^>]*>Revisar e executar<\/button>/)
    }
    const malicious: any = { status: 'rejected', code: '<img src=x>RAW-SECRET', issues: [
      { code: 'invalid_input', severity: 'error', nodeId: '<unsafe>', message: 'RAW-SECRET', input: { token: 'RAW-SECRET' } },
      { code: 'unknown-RAW-SECRET', severity: 'error' },
      ...Array.from({ length: 80 }, () => ({ code: 'input_deferred', severity: 'info', nodeId: 'transform' })),
    ] }
    const html = await renderResult(malicious)
    expect(html).toContain('Rejeição não reconhecida')
    expect(html).not.toContain('RAW-SECRET'); expect(html).not.toContain('&lt;unsafe&gt;')
    expect((html.match(/<li>/g) ?? []).length).toBeLessThanOrEqual(32)
  })
  it('renders conditions and script inputs without eval and with real labels', async () => {
    const node = { id: 'gate', type: 'condition' as const, predicate: { op: 'exists' as const, value: { $output: { nodeId: 'transform', path: ['last'] } } }, trueNext: 'end', falseNext: 'end' }
    const html = await renderToString(createSSRApp({ render: () => h(ShortcutNodeEditor, { node }) }))
    expect(html).toContain('Valor a verificar')
    expect(html).toContain('Sem conversão implícita de tipos')
    expect(html).toContain('Todas (AND)')
    expect(html).not.toContain('eval(')
  })
  it('registers a distinct Shortcuts app without changing the existing scheduler aliases', () => {
    expect(MODULE_METADATA.shortcuts.label).toBe('SHORTCUTS')
    expect(MODULE_METADATA.shortcuts.requiresAuth).toBe(false)
    expect(resolvePanel('shortcuts')).toBe('shortcuts')
    for (const alias of ['automation', 'schedules', 'cron'] as const) expect(resolvePanel(alias)).toBe('processes')
  })
})
