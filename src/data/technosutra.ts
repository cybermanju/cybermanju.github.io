// CyberManju OS — Techno Sutra routes (src/data/technosutra.ts).
// Role: centralize the upstream route contract for the embedded Techno Sutra app.
// Exports: TECHNOSUTRA_BASE_URL, TECHNOSUTRA_SOURCE_URL, TECHNOSUTRA_ROUTES, TechnosutraRouteId, technosutraRouteUrl, technosutraFrameAllow.
// Integrates: standalone route data consumed by the Technosutra panel.
// Contracts: route URLs remain on the official Techno Sutra origin; AR defaults to model 1.

export const TECHNOSUTRA_BASE_URL = 'https://technosutra.bhumisparshaschool.org/'
export const TECHNOSUTRA_SOURCE_URL = 'https://github.com/technosutra21/technosutra'

export type TechnosutraRouteId = 'home' | 'gallery' | 'map' | 'ar'

export const TECHNOSUTRA_ROUTES: ReadonlyArray<{
  id: TechnosutraRouteId
  label: string
  path: string
}> = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'gallery', label: 'Gallery', path: '/galeria.html' },
  { id: 'map', label: 'Map', path: '/map.html' },
  { id: 'ar', label: 'AR experience', path: '/AR.html?model=1' },
]

export function technosutraRouteUrl(route: TechnosutraRouteId): string {
  const match = TECHNOSUTRA_ROUTES.find((entry) => entry.id === route)
  if (!match) return TECHNOSUTRA_BASE_URL
  return new URL(match.path, TECHNOSUTRA_BASE_URL).toString()
}

/** Keep camera and WebXR available only to the dedicated AR route. */
export function technosutraFrameAllow(route: TechnosutraRouteId): string {
  return route === 'ar' ? 'camera; fullscreen; xr-spatial-tracking' : 'fullscreen'
}
