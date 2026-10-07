// CyberManju OS — Supabase Auth bridge (static/offline builds)
//
// Why this exists: PKCE OAuth from a pure static page is impossible against
// the providers directly (GitHub demands `client_secret` + serves no CORS;
// Google's token endpoint is equally browser-hostile). Supabase Auth acts
// as the broker: OUR static page talks only to Supabase (CORS-open), and
// Supabase's server does the secret-holding exchange with the provider.
//
// Flow (all standard supabase-js v2 PKCE):
//  1. `startSupabaseOAuth()` / `startSupabaseSignIn()` —
//     `signInWithOAuth({ skipBrowserRedirect: true })` returns the Supabase
//     authorize URL (PKCE verifier stashed in localStorage by the client).
//     We open it in a popup WITHOUT `noopener` so the opener chain survives.
//  2. User approves at the provider → Supabase → redirectTo (our page,
//     `?oauth=popup`) lands *inside the popup*.
//  3. The popup boots this same bundle but takes the popup fast-path
//     (`isOAuthPopup()` → App.vue minimal view): `finishSupabaseReturn()`
//     lets the client auto-exchange `?code=` (`detectSessionInUrl`), reads
//     `session.provider_token`, records the account, postMessages the opener
//     (`cybermanju:oauth-done`) and closes itself with retries — it NEVER
//     renders the full app in the popup window.
//  4. The opener wakes on the message (or its session poll), verifies the
//     token belongs to the expected provider, closes the popup reference it
//     holds, and finalizes — CONNECTED.
// Sign-in is always FRESH (existing session signed out first), so every
// provider button stays usable and multiple accounts on the same provider
// can be added one after another; `connectedAccounts` remembers them all
// while Supabase holds the single active session.
//
// The provider token is a real provider credential (GitHub honors it as a
// token; Drive accepts the Bearer). Requested scopes are the minimum the
// sync backends need. Token expiry: GitHub OAuth tokens don't expire by
// default; Google access tokens last ~1h (no browser-safe refresh — the
// panel asks for a reconnect when Google probes fail).

import { ref } from 'vue'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { vaultDelete, vaultGet, vaultSet } from './useVault'

const URL_KEY = 'cybermanju.supabaseUrl'
const KEY_KEY = 'cybermanju.supabaseKey'
const PENDING_CFG_KEY = 'cybermanju.oauthConfigId'
const TOKEN_STASH_KEY = 'cybermanju.providerToken'
// In-file twins (`.cybermanju` → kv table) — localStorage stays the hot
// synchronous cache, the vault is the durable copy inside the file.
const VAULT_URL_KEY = 'config:supabase.url'
const VAULT_KEY_KEY = 'config:supabase.key'

export type OAuthBackend = 'github' | 'google' | 'gitlab'

export interface ProviderTokenStash {
  backend: OAuthBackend
  providerToken: string
  providerRefreshToken?: string | null
  at: number
}

let client: SupabaseClient | null = null
let clientKey = ''

function readLS(key: string): string {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeLS(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Private mode — session-only.
  }
}

export function getSupabaseConfig(): { url: string; key: string; source: string } {
  const lsUrl = readLS(URL_KEY).replace(/\/+$/, '')
  const lsKey = readLS(KEY_KEY)
  if (lsUrl || lsKey) return { url: lsUrl, key: lsKey, source: 'localStorage' }
  // Build-time fallback so GitHub Pages / static deploys work without a
  // manual paste in Settings. CI injects GH Secrets as Vite env at build
  // time (see .github/workflows/ci.yml `wasm-build`):
  //   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_KEY).
  // Local dev equivalent: a `.env` file with the same two keys.
  const envUrl = String(
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
  ).trim().replace(/\/+$/, '')
  const envKey = String(
    ((import.meta.env.VITE_SUPABASE_ANON_KEY ??
      import.meta.env.VITE_SUPABASE_KEY) as string | undefined) ?? '',
  ).trim()
  if (envUrl || envKey) return { url: envUrl, key: envKey, source: 'build-env' }
  return { url: '', key: '', source: 'none' }
}

function readConfiguredFlag(): boolean {
  const { url, key } = getSupabaseConfig()
  return url.startsWith('http') && key.length > 0
}

