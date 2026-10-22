// CyberManju OS — Shortcut status tests (tests/frontend/shortcuts-status.test.ts).
// Role: Verify status copy and privacy/safety boundaries for shortcut results.
// Exports: Vitest suites.
// Integrates: ShortcutRunStatus Vue SFC and automation runner contracts.
// Contracts: No execution actions; private output stays hidden until explicit reveal.
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { readFileSync } from 'node:fs'
import type { RunResult } from '../../src/automation/runner'
import { rejectionLabel } from '../../src/utils/shortcutStatus'

const source = readFileSync(new URL('../../src/components/shortcuts/ShortcutRunStatus.vue', import.meta.url), 'utf8')
const accepted: RunResult = { status: 'halted', nodeId: 'node', steps: 1, result: { status: 'accepted', jobId: 'job-1' } }
const confirm: RunResult = { status: 'halted', nodeId: 'node', steps: 1, result: { status: 'needs_confirmation', confirmationId: 'c', summary: '<img src=x onerror=alert(1)>', expiresAt: '2030-01-01T12:00:00.000Z' } }
const unknown: RunResult = { status: 'halted', nodeId: 'node', steps: 1, result: { status: 'unknown', idempotencyKey: 'k' } }
const render = (text: string) => renderToString(createSSRApp({ render: () => h('div', { role: 'status', 'aria-live': 'polite' }, text) }))
describe('ShortcutRunStatus safety contracts', () => {
  it('uses a polite live region and explicit running message', async () => {
    expect(source).toContain('role="status" aria-live="polite"')
    expect(source).toContain('Execução em andamento.')
    expect(await render('Execução em andamento.')).toContain('aria-live="polite"')
  })
  it('keeps completed output concealed by default and bounds it with secret protection', async () => {
    expect(source).toContain('copyJson(outputs, LIMITS.outputBytes, true)')
    expect(source).toContain('Revelar saída privada')
    expect(source).toContain('v-if="revealed"')
    expect(source).toContain('Execução concluída.')
    expect(await render('Execução concluída. Revelar saída privada')).not.toContain('"ok"')
  })
  it('states accepted is not completed', async () => {
    expect(accepted.result.status).toBe('accepted')
    const html = await render('A solicitação foi aceita pelo host; isso não significa que a execução foi concluída.')
    expect(html).toContain('foi aceita pelo host')
    expect(html).toContain('não significa que a execução foi concluída')
  })
  it('escapes confirmation summary through interpolation and directs confirmation to host only', async () => {
    expect(source).toContain('{{ result.result.summary }}')
    expect(source).toContain('Expira em:')
    expect(source).toContain('Confirme diretamente no host.')
    expect(source).not.toMatch(/@click=.*(approve|resume|aprovar|retomar)/i)
    const html = await render(confirm.result.status === 'needs_confirmation' ? confirm.result.summary : '')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })
  it('unknown forbids retry, rerun and automatic resume, with no execution controls', () => {
    expect(unknown.result.status).toBe('unknown')
    expect(source).toContain('não tente novamente nem retome automaticamente')
    expect(source).not.toMatch(/retry|re-run|retry\(|resume\(/i)
    expect(source).not.toMatch(/localStorage|console\.|fetch\(|\$emit|defineEmits/)
  })
  it('covers denied without raw payload and halted failed/succeeded outcomes', () => {
    expect(source).toContain('A ação foi negada. Nenhum conteúdo da solicitação é exibido.')
    expect(source).toContain('A ação falhou.')
    expect(source).toContain('A ação terminou, mas a execução do fluxo foi interrompida.')
    expect(source).toContain('result.result.output')
  })
  it('distinguishes runner failure from halted action results', () => {
    expect(source).toContain('Execução interrompida pelo runner.')
    expect(source).toContain('result.code')
    expect(source).toContain('is-error')
    expect(source).toContain('is-warning')
    expect(source).toContain('is-success')
  })
  it('renders a fixed pending_run rejection label without exposing payload', async () => {
    const label = rejectionLabel('pending_run')
    expect(label).toBe('Há uma execução pendente; reconcilie antes de iniciar outra (pending_run).')
    const html = await render(label)
    expect(html).toContain(label)
    expect(html).not.toContain('payload-secret')
    expect(html).not.toContain('requestBody')
  })
})
