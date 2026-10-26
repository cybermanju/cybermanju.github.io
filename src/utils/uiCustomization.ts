// CyberManju OS — UI customization profiles (src/utils/uiCustomization.ts).
// Role: export and restore portable TOML profiles for theme, positions, sizes and component appearances.
// Exports: exportUiCustomizationToml, importUiCustomizationToml, downloadUiCustomizationToml.
// Integrates: useTheme, uiLayout and uiAppearance persistence.
// Contracts: versioned bounded profiles; remote images are fetched as images and embedded before saving/export.
import { useTheme } from '@/composables/useTheme'
import type { ThemeSettings } from '@/ui/tokens'
import { exportUiLayoutState, importUiLayoutState, validateUiLayout, validateUiLayoutSizes } from '@/utils/uiLayout'
import { exportUiAppearanceState, importUiAppearanceState, validateUiAppearance, type UiAppearanceMap } from '@/utils/uiAppearance'
import { HOME_LAYOUT_KEY, DESKTOP_HOME_LAYOUT_KEY, readHomeLayout } from '@/utils/homeLayout'
import { HOME_WORKSPACE_KEY, normalizeHomeState } from '@/utils/homeWorkspaces'
import { useLauncherStore } from '@/stores/launcher'
import type { OverrideMap } from '@/utils/launcher'

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
    if (typeof value === 'string' && match[1]!.endsWith('_json')) {
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

async function imageAsDataUrl(value: string, maxBytes = MAX_IMAGE_BYTES): Promise<string> {
  if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/]+=*$/i.test(value) && value.length <= Math.ceil(maxBytes * 4 / 3) + 64) return value
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Background images must be a base64 data URL or an HTTPS image URL.') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS image URLs can be imported.')
  const response = await fetch(url.href, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif' } })
  if (!response.ok) throw new Error(`Could not fetch theme image (HTTP ${response.status}).`)
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || ''
  if (!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(type)) throw new Error('The theme URL did not return a supported image.')
  const announcedSize = Number(response.headers.get('content-length') || 0)
  if (announcedSize > maxBytes) throw new Error(`Theme images are limited to ${Math.round(maxBytes / 1024)} KiB each.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.length || bytes.length > maxBytes) throw new Error(`Theme images are limited to ${Math.round(maxBytes / 1024)} KiB each.`)
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
      if ((item.kind === 'icon' || item.kind === 'image') && item.style && typeof item.style === 'object' && typeof (item.style as Record<string, unknown>).backgroundImage === 'string') {
        item.style = { ...(item.style as Record<string, unknown>), backgroundImage: await imageAsDataUrl((item.style as Record<string, string>).backgroundImage!) }
      }
      if (item.kind === 'style' && item.icon && typeof item.icon === 'object' && (item.icon as Record<string, unknown>).kind === 'image' && typeof (item.icon as Record<string, unknown>).value === 'string') {
        item.icon = { ...(item.icon as Record<string, unknown>), value: await imageAsDataUrl((item.icon as Record<string, string>).value!) }
      }
      normalized[id] = item
    }
  }
  const appearance = validateUiAppearance(normalized)
  return appearance
}
function readJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}
function readHomeLayoutSafe(key: string) {
  try { return readHomeLayout(localStorage.getItem(key)) } catch { return readHomeLayout(null) }
}
function normalizeLauncher(input: unknown): OverrideMap {
  const output: OverrideMap = Object.create(null)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output
  for (const [key, raw] of Object.entries(input).slice(0, 500)) {
    if (!key || key.length > 256 || ['__proto__', 'prototype', 'constructor'].includes(key) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    output[key] = {
      alias: typeof item.alias === 'string' ? item.alias.slice(0, 48) : '',
      order: typeof item.order === 'number' && Number.isFinite(item.order) ? Math.floor(item.order) : -1,
      customIcon: typeof item.customIcon === 'string' ? item.customIcon.slice(0, 200_000) : '',
      iconPack: typeof item.iconPack === 'string' ? item.iconPack.slice(0, 256) : '',
      hidden: item.hidden === true,
    }
  }
  return output
}

export async function exportUiCustomizationToml(): Promise<string> {
  const theme = useTheme()
  const settings = { ...theme.settings, shell: theme.shellStyle.value }
  const layout = exportUiLayoutState()
  const appearance = await embedAppearanceImages(exportUiAppearanceState())
  const launcher = useLauncherStore()
  const launcherOverrides = normalizeLauncher(launcher.overrides)
  for (const item of Object.values(launcherOverrides)) if (item.customIcon) item.customIcon = await imageAsDataUrl(item.customIcon, 150 * 1024)
  const homeScreens = normalizeHomeState(readJson(HOME_WORKSPACE_KEY), [])
  const homeLayout = readHomeLayoutSafe(HOME_LAYOUT_KEY)
  const desktopHomeLayout = readHomeLayoutSafe(DESKTOP_HOME_LAYOUT_KEY)
  const content = [
    '# CyberManju OS theme and layout profile. Image values are base64 data URLs.',
    'format = 1',
    `theme_json = ${tomlString(settings)}`,
    `positions_json = ${tomlString(layout.positions)}`,
    `sizes_json = ${tomlString(layout.sizes)}`,
    `appearance_json = ${tomlString(appearance)}`,
    `home_screens_json = ${tomlString(homeScreens)}`,
    `home_layout_json = ${tomlString(homeLayout)}`,
    `desktop_home_layout_json = ${tomlString(desktopHomeLayout)}`,
    `launcher_json = ${tomlString({ overrides: launcherOverrides, favorites: launcher.favorites, drawerDisplay: launcher.drawerDisplay })}`,
    '',
  ].join('\n')
  if (new TextEncoder().encode(content).byteLength > MAX_PROFILE_BYTES) throw new Error('Customized theme is larger than the 8 MiB TOML export limit. Remove a few large custom images and try again.')
  return content
}

export async function importUiCustomizationToml(source: string): Promise<void> {
  const profile = parseTomlProfile(source)
  if (!profile.theme_json || typeof profile.theme_json !== 'object' || Array.isArray(profile.theme_json)) throw new Error('Theme profile has no valid theme settings.')
  const layout = { positions: validateUiLayout(profile.positions_json), sizes: validateUiLayoutSizes(profile.sizes_json) }
  const appearance = await embedAppearanceImages(profile.appearance_json)
  const rawLauncher = profile.launcher_json && typeof profile.launcher_json === 'object' ? profile.launcher_json as Record<string, unknown> : {}
  const launcherOverrides = normalizeLauncher(rawLauncher.overrides)
  for (const item of Object.values(launcherOverrides)) if (item.customIcon) item.customIcon = await imageAsDataUrl(item.customIcon, 150 * 1024)
  const homeScreens = normalizeHomeState(profile.home_screens_json, [])
  const homeLayout = readHomeLayout(JSON.stringify(profile.home_layout_json))
  const desktopHomeLayout = readHomeLayout(JSON.stringify(profile.desktop_home_layout_json))
  // All untrusted data is normalized before any persisted state changes.
  useTheme().importSettings(profile.theme_json as Partial<ThemeSettings>)
  importUiLayoutState(layout)
  importUiAppearanceState(appearance)
  localStorage.setItem(HOME_WORKSPACE_KEY, JSON.stringify(homeScreens))
  localStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(homeLayout))
  localStorage.setItem(DESKTOP_HOME_LAYOUT_KEY, JSON.stringify(desktopHomeLayout))
  window.dispatchEvent(new Event('cybermanju:home-workspaces-import'))
  window.dispatchEvent(new Event('cybermanju:home-layout-import'))
  const launcher = useLauncherStore()
  launcher.overrides = launcherOverrides
  if (Array.isArray(rawLauncher.favorites)) launcher.setFavorites(rawLauncher.favorites.filter((panel): panel is string => typeof panel === 'string'))
  if (rawLauncher.drawerDisplay === 'names' || rawLauncher.drawerDisplay === 'icons' || rawLauncher.drawerDisplay === 'both') launcher.setDrawerDisplay(rawLauncher.drawerDisplay)
}

export async function downloadUiCustomizationToml(): Promise<void> {
  const blob = new Blob([await exportUiCustomizationToml()], { type: 'application/toml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'cybermanju-theme.toml'
  document.body.append(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
