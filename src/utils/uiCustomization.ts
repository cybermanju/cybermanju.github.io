// CyberManju OS — UI customization profiles (src/utils/uiCustomization.ts).
// Role: export and restore portable TOML profiles for theme, positions, sizes and component appearances.
// Exports: exportUiCustomizationToml, importUiCustomizationToml, downloadUiCustomizationToml.
// Integrates: useTheme, uiLayout, uiAppearance, home, launcher, dock, wallpaper and transfer-layout persistence.
// Contracts: versioned bounded profiles; remote images are fetched as images and embedded before saving/export.
import { useTheme } from '@/composables/useTheme'
import type { ThemeSettings } from '@/ui/tokens'
import { exportUiLayoutState, importUiLayoutState, validateUiLayout, validateUiLayoutSizes } from '@/utils/uiLayout'
import { exportUiAppearanceState, importUiAppearanceState, validateUiAppearance, type UiAppearanceMap } from '@/utils/uiAppearance'
import { HOME_LAYOUT_KEY, DESKTOP_HOME_LAYOUT_KEY, readHomeLayout } from '@/utils/homeLayout'
import { HOME_WORKSPACE_KEY, normalizeHomeState } from '@/utils/homeWorkspaces'
import { useLauncherStore } from '@/stores/launcher'
import type { OverrideMap } from '@/utils/launcher'
import { useDock, type DockLayout, type DockVisibility } from '@/composables/useDock'
import { useCustomWallpaper } from '@/composables/useCustomWallpaper'
import { TRANSFER_LAYOUT_KEY } from '@/utils/transferPlan'

const MAX_PROFILE_BYTES = 32 * 1024 * 1024
const MAX_IMAGE_BYTES = 256 * 1024

function tomlString(value: unknown): string { return JSON.stringify(JSON.stringify(value)) }

function parseTomlProfile(source: string): Record<string, unknown> {
  if (new TextEncoder().encode(source).byteLength > MAX_PROFILE_BYTES) throw new Error('Theme profile is larger than 32 MiB.')
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
function readString(key: string, fallback = ''): string { try { return localStorage.getItem(key) ?? fallback } catch { return fallback } }
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

function boundedPoint(input: unknown, keys: ['x', 'y'] | ['left', 'top']): Record<string, number> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const point = input as Record<string, unknown>
  if (!keys.every(key => typeof point[key] === 'number' && Number.isFinite(point[key]))) return null
  return { [keys[0]]: Math.max(-10000, Math.min(10000, point[keys[0]] as number)), [keys[1]]: Math.max(-10000, Math.min(10000, point[keys[1]] as number)) }
}

function normalizePersonalization(input: unknown) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const dock = source.dock && typeof source.dock === 'object' ? source.dock as Record<string, unknown> : {}
  const keybindings: Record<string, string> = Object.create(null)
  if (source.keybindings && typeof source.keybindings === 'object' && !Array.isArray(source.keybindings)) {
    for (const [key, value] of Object.entries(source.keybindings as Record<string, unknown>).slice(0, 500)) if (key.length <= 256 && typeof value === 'string' && value.length <= 128) keybindings[key] = value
  }
  const transfer: Record<string, { x: number; y: number }> = Object.create(null)
  if (source.transferLayout && typeof source.transferLayout === 'object' && !Array.isArray(source.transferLayout)) {
    for (const [key, value] of Object.entries(source.transferLayout as Record<string, unknown>).slice(0, 500)) {
      const point = boundedPoint(value, ['x', 'y'])
      if (point && key.length <= 256) transfer[key] = point as { x: number; y: number }
    }
  }
  return {
    dock: { layout: dock.layout === 'full' ? 'full' : 'centered', visibility: dock.visibility === 'autohide' ? 'autohide' : 'fixed' },
    desktopDockPosition: boundedPoint(source.desktopDockPosition, ['x', 'y']),
    shortcutDockPosition: boundedPoint(source.shortcutDockPosition, ['left', 'top']),
    panelDocked: source.panelDocked === '1' ? '1' : '0',
    terminalFontSize: typeof source.terminalFontSize === 'number' && Number.isFinite(source.terminalFontSize) ? Math.max(10, Math.min(22, Math.round(source.terminalFontSize))) : 14,
    transferLayout: transfer,
    keybindings,
  }
}

async function exportWallpaper() {
  const record = await useCustomWallpaper().exportRecord()
  if (!record) return null
  if (record.kind === 'url') return { kind: 'url', url: record.url }
  const data = `data:${record.mimeType};base64,${encodeBase64(new Uint8Array(await record.blob.arrayBuffer()))}`
  return { kind: 'file', name: record.name.slice(0, 256), mimeType: record.mimeType, data }
}

