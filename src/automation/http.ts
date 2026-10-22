// CyberManju OS — Automation HTTP transport (src/automation/http.ts).
// Role: provide bounded, allowlisted HTTP requests for isolated secure workflows.
// Exports: createHttpHandler(options) and its input/options/result interfaces.
// Integrates: standard Fetch API only; DNS pinning remains the native transport's responsibility.
// Contracts: HTTPS origins only, no redirects/retries, streamed byte caps, fixed public error codes.
import { copyJson, LIMITS } from './schema'

export interface HttpHandlerOptions {
  allowedOrigins: readonly string[]
  fetch?: typeof fetch
  resolveSecret?: (ref: string) => Promise<string>
  maxTimeoutMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
}
export interface HttpInput {
  url: string
  method?: string
  headers?: Record<string, string | { secretRef: string }>
  body?: string
  timeoutMs?: number
}
export interface HttpResult { status: number; headers: Record<string, string>; body: string }

const TIMEOUT_DEFAULT = 10_000
const TIMEOUT_HARD = 30_000
const REQUEST_HARD = 65_536
const RESPONSE_HARD = 1_048_576
const URL_HARD = 8_192
const HEADER_COUNT_HARD = 64
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
const FORBIDDEN = new Set(['host', 'cookie', 'proxy-authorization', 'www-authenticate'])
const SAFE = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'x-requested-with', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since', 'range', 'cache-control'])
const SECRET_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PUBLIC_ERRORS = new Set(['invalid_input', 'invalid_url', 'origin_denied', 'method_denied', 'request_too_large', 'header_denied', 'secret_denied', 'secret_unavailable', 'secret_response', 'response_too_large', 'aborted', 'timeout'])
function fail(code: string): never { throw new Error(code) }
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const validLimit = (v: unknown, fallback: number, hard: number): number => {
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) fail('invalid_config')
  return Math.min(v, hard)
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

