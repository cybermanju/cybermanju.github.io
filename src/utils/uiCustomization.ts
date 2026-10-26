// CyberManju OS — UI customization profiles (src/utils/uiCustomization.ts).
// Role: export and restore portable TOML profiles for theme, positions, sizes and component appearances.
// Exports: exportUiCustomizationToml, importUiCustomizationToml, downloadUiCustomizationToml.
// Integrates: useTheme, uiLayout and uiAppearance persistence.
// Contracts: versioned bounded profiles; remote images are fetched as images and embedded before saving/export.
import { useTheme } from '@/composables/useTheme'
import type { ThemeSettings } from '@/ui/tokens'
import { exportUiLayoutState, importUiLayoutState, validateUiLayout, validateUiLayoutSizes } from '@/utils/uiLayout'
import { exportUiAppearanceState, importUiAppearanceState, validateUiAppearance, type UiAppearanceMap } from '@/utils/uiAppearance'

const MAX_PROFILE_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_BYTES = 256 * 1024

function tomlString(value: unknown): string { return JSON.stringify(JSON.stringify(value)) }

function parseTomlProfile(source: string): Record<string, unknown> {
  if (new TextEncoder().encode(source).byteLength > MAX_PROFILE_BYTES) throw new Error('Theme profile is larger than 8 MiB.')
  const result: Record<string, unknown> = Object.create(null)
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('[')) continue
    const match = line.match(/^([a-z][a-z0-9_]*)\s*=\s*("(?:\\.|[^"\\])*"|\d+)\s*(?:#.*)?$/i)
    if (!match) throw new Error(`Invalid theme TOML near: ${line.slice(0, 80)}`)
    let value: unknown
    try { value = JSON.parse(match[2]!) } catch { throw new Error(`Invalid TOML value for ${match[1]}.`) }
    if (typeof value === 'string' && ['theme_json', 'positions_json', 'sizes_json', 'appearance_json'].includes(match[1]!)) {
      try { value = JSON.parse(value) } catch { throw new Error(`Invalid JSON payload in ${match[1]}.`) }
    }
    result[match[1]!] = value
  }
  if (result.format !== 1) throw new Error('Unsupported theme profile format.')
  return result
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

async function imageAsDataUrl(value: string): Promise<string> {
  if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/]+=*$/i.test(value) && value.length <= Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 64) return value
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Background images must be a base64 data URL or an HTTPS image URL.') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS image URLs can be imported.')
  const response = await fetch(url.href, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif' } })
  if (!response.ok) throw new Error(`Could not fetch theme image (HTTP ${response.status}).`)
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || ''
  if (!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(type)) throw new Error('The theme URL did not return a supported image.')
  const announcedSize = Number(response.headers.get('content-length') || 0)
  if (announcedSize > MAX_IMAGE_BYTES) throw new Error('Theme images are limited to 256 KiB each.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Theme images are limited to 256 KiB each.')
  return `data:${type};base64,${encodeBase64(bytes)}`
}

async function embedAppearanceImages(input: unknown): Promise<UiAppearanceMap> {
  const normalized: Record<string, unknown> = Object.create(null)
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [id, raw] of Object.entries(input).slice(0, 300)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const item = { ...(raw as Record<string, unknown>) }
      if (item.kind === 'image' && typeof item.value === 'string') item.value = await imageAsDataUrl(item.value)
      if (item.kind === 'style' && typeof item.backgroundImage === 'string') item.backgroundImage = await imageAsDataUrl(item.backgroundImage)
      normalized[id] = item
    }
  }
  const appearance = validateUiAppearance(normalized)
  return appearance
}

export function exportUiCustomizationToml(): string {
  const theme = useTheme()
  const settings = { ...theme.settings, shell: theme.shellStyle.value }
  const layout = exportUiLayoutState()
  const appearance = exportUiAppearanceState()
  return [
    '# CyberManju OS theme and layout profile. Image values are base64 data URLs.',
    'format = 1',
    `theme_json = ${tomlString(settings)}`,
    `positions_json = ${tomlString(layout.positions)}`,
    `sizes_json = ${tomlString(layout.sizes)}`,
    `appearance_json = ${tomlString(appearance)}`,
    '',
  ].join('\n')
}

export async function importUiCustomizationToml(source: string): Promise<void> {
  const profile = parseTomlProfile(source)
  if (!profile.theme_json || typeof profile.theme_json !== 'object' || Array.isArray(profile.theme_json)) throw new Error('Theme profile has no valid theme settings.')
  const layout = { positions: validateUiLayout(profile.positions_json), sizes: validateUiLayoutSizes(profile.sizes_json) }
  const appearance = await embedAppearanceImages(profile.appearance_json)
  // All untrusted data is normalized before any persisted state changes.
  useTheme().importSettings(profile.theme_json as Partial<ThemeSettings>)
  importUiLayoutState(layout)
  importUiAppearanceState(appearance)
}

export function downloadUiCustomizationToml(): void {
  const blob = new Blob([exportUiCustomizationToml()], { type: 'application/toml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'cybermanju-theme.toml'; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