/**
 * Reactive mirror of the localStorage pair. localStorage itself never fires
 * Vue reactivity, so `computed(() => supabaseConfigured())` used to be
 * evaluated once and stay stale forever — saving the broker in Settings left
 * "Broker not configured" banners and blocked OAuth buttons in Accounts until
 * a full reload. Every write path below refreshes this flag.
 */
const configuredFlag = ref(readConfiguredFlag())

export function supabaseConfigured(): boolean {
  return configuredFlag.value
}

export function setSupabaseConfig(url: string, key: string) {
  const cleanUrl = url.trim().replace(/\/+$/, '')
  const cleanKey = key.trim()
  writeLS(URL_KEY, cleanUrl)
  writeLS(KEY_KEY, cleanKey)
  void (cleanUrl ? vaultSet(VAULT_URL_KEY, cleanUrl) : vaultDelete(VAULT_URL_KEY))
  void (cleanKey ? vaultSet(VAULT_KEY_KEY, cleanKey) : vaultDelete(VAULT_KEY_KEY))
  client = null
  clientKey = ''
  configuredFlag.value = cleanUrl.startsWith('http') && cleanKey.length > 0
}

export function clearSupabaseConfig() {
  writeLS(URL_KEY, '')
  writeLS(KEY_KEY, '')
  void vaultDelete(VAULT_URL_KEY)
  void vaultDelete(VAULT_KEY_KEY)
  client = null
  clientKey = ''
  configuredFlag.value = false
}

/**
 * Boot: pull the Supabase URL/key out of `.cybermanju` when localStorage is
 * empty (fresh browser, restored file, cleared site data). Writes through to
 * localStorage so `getSupabaseConfig()` stays synchronous everywhere.
 */
export async function hydrateSupabaseConfig(): Promise<boolean> {
  if (supabaseConfigured()) return false
  const [url, key] = await Promise.all([vaultGet(VAULT_URL_KEY), vaultGet(VAULT_KEY_KEY)])
  if (!url && !key) return false
  writeLS(URL_KEY, url || '')
  writeLS(KEY_KEY, key || '')
  client = null
  clientKey = ''
  configuredFlag.value = readConfiguredFlag()
  return supabaseConfigured()
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  const { url, key } = getSupabaseConfig()
  if (!url || !key) return null
  const cacheKey = `${url}|${key.slice(0, 8)}`
  if (!client || clientKey !== cacheKey) {
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(url, key, {
      auth: { flowType: 'pkce', detectSessionInUrl: true },
    })
    clientKey = cacheKey
  }
  return client
}

/** Frontend sync backend → Supabase provider slug. */
export function supabaseProviderFor(backendType: string): OAuthBackend | null {
  switch (backendType) {
    case 'github':
      return 'github'
    case 'googleDrive':
      return 'google'
    case 'gitlab':
      return 'gitlab'
    default:
      return null
  }
}

/** Minimum scopes the sync backends need from each provider. */
export function supabaseScopesFor(backendType: string): string {
  switch (backendType) {
    case 'github':
      return 'repo read:user user:email'
    case 'googleDrive':
      return 'openid email profile https://www.googleapis.com/auth/drive.file'
    case 'gitlab':
      return 'api'
    default:
      return ''
  }
}

export function setPendingOAuthConfig(configId: string | null) {
  writeLS(PENDING_CFG_KEY, configId ?? '')
}

export function getPendingOAuthConfig(): string {
  return readLS(PENDING_CFG_KEY)
}

export function stashProviderToken(stash: ProviderTokenStash) {
  writeLS(TOKEN_STASH_KEY, JSON.stringify(stash))
}