export function createHttpHandler(options: HttpHandlerOptions): (input: unknown, signal?: AbortSignal) => Promise<HttpResult> {
  if (!isRecord(options) || !Array.isArray(options.allowedOrigins) || options.allowedOrigins.length === 0) fail('invalid_config')
  const origins = new Set<string>()
  for (const origin of options.allowedOrigins) {
    if (typeof origin !== 'string') fail('invalid_config')
    try {
      const parsed = new URL(origin)
      if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) fail('invalid_config')
      origins.add(parsed.origin)
    } catch { fail('invalid_config') }
  }
  if (options.maxTimeoutMs !== undefined && (typeof options.maxTimeoutMs !== 'number' || !Number.isSafeInteger(options.maxTimeoutMs) || options.maxTimeoutMs < 1)) fail('invalid_config')
  const maxTimeout = Math.min(options.maxTimeoutMs ?? TIMEOUT_HARD, TIMEOUT_HARD)
  const maxReq = validLimit(options.maxRequestBytes, REQUEST_HARD, REQUEST_HARD)
  const maxRes = validLimit(options.maxResponseBytes, RESPONSE_HARD, RESPONSE_HARD)
  const doFetch = options.fetch ?? globalThis.fetch
  const resolveSecret = options.resolveSecret
  if (typeof doFetch !== 'function') fail('invalid_config')

  return async (input: unknown, externalSignal?: AbortSignal): Promise<HttpResult> => {
    // Snapshot before reading fields or awaiting a vault lookup. No getters or inherited inputs.
    try { input = copyJson(input, LIMITS.jsonBytes) } catch { fail('invalid_input') }
    if (!isRecord(input) || !exactKeys(input, ['url', ...(Object.keys(input).filter(k => k !== 'url'))]) || Object.keys(input).some(k => !['url', 'method', 'headers', 'body', 'timeoutMs'].includes(k)) || typeof input.url !== 'string' || (input.method !== undefined && typeof input.method !== 'string') || (input.body !== undefined && typeof input.body !== 'string') || (input.headers !== undefined && !isRecord(input.headers))) fail('invalid_input')
    if (new TextEncoder().encode(input.url).byteLength > URL_HARD) fail('invalid_url')
    let url: URL
    try { url = new URL(input.url) } catch { return fail('invalid_url') }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('invalid_url')
    if (!origins.has(url.origin)) fail('origin_denied')
    const method = (input.method ?? 'GET').toUpperCase()
    if (!METHODS.has(method)) fail('method_denied')
    if (input.timeoutMs !== undefined && (typeof input.timeoutMs !== 'number' || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1)) fail('invalid_input')
    const timeout = Math.min(input.timeoutMs ?? TIMEOUT_DEFAULT, maxTimeout)
    const body = input.body as string | undefined
    if ((method === 'GET' || method === 'HEAD') && body !== undefined) fail('invalid_input')
    const encoder = new TextEncoder()
    let requestBytes = body === undefined ? 0 : encoder.encode(body).byteLength
    if (requestBytes > maxReq) fail('request_too_large')
    const rawHeaders = (input.headers ?? {}) as Record<string, unknown>
    if (Object.keys(rawHeaders).length > HEADER_COUNT_HARD) fail('header_denied')
    const headers = new Headers()
    const resolvedSecrets = new Set<string>()
    const controller = new AbortController()
    let timedOut = false
    const onAbort = () => controller.abort()
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeout)
    if (externalSignal?.aborted) controller.abort()
    else externalSignal?.addEventListener('abort', onAbort, { once: true })
    const abortCode = () => externalSignal?.aborted ? 'aborted' : 'timeout'
    const checkAbort = () => { if (controller.signal.aborted) fail(abortCode()) }
    const raceAbort = <T>(promise: Promise<T>): Promise<T> => {
      if (controller.signal.aborted) return Promise.reject(new Error(abortCode()))
      return new Promise<T>((resolve, reject) => {
        const onControllerAbort = () => reject(new Error(abortCode()))
        controller.signal.addEventListener('abort', onControllerAbort, { once: true })
        promise.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', onControllerAbort))
      })
    }
    try {
      checkAbort()
      for (const [name, raw] of Object.entries(rawHeaders)) {
        checkAbort()
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) fail('header_denied')
        const lower = name.toLowerCase()
        if (FORBIDDEN.has(lower) || (!SAFE.has(lower) && lower !== 'authorization')) fail('header_denied')
        let value: string
        if (lower === 'authorization') {
          if (!isRecord(raw) || !exactKeys(raw, ['secretRef']) || typeof raw.secretRef !== 'string' || !SECRET_REF.test(raw.secretRef) || !resolveSecret) fail('secret_denied')
          try { value = await raceAbort(Promise.resolve().then(() => { checkAbort(); return resolveSecret(raw.secretRef as string) })) } catch (error) {
            if (controller.signal.aborted) fail(abortCode())
            return fail('secret_unavailable')
          }
          if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) fail('secret_unavailable')
          resolvedSecrets.add(value.trim())
          const credential = /^(?:Bearer|Basic)\s+(.+)$/i.exec(value.trim())
          if (credential) resolvedSecrets.add(credential[1])
        } else {
          if (typeof raw !== 'string') fail('header_denied')
          value = raw
        }
        if (/[\r\n]/.test(value)) fail('header_denied')
        requestBytes += encoder.encode(name).byteLength + encoder.encode(value).byteLength
        if (requestBytes > maxReq) fail('request_too_large')
        try { headers.set(name, value) } catch { fail('header_denied') }
      }
      checkAbort()
      const response = await raceAbort(Promise.resolve().then(() => {
        checkAbort()
        return doFetch(url.href, { method, headers, body, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal })
      }))
      if (response.status >= 300 && response.status < 400) fail('network_error')
      const outHeaders: Record<string, string> = {}
      const contentType = response.headers.get('content-type')
      if (contentType !== null) outHeaders['content-type'] = contentType
      let output = ''
      if (method !== 'HEAD' && response.body) {
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        let aborted = false
        try {
          while (true) {
            checkAbort()
            let removeAbortListener: () => void = () => undefined
            const abortRead = new Promise<never>((_, reject) => {
              const onReadAbort = () => reject(new Error(abortCode()))
              removeAbortListener = () => controller.signal.removeEventListener('abort', onReadAbort)
              if (controller.signal.aborted) onReadAbort()
              else controller.signal.addEventListener('abort', onReadAbort, { once: true })
            })
            let result: ReadableStreamReadResult<Uint8Array>
            try { result = await Promise.race([reader.read(), abortRead]) }
            catch (error) {
              removeAbortListener()
              if (controller.signal.aborted) {
                aborted = true
                void reader.cancel().catch(() => undefined)
                fail(abortCode())
              }
              throw error
            } finally { removeAbortListener() }
            if (result.done) break
            size += result.value.byteLength
            if (size > maxRes) {
              void reader.cancel().catch(() => undefined)
              fail('response_too_large')
            }
            chunks.push(result.value)
          }
        } finally {
          if (controller.signal.aborted && !aborted) void reader.cancel().catch(() => undefined)
          reader.releaseLock()
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        output = new TextDecoder().decode(bytes)
      }
      // Reject known plaintext echoes rather than publishing credentials in workflow outputs.
      if ([...resolvedSecrets].some(secret => output.includes(secret) || contentType?.includes(secret))) fail('secret_response')
      return { status: response.status, headers: outHeaders, body: output }
    } catch (error) {
      if (error instanceof Error && PUBLIC_ERRORS.has(error.message)) throw error
      if (controller.signal.aborted) fail(abortCode())
      fail('network_error')
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onAbort)
    }
  }
}
