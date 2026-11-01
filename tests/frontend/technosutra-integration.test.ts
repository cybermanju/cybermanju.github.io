// CyberManju OS — Technosutra integration.test (tests/frontend/technosutra-integration.test.ts).
// Role: protect the isolated app route contract and OS panel registration.
// Exports: none (Vitest suite).
// Integrates: @/data/technosutra, @/types, @/utils/panels.
// Contracts: each embedded route stays on the official origin; technosutra is a canonical, auth-free panel.
import { describe, expect, it } from 'vitest'
import { TECHNOSUTRA_BASE_URL, TECHNOSUTRA_ROUTES, technosutraFrameAllow, technosutraRouteUrl } from '@/data/technosutra'
import { TECHNOSUTRA_VN_BUILD } from '@/data/technosutra-vn'
import { MODULE_METADATA } from '@/types'
import { resolvePanel } from '@/utils/panels'

describe('Techno Sutra app integration', () => {
  it('registers as a canonical app panel available from the launcher', () => {
    expect(MODULE_METADATA.technosutra).toMatchObject({
      id: 'technosutra',
      label: 'TECHNO SUTRA',
      requiresAuth: false,
    })
    expect(resolvePanel('technosutra')).toBe('technosutra')
  })

  it('registers The Stem Array as a playable local Ren’Py app panel', () => {
    expect(MODULE_METADATA['technosutra-novel']).toMatchObject({
      id: 'technosutra-novel',
      label: 'THE STEM ARRAY',
      requiresAuth: false,
    })
    expect(resolvePanel('technosutra-novel')).toBe('technosutra-novel')
    expect(TECHNOSUTRA_VN_BUILD).toMatchObject({
      assetBasePath: 'technosutra-vn/',
      validationCommit: '8a61887',
      optimizedBackgroundCount: 56,
      runtimeSpriteCount: 54,
    })
  })

  it('exposes the upstream home, gallery, map, and AR routes', () => {
    expect(TECHNOSUTRA_ROUTES.map((route) => route.id)).toEqual(['home', 'gallery', 'map', 'ar'])
    expect(technosutraRouteUrl('home')).toBe(TECHNOSUTRA_BASE_URL)
    expect(technosutraRouteUrl('gallery')).toBe(`${TECHNOSUTRA_BASE_URL}galeria.html`)
    expect(technosutraRouteUrl('map')).toBe(`${TECHNOSUTRA_BASE_URL}map.html`)
    expect(technosutraRouteUrl('ar')).toBe(`${TECHNOSUTRA_BASE_URL}AR.html?model=1`)
  })

  it('keeps each configured route on the trusted upstream origin', () => {
    const origin = new URL(TECHNOSUTRA_BASE_URL).origin
    for (const route of TECHNOSUTRA_ROUTES) {
      expect(new URL(technosutraRouteUrl(route.id)).origin).toBe(origin)
    }
  })

  it('grants camera and WebXR only to the AR iframe route', () => {
    expect(technosutraFrameAllow('home')).toBe('fullscreen')
    expect(technosutraFrameAllow('gallery')).toBe('fullscreen')
    expect(technosutraFrameAllow('map')).toBe('fullscreen')
    expect(technosutraFrameAllow('ar')).toBe('camera; fullscreen; xr-spatial-tracking')
  })
})