function decodeWallpaper(input: unknown): { kind: 'url'; url: string } | { kind: 'file'; blob: Blob; name: string; mimeType: string } | null {
  if (input === null || input === undefined) return null
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Theme profile wallpaper data is invalid.')
  const value = input as Record<string, unknown>
  if (value.kind === 'url' && typeof value.url === 'string') {
    return { kind: 'url', url: value.url }
  }
  if (value.kind !== 'file' || typeof value.name !== 'string' || typeof value.mimeType !== 'string' || typeof value.data !== 'string') throw new Error('Theme profile wallpaper data is invalid.')
  const match = value.data.match(/^data:(image\/(?:avif|gif|jpe?g|png|webp));base64,([a-z0-9+/]+=*)$/i)
  if (!match || match[1]!.toLowerCase() !== value.mimeType.toLowerCase()) throw new Error('Theme profile wallpaper image is invalid.')
  let binary: string
  try { binary = atob(match[2]!) } catch { throw new Error('Theme profile wallpaper image is invalid.') }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  const blob = new Blob([bytes], { type: match[1]!.toLowerCase() })
  return { kind: 'file', blob, name: value.name.slice(0, 256), mimeType: match[1]!.toLowerCase() }
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
  const personalization = normalizePersonalization({
    dock: readJson('cybermanju_dock_v1'),
    desktopDockPosition: readJson('cybermanju_desktop_dock_position_v1'),
    shortcutDockPosition: readJson('cybermanju_shell_shortcut_dock_position_v1'),
    panelDocked: readString('cybermanju_panel_docked', '0'),
    terminalFontSize: Number(readString('cybermanju.term.fontSize', '14')),
    transferLayout: readJson(TRANSFER_LAYOUT_KEY),
    keybindings: readJson('cybermanju_keybindings'),
  })
  const wallpaper = await exportWallpaper()
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
    `ui_personalization_json = ${tomlString(personalization)}`,
    `wallpaper_json = ${tomlString(wallpaper)}`,
    `launcher_json = ${tomlString({ overrides: launcherOverrides, favorites: launcher.favorites, drawerDisplay: launcher.drawerDisplay })}`,
    '',
  ].join('\n')
  if (new TextEncoder().encode(content).byteLength > MAX_PROFILE_BYTES) throw new Error('Customized profile is larger than the 32 MiB TOML export limit. Remove or resize custom images and wallpapers, then try again.')
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
  const hasExtraPersonalization = Object.prototype.hasOwnProperty.call(profile, 'ui_personalization_json')
  const personalization = hasExtraPersonalization ? normalizePersonalization(profile.ui_personalization_json) : null
  const wallpaper = Object.prototype.hasOwnProperty.call(profile, 'wallpaper_json') ? decodeWallpaper(profile.wallpaper_json) : undefined
  // All untrusted data is normalized before any persisted state changes.
  useTheme().importSettings(profile.theme_json as Partial<ThemeSettings>)
  importUiLayoutState(layout)
  importUiAppearanceState(appearance)
  localStorage.setItem(HOME_WORKSPACE_KEY, JSON.stringify(homeScreens))
  localStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(homeLayout))
  localStorage.setItem(DESKTOP_HOME_LAYOUT_KEY, JSON.stringify(desktopHomeLayout))
  if (personalization) {
    localStorage.setItem('cybermanju_dock_v1', JSON.stringify(personalization.dock))
    localStorage.setItem('cybermanju_desktop_dock_position_v1', JSON.stringify(personalization.desktopDockPosition || { x: 0, y: 0 }))
    if (personalization.shortcutDockPosition) localStorage.setItem('cybermanju_shell_shortcut_dock_position_v1', JSON.stringify(personalization.shortcutDockPosition))
    else localStorage.removeItem('cybermanju_shell_shortcut_dock_position_v1')
    localStorage.setItem('cybermanju_panel_docked', personalization.panelDocked)
    localStorage.setItem('cybermanju.term.fontSize', String(personalization.terminalFontSize))
    localStorage.setItem(TRANSFER_LAYOUT_KEY, JSON.stringify(personalization.transferLayout))
    localStorage.setItem('cybermanju_keybindings', JSON.stringify(personalization.keybindings))
    const dock = useDock()
    dock.setLayout(personalization.dock.layout as DockLayout)
    dock.setVisibility(personalization.dock.visibility as DockVisibility)
  }
  if (wallpaper !== undefined && !await useCustomWallpaper().restoreRecord(wallpaper)) throw new Error('The wallpaper from this profile could not be restored.')
  window.dispatchEvent(new Event('cybermanju:ui-personalization-import'))
  window.dispatchEvent(new Event('cybermanju:home-workspaces-import'))
  window.dispatchEvent(new Event('cybermanju:home-layout-import'))
  const launcher = useLauncherStore()
  launcher.overrides = launcherOverrides
  if (Array.isArray(rawLauncher.favorites)) launcher.setFavorites(rawLauncher.favorites.filter((panel): panel is string => typeof panel === 'string'))
  if (rawLauncher.drawerDisplay === 'names' || rawLauncher.drawerDisplay === 'list' || rawLauncher.drawerDisplay === 'icons' || rawLauncher.drawerDisplay === 'both') launcher.setDrawerDisplay(rawLauncher.drawerDisplay)
}

export async function downloadUiCustomizationToml(): Promise<void> {
  const blob = new Blob([await exportUiCustomizationToml()], { type: 'application/toml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'cybermanju-theme.toml'
  document.body.append(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