export function takeProviderTokenStash(): ProviderTokenStash | null {
  let raw = ''
  try {
    raw = localStorage.getItem(TOKEN_STASH_KEY) || ''
    localStorage.removeItem(TOKEN_STASH_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ProviderTokenStash
    if (!parsed?.providerToken) return null
    // Stale (older than 10 min) — the code lives 5 min; be generous.
    if (Date.now() - (parsed.at || 0) > 10 * 60 * 1000) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * True when THIS window is an OAuth popup we opened — not the main tab.
 * Supabase redirects back with `?code=` (or `?error=` on deny) and our
 * `redirectTo` carries the `?oauth=popup` marker while `window.opener` is
 * alive. The popup boots the same bundle, so without this check it renders
 * the whole app inside the small window and never closes.
 */
export function isOAuthPopup(): boolean {
  try {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    if (params.has('code')) return true
    if (typeof window.opener !== 'undefined' && window.opener && !window.opener.closed) {
      if (params.get('oauth') === 'popup' || params.has('error')) return true
    }
  } catch {
    return false
  }
  return false
}

/**
 * Tell the opener tab the popup flow finished. The opener treats the shared
 * session as source of truth and only uses this to wake up early — so even
 * if `window.close()` is refused, the flow still completes over there.
 */
function notifyOpenerOAuthDone(ok: boolean, provider?: string | null): void {
  try {
    if (typeof window === 'undefined' || !window.opener || window.opener.closed) return
    const msg = { type: 'cybermanju:oauth-done', ok, provider: provider ?? null }
    try {
      window.opener.postMessage(msg, window.location.origin)
    } catch {
      window.opener.postMessage(msg, '*')
    }
  } catch {
    // No opener to tell — the opener polls the shared session as fallback.
  }
}

/**
 * Aggressively close an OAuth popup. A bare `window.close()` is refused when
 * the opener chain was severed (`noopener`) or the browser wants a gesture —
 * retry on a timer. ONLY call this in a popup (`isOAuthPopup()`), never in
 * the main tab.
 */
export function closeOAuthPopup(): void {
  for (const delayMs of [0, 600, 2000]) {
    window.setTimeout(() => {
      try {
        if (window.closed) return
        window.close()
      } catch {
        // Blocked — the opener also holds a reference and closes from its
        // side; the fallback message below invites a manual close.
      }
    }, delayMs)
  }
}

/**
 * Begin PKCE OAuth without leaving the app: returns the Supabase authorize
 * URL for us to open in a popup. Throws when Supabase is not configured.
 */
export async function startSupabaseOAuth(backendType: string): Promise<{ url: string }> {
  const provider = supabaseProviderFor(backendType)
  if (!provider) throw new Error(`unsupported: no Supabase OAuth for '${backendType}'`)
  const sb = await getSupabaseClient()
  if (!sb) throw new Error('Supabase is not configured — set URL + key in Settings first')
  const redirectTo = `${window.location.origin}${window.location.pathname}?oauth=popup`
  const { data, error } = await sb.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      scopes: supabaseScopesFor(backendType) || undefined,
      skipBrowserRedirect: true,
    },
  })
  if (error || !data?.url) throw new Error(error?.message || 'Supabase did not return an authorize URL')
  return { url: data.url }
}

export async function supabaseSession(): Promise<Session | null> {
  const sb = await getSupabaseClient()
  if (!sb) return null
  const { data, error } = await sb.auth.getSession()
  if (error) return null
  return data.session
}

export async function supabaseSignOut(): Promise<void> {
  const sb = await getSupabaseClient()
  if (!sb) return
  await sb.auth.signOut()
  client = null
}

/**
 * Called once at app boot (and on the popup fast-path). If this page load
 * IS an OAuth return (`?code=`, `?error=`, or the `?oauth=popup` marker with
 * a live opener), the client auto-exchanges it (`detectSessionInUrl`) — here
 * we read the session, stash + record, clean the URL, notify the opener and
 * close popup returns. Returns true when it handled a return.
 */
