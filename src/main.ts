// CyberManju OS — Main (src/main.ts).
// Role: module (see exports below).
// Exports: module root (see items below).
// Integrates: ./…, vue, pinia.
// Contracts: none special (pure logic; errors bubble to caller).
// CyberManju OS — Main Entry
import './utils/deploymentStorage'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/main.css'
import './assets/ui.css'
import { installUi } from './ui/install'
import { useTheme } from './composables/useTheme'
import { installUiLayoutTargets } from './ui/layout'
import { installUiLayout } from './composables/useUiLayout'
import './assets/ui-layout.css'
import { installUiAppearance } from './utils/uiAppearance'
import './assets/ui-appearance.css'

const app = createApp(App)
// Keep uncaught frontend failures visible in the Android WebView instead of
// leaving a blank shell (or relying on an empty native crash notification).
let crashOverlay: HTMLElement | null = null
const MAX_CRASH_DETAIL_CHARS = 12_000
const NATIVE_WIDGET_VISIBILITY_KEY = 'cybermanju.home.native-widget-visible.v1'
function describeCrash(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown; stack?: unknown }
    if (typeof candidate.message === 'string') {
      return `${typeof candidate.name === 'string' ? `${candidate.name}: ` : ''}${candidate.message}${typeof candidate.stack === 'string' ? `\n${candidate.stack}` : ''}`
    }
    try { return JSON.stringify(error, null, 2) } catch { /* Use the safe fallback below. */ }
  }
  return String(error ?? 'Unknown error')
}
function showCrashOverlay(source: string, detail: string) {
  if (!document.body) return
  if (!crashOverlay) {
    crashOverlay = document.createElement('section')
    crashOverlay.setAttribute('role', 'alertdialog')
    crashOverlay.setAttribute('aria-modal', 'true')
    crashOverlay.setAttribute('aria-labelledby', 'cyb-crash-title')
    Object.assign(crashOverlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', overflow: 'auto',
      display: 'grid', placeItems: 'center', padding: '24px 16px',
      boxSizing: 'border-box', background: '#090b10', color: '#f4f5f8',
      fontFamily: 'system-ui, sans-serif',
    })
    document.body.append(crashOverlay)
  }
  const card = document.createElement('div')
  Object.assign(card.style, { width: 'min(680px, 100%)', display: 'grid', gap: '12px' })
  const heading = document.createElement('h1')
  heading.id = 'cyb-crash-title'
  heading.textContent = 'CyberManju OS hit an error'
  const summary = document.createElement('p')
  summary.textContent = source.trim() || 'Application error'
  const diagnostic = document.createElement('pre')
  diagnostic.textContent = detail.trim().slice(0, MAX_CRASH_DETAIL_CHARS) || 'The runtime provided no diagnostic details.'
  Object.assign(diagnostic.style, {
    maxHeight: '38vh', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    padding: '14px', border: '1px solid #454957', borderRadius: '10px', background: '#11141c',
    color: '#e4e7ef', font: '12px/1.5 ui-monospace, monospace',
  })
  const help = document.createElement('p')
  help.textContent = 'Your vault files and database are preserved. Retry, copy the diagnostics, or reset temporary app session state.'
  const actions = document.createElement('div')
  actions.setAttribute('aria-label', 'Recovery actions')
  Object.assign(actions.style, { display: 'flex', flexWrap: 'wrap', gap: '9px' })
  const button = (label: string, action: () => void) => {
    const node = document.createElement('button')
    node.type = 'button'
    node.textContent = label
    Object.assign(node.style, { minHeight: '44px', padding: '9px 14px', border: '1px solid #555b6b', borderRadius: '8px', background: '#202431', color: 'inherit', font: 'inherit', fontWeight: '700' })
    node.addEventListener('click', action)
    return node
  }
  const report = `${source.trim() || 'Application error'}\n${diagnostic.textContent}`
  actions.append(
    button('Retry app', () => window.location.reload()),
    button('Copy error details', () => {
      try { void navigator.clipboard?.writeText(report).catch(() => {}) } catch { /* Clipboard access may be unavailable in WebView. */ }
    }),
    button('Clear temporary app state and retry', () => {
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i)
          if (key !== NATIVE_WIDGET_VISIBILITY_KEY && (key?.startsWith('cybermanju:') || key?.startsWith('cybermanju_'))) sessionStorage.removeItem(key)
        }
      } catch { /* Storage can be disabled; still offer a normal restart. */ }
      window.location.reload()
    }),
  )
  card.append(heading, summary, diagnostic, help, actions)
  crashOverlay.replaceChildren(card)
}
function reportFrontendCrash(error: unknown, source: string) {
  const detail = describeCrash(error)
  showCrashOverlay(source, detail)
  console.error(`[CyberManju OS] ${source}:`, error)
}
app.config.errorHandler = (error, _instance, info) => reportFrontendCrash(error, `Vue ${info}`)
window.addEventListener('error', (event) => {
  const location = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : ''
  reportFrontendCrash(event.error || event.message, `Window error${location}`)
})
window.addEventListener('unhandledrejection', (event) => reportFrontendCrash(event.reason, 'Unhandled promise rejection'))
app.use(createPinia())
app.use(installUi)
app.use(installUiLayoutTargets)

// Publish the persisted theme before first paint (also runs at module load
// for the pre-Vue document state).
useTheme()

app.mount('#app')
const stopUiAppearance = installUiAppearance(document.body)
const stopUiLayout = installUiLayout(document.body)
if (import.meta.hot) import.meta.hot.dispose(() => { stopUiAppearance(); stopUiLayout() })
