// CyberManju OS — Android action registration (src/automation/nativeActions.ts).
// Role: Expose only the five public-intent actions implemented by the Android host.
// Exports: AndroidNativeActionInputs, ANDROID_NATIVE_ACTION_SPECS, registerAndroidNativeActions.
// Integrates: registerNativeActions and crates/launcher/src/automation.rs validators.
// Contracts: Opt-in, all write-classified; exact fields, UTF-16 bounds, no generic intents or shell.
import { registerNativeActions, type NativeActionBridge, type NativeActionSpec } from './actions'
import type { ActionRegistry } from './runner'
import { copyJson, record, type Json } from './schema'

export interface AndroidNativeActionInputs {
  'android.open_url': { url: string }
  'android.open_map': { query: string; latitude?: never; longitude?: never; label?: never } |
    { query?: never; latitude: number; longitude: number; label?: string }
  'android.dial': { phone: string }
  'android.share_text': { text: string; title?: string }
  'android.create_calendar_event': {
    title: string; startsAtEpochMs: number; endsAtEpochMs: number; location?: string; description?: string
  }
}

const has = (input: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(input, key)
// Rust str::trim uses Unicode White_Space: unlike JS trim, it includes U+0085, not U+FEFF.
const trimmed = (value: string): string => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
function boundedString(value: unknown, maxUnits: number, allowNewlines = false): value is string {
  if (typeof value !== 'string' || value.length > maxUnits) return false
  for (const ch of value) {
    const code = ch.codePointAt(0)!
    // Rust strings cannot contain lone UTF-16 surrogates (serde rejects them).
    if (code >= 0xd800 && code <= 0xdfff) return false
    if ((code <= 0x1f || (code >= 0x7f && code <= 0x9f)) &&
      !(allowNewlines && (ch === '\n' || ch === '\r' || ch === '\t'))) return false
  }
  return true
}
function optionalString(input: Record<string, unknown>, key: string, maxUnits: number): boolean {
  return !has(input, key) || boundedString(input[key], maxUnits)
}
function spec(id: keyof AndroidNativeActionInputs, allowed: readonly string[], validate: (input: Record<string, unknown>) => boolean): Readonly<NativeActionSpec> {
  return Object.freeze({ id, effect: 'write' as const, validateInput(input: Json): boolean {
    // The runner already snapshots JSON; keep direct registry validation safe as well.
    try {
      const value = copyJson(input, 64 * 1024)
      return record(value) && Object.keys(value).every(key => allowed.includes(key)) && validate(value)
    } catch { return false }
  } })
}

/** Closed, immutable v1 catalog; importing it does not install a bridge or grant permissions. */
export const ANDROID_NATIVE_ACTION_SPECS: readonly Readonly<NativeActionSpec>[] = Object.freeze([
  spec('android.open_url', ['url'], input => {
    if (!boundedString(input.url, 2048)) return false
    try {
      const url = new URL(input.url)
      const separator = input.url.indexOf('://')
      const authority = separator < 0 ? '' : input.url.slice(separator + 3).split(/[/?#]/, 1)[0]
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' &&
        url.username === '' && url.password === '' && !authority.includes('@')
    } catch { return false }
  }),
  spec('android.open_map', ['query', 'latitude', 'longitude', 'label'], input => {
    if (!optionalString(input, 'query', 512) || !optionalString(input, 'label', 256)) return false
    if (has(input, 'query')) return !has(input, 'latitude') && !has(input, 'longitude') &&
      !has(input, 'label') && trimmed(input.query as string) !== ''
    return typeof input.latitude === 'number' && Number.isFinite(input.latitude) &&
      input.latitude >= -90 && input.latitude <= 90 && typeof input.longitude === 'number' &&
      Number.isFinite(input.longitude) && input.longitude >= -180 && input.longitude <= 180
  }),
  spec('android.dial', ['phone'], input => {
    if (!boundedString(input.phone, 64)) return false
    const phone = trimmed(input.phone)
    if (!/^\+?[0-9 .()-]*$/.test(phone)) return false
    const digits = phone.replace(/[^0-9]/g, '').length
    return digits >= 3 && digits <= 32
  }),
  spec('android.share_text', ['text', 'title'], input => boundedString(input.text, 16_000, true) &&
    trimmed(input.text) !== '' && optionalString(input, 'title', 120)),
  spec('android.create_calendar_event', ['title', 'startsAtEpochMs', 'endsAtEpochMs', 'location', 'description'], input =>
    boundedString(input.title, 256) && trimmed(input.title) !== '' &&
    typeof input.startsAtEpochMs === 'number' && Number.isSafeInteger(input.startsAtEpochMs) &&
    typeof input.endsAtEpochMs === 'number' && Number.isSafeInteger(input.endsAtEpochMs) &&
    input.startsAtEpochMs < input.endsAtEpochMs && optionalString(input, 'location', 512) &&
    optionalString(input, 'description', 4000)),
])

/** Register the implemented Android intents with a host-supplied bridge and runner authorization. */
export function registerAndroidNativeActions(registry: ActionRegistry, bridge: NativeActionBridge): void {
  registerNativeActions(registry, ANDROID_NATIVE_ACTION_SPECS, bridge)
}