export async function finishSupabaseReturn(): Promise<boolean> {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(window.location.search)
  } catch {
    return false
  }
  const code = params.get('code')
  const err = params.get('error')
  const popup = isOAuthPopup()
  if (!code && !err && !popup) return false

  const stripReturnParams = () => {
    params.delete('code')
    params.delete('error')
    params.delete('error_description')
    params.delete('oauth')
    window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`)
  }

  // No code to exchange: denied at the provider, broker missing, or a bare
  // marker. Never boot the app in a popup — tell the opener and close.
  if (!code) {
    stripReturnParams()
    if (popup) {
      notifyOpenerOAuthDone(false)
      closeOAuthPopup()
    }
    return true
  }
  if (!supabaseConfigured()) {
    // A code we can never exchange — strip it so it doesn't linger.
    stripReturnParams()
    if (popup) {
      notifyOpenerOAuthDone(false)
      closeOAuthPopup()
    }
    return true
  }
  let provider: OAuthBackend | null = null
  try {
    // `detectSessionInUrl` auto-exchanges `?code=` during client creation,
    // but the exchange races this read — one retry before giving up.
    let session = await supabaseSession()
    if (!session?.provider_token) {
      await new Promise((r) => setTimeout(r, 1200))
      session = await supabaseSession()
    }
    const token = session?.provider_token
    provider = supabaseSessionProvider(session)
    if (token) {
      stashProviderToken({
        backend: provider ?? 'github',
        providerToken: token,
        providerRefreshToken: session?.provider_refresh_token ?? null,
        at: Date.now(),
      })
    }
    // The popup path is also a sign-in: publish whoever came back.
    identity.value = identityFromSession(session)
    recordConnectedAccount(session)
    if (popup) notifyOpenerOAuthDone(true, provider)
  } catch {
    // Exchange failed (expired code, verifier mismatch) — still clean up.
    if (popup) notifyOpenerOAuthDone(false)
  }
  stripReturnParams()
  if (popup) closeOAuthPopup()
  return true
}

/** Provider slug behind a Supabase session (`user.app_metadata.provider`). */
export function supabaseSessionProvider(session: Session | null): OAuthBackend | null {
  const provider = (session?.user?.app_metadata as Record<string, unknown> | undefined)?.provider
  if (provider === 'github' || provider === 'google' || provider === 'gitlab') return provider
  return null
}

// ── Identity (OAuth sign-in — the only sign-in) ──────────────────────────
//
// There is no username/password anywhere in the app any more: the Supabase
// broker signs you in with Google, GitHub or GitLab, and the session that
// comes back IS the identity. Sessions live in supabase-js's own
// localStorage record, so a reload keeps you signed in without a token
// dance here.

export interface CyberIdentity {
  id: string
  email: string
  name: string
  avatarUrl: string
  provider: string
}

export const identity = ref<CyberIdentity | null>(null)

// ── Connected accounts (multi-account) ────────────────────────────────
//
// Supabase holds ONE active session, but users have several logins (work /
// personal, same provider twice). Every successful sign-in is recorded here
// (persisted in localStorage) so the Accounts panel can list them all and
// switch in one click: switch = sign out + fresh login with that provider,
// letting the provider's own chooser pick the account.

export interface ConnectedAccount {
  id: string
  email: string
  name: string
  avatarUrl: string
  provider: string
  lastUsed: number
}

const ACCOUNTS_KEY = 'cybermanju.connectedAccounts'

function loadConnectedAccounts(): ConnectedAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ConnectedAccount[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(a => a && typeof a.id === 'string' && typeof a.provider === 'string').slice(0, 10)
  } catch {
    return []
  }
}

export const connectedAccounts = ref<ConnectedAccount[]>(loadConnectedAccounts())

function persistConnectedAccounts(): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(connectedAccounts.value))
  } catch {
    // Private mode — memory only.
  }
}

/** Record a session's user in the remembered list (deduped by user id). */
export function recordConnectedAccount(session: Session | null): ConnectedAccount | null {
  const idn = identityFromSession(session)
  if (!idn) return null
  const acc: ConnectedAccount = {
    id: idn.id,
    email: idn.email,
    name: idn.name,
    avatarUrl: idn.avatarUrl,
    provider: idn.provider,
    lastUsed: Date.now(),
  }
  connectedAccounts.value = [acc, ...connectedAccounts.value.filter(a => a.id !== acc.id)].slice(0, 10)
  persistConnectedAccounts()
  return acc
}

/**
 * Forget a remembered account. Forgetting the ACTIVE one also ends the
 * session (there is nothing to stay signed in as).
 */
export function forgetConnectedAccount(id: string): void {
  connectedAccounts.value = connectedAccounts.value.filter(a => a.id !== id)
  persistConnectedAccounts()
  if (identity.value?.id === id) {
    identity.value = null
    void supabaseSignOut().catch(() => {})
  }
}

function identityFromSession(session: Session | null): CyberIdentity | null {
  const user = session?.user
  if (!user) return null
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    id: user.id,
    email: str(user.email),
    name: str(meta.full_name) || str(meta.name) || str(meta.preferred_username) || str(user.email) || 'Signed in',
    avatarUrl: str(meta.avatar_url) || str(meta.picture),
    provider: str(appMeta.provider) || 'supabase',
  }
}

/** Read the current session and publish it as `identity`. */
export async function refreshIdentity(): Promise<CyberIdentity | null> {
  const session = await supabaseSession()
  identity.value = identityFromSession(session)
  // Repopulate the remembered list on fresh browsers (cleared site data).
  if (session) recordConnectedAccount(session)
  return identity.value
}

/**
 * Begin sign-in with one of the Supabase-brokered providers. Returns the
 * authorize URL for a popup (same shape as `startSupabaseOAuth`).
 */
export async function startSupabaseSignIn(provider: OAuthBackend): Promise<{ url: string }> {
  const sb = await getSupabaseClient()
  if (!sb) {
    throw new Error(
      'Supabase is not configured — set the OAuth broker URL + key in Settings first'
    )
  }
  const redirectTo = `${window.location.origin}${window.location.pathname}?oauth=popup`
  const { data, error } = await sb.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      scopes: 'openid email profile',
      skipBrowserRedirect: true,
    },
  })
  if (error || !data?.url) {
    throw new Error(error?.message || 'Supabase did not return an authorize URL')
  }
  return { url: data.url }
}

/**
 * Full interactive sign-in: opens the provider in a centered popup and waits
 * for the session to land back in this tab. Every call starts FRESH — any
 * existing session is signed out first — so re-login with the same user, a
 * second account on the same provider, or another provider always lands a
 * new session (and the provider shows its account chooser). Throws when
 * popups are blocked or the flow never completes.
 */
export async function signInWithPopup(provider: OAuthBackend): Promise<CyberIdentity> {
  // Fresh login: end the previous session first so the poll below recognizes
  // ANY arriving session (same-user re-login used to hang forever here,
  // because `id !== before` could never turn true).
  await supabaseSignOut().catch(() => {})
  identity.value = null
  const { url } = await startSupabaseSignIn(provider)
  const width = 520
  const height = 640
  const left = Math.max(0, Math.round(window.screen.width / 2 - width / 2))
  const top = Math.max(0, Math.round(window.screen.height / 2 - height / 2))
  // NOTE: no `noopener` — severing the opener chain is what left the popup
  // open with the app rendered inside it (close + postMessage both need it).
  const popup = window.open(
    url,
    'cybermanju-signin',
    `width=${width},height=${height},left=${left},top=${top}`,
  )
  if (!popup) {
    throw new Error('the browser blocked the sign-in popup — allow popups for this site, then retry')
  }
  // Wake up early when the popup reports completion; the shared session in
  // localStorage stays the source of truth.
  let msgDone = false
  const onMsg = (e: MessageEvent) => {
    try {
      if (e?.data?.type === 'cybermanju:oauth-done') msgDone = true
    } catch {
      // Ignore malformed messages.
    }
  }
  window.addEventListener('message', onMsg)
  try {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700))
      const session = await supabaseSession()
      const id = identityFromSession(session)
      if (id) {
        try {
          if (!popup.closed) popup.close()
        } catch {
          // Already gone — the popup closes itself too.
        }
        identity.value = id
        recordConnectedAccount(session)
        return id
      }
      // A manually closed popup with no completion message ends the wait;
      // a self-closed popup after notifying keeps polling until the session
      // lands (or the deadline hits).
      if (popup.closed && !msgDone) break
    }
    const session = await supabaseSession()
    const id = identityFromSession(session)
    if (id) {
      identity.value = id
      recordConnectedAccount(session)
      return id
    }
  } finally {
    window.removeEventListener('message', onMsg)
  }
  throw new Error('sign-in did not complete — the popup closed before a session appeared')
}

export async function signOutIdentity(): Promise<void> {
  await supabaseSignOut()
  identity.value = null
}
