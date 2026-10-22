// CyberManju OS — Native Android widget UI bridge.
// Role: expose installed providers and persisted host states without REST or simulated widgets.
// Exports: useAndroidWidgets; integrates android_widget_command in the bundled Android window.
// Contracts: mutations are user initiated; timeouts recover with list, never repeat the mutation.
import { ref } from 'vue'
import { isAndroidApp, isTauri } from '@/composables/useTauri'
export interface NativeWidgetProvider { provider: string; label: string; minWidthDp: number; minHeightDp: number; resizeMode: number; configurable: boolean }
export interface NativeWidgetRecord { appWidgetId: number; placementId: string; provider: string; state: 'binding' | 'configuring' | 'ready'; providerAvailable: boolean; workspaceId?: string; widthDp: number; heightDp: number }
export interface NativeWidgetReply { ok: boolean; action: string; viewport: { widthDp: number; heightDp: number }; providers?: NativeWidgetProvider[]; widgets?: NativeWidgetRecord[]; appWidgetId?: number }
export type WidgetConfirmation = { userInitiated: true; expiresAt: number }
export type WidgetTransport = (action: string, payload: Record<string, unknown>) => Promise<NativeWidgetReply>
export function widgetConfirmation(): WidgetConfirmation { return { userInitiated: true, expiresAt: Date.now() + 4000 } }
export function createWidgetRequest(transport: WidgetTransport, timeoutMs = 8000): WidgetTransport {
  return async (action, payload) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([transport(action, payload), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout: host response uncertain; check saved widgets before another action')), timeoutMs) })])
    } finally { clearTimeout(timer) }
  }
}
export function useAndroidWidgets() {
  const supported = isTauri() && isAndroidApp()
  const status = ref<'unsupported' | 'idle' | 'loading' | 'ready' | 'error'>(supported ? 'idle' : 'unsupported')
  const providers = ref<NativeWidgetProvider[]>([]), records = ref<NativeWidgetRecord[]>([])
  const viewport = ref<{ widthDp: number; heightDp: number } | null>(null)
  const error = ref(''), busy = ref(false)
  const request = createWidgetRequest(async (action, payload) => {
    if (!supported) throw new Error('unsupported: Android widget hosting needs the native Android app')
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<NativeWidgetReply>('android_widget_command', { action, payload })
    if (result.ok !== true || !result.viewport || !Number.isFinite(result.viewport.widthDp) || !Number.isFinite(result.viewport.heightDp)) throw new Error('integrity: invalid widget host response')
    viewport.value = result.viewport
    return result
  })
  function fail(reason: unknown) {
    const text = reason instanceof Error ? reason.message : String(reason)
    error.value = text.startsWith('unsupported:') || /not found|not allowed|unknown command/i.test(text) ? 'Native widget hosting is not available in this build.' : text.startsWith('timeout:') ? 'Host response uncertain. Check saved widgets; no action was repeated.' : 'The Android widget host could not complete this action. Check status before trying again.'
    if (text.startsWith('unsupported:') || /unknown command|command .*not found/i.test(text)) status.value = 'unsupported'
    else status.value = 'error'
  }
  async function refresh(includeProviders = false) {
    if (!supported) return false
    status.value = 'loading'
    try {
      const listed = await request('list', {})
      records.value = (listed.widgets || []).filter(r => Number.isInteger(r.appWidgetId) && typeof r.placementId === 'string' && typeof r.provider === 'string' && ['binding', 'configuring', 'ready'].includes(r.state))
      if (includeProviders) {
        const result = await request('providers', {})
        providers.value = (result.providers || []).filter(p => typeof p.provider === 'string' && typeof p.label === 'string' && Number.isFinite(p.minWidthDp) && Number.isFinite(p.minHeightDp))
      }
      error.value = ''; status.value = 'ready'; return true
    } catch (reason) { fail(reason); return false }
  }
  async function mutate(action: 'add' | 'configure' | 'remove' | 'cancel', payload: Record<string, unknown>, confirmation: WidgetConfirmation) {
    if (busy.value || confirmation.expiresAt <= Date.now()) return false
    busy.value = true
    let certainSuccess = false
    try { await request(action, { ...payload, ...confirmation }); certainSuccess = true; error.value = '' } catch (reason) { fail(reason) }
    finally {
      // A read is safe even after a timed-out mutation. Never re-allocate/reconfigure automatically.
      const previousError = error.value
      await refresh()
      if (!certainSuccess && previousError) error.value = previousError
      busy.value = false
    }
    return certainSuccess
  }
  async function hide() { if (!supported || status.value === 'unsupported') return true; try { await request('hide', {}); return true } catch (reason) { fail(reason); return false } }
  async function layout(payload: Record<string, unknown>) { if (!supported) return false; try { await request('layout', payload); return true } catch (reason) { fail(reason); return false } }
  return { supported, status, providers, records, viewport, error, busy, refresh, mutate, hide, layout }
}
