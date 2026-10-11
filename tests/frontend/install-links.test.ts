// CyberManju OS — Install links.test (tests/frontend/install-links.test.ts).
// Install window data: deterministic URL builders, the App × CLI platform
// table (android + ubuntu + arch + windows + macos + docker), live asset
// resolution with release-page fallback, panel registration, and the
// open-install event (silent no-op where no window exists).
import { describe, expect, it } from 'vitest'
import {
  INSTALL_REPO,
  INSTALL_TAG_URLS,
  INSTALL_TARGETS,
  pickInstallAssetUrls,
  releaseAssetUrl,
  releasePageUrl,
  requestInstallWindow,
  type ReleaseAsset,
} from '../../src/utils/installLinks'
import { MODULE_METADATA } from '../../src/types'
import { isKnownPanel } from '../../src/utils/uiRequests'
import { resolvePanel } from '../../src/utils/panels'

describe('install URL builders', () => {
  it('points at the release repo', () => {
    expect(INSTALL_REPO).toBe('cybermanju/cybermanju.github.io')
    expect(releasePageUrl()).toBe(`https://github.com/${INSTALL_REPO}/releases/latest`)
    expect(releasePageUrl('v0.1.0')).toBe(`https://github.com/${INSTALL_REPO}/releases/tag/v0.1.0`)
  })

  it('builds direct per-file download URLs', () => {
    expect(releaseAssetUrl('SHA256SUMS.txt')).toBe(
      `https://github.com/${INSTALL_REPO}/releases/latest/download/SHA256SUMS.txt`,
    )
    expect(releaseAssetUrl('cyb-linux-amd64.tar.gz', 'v0.1.0')).toBe(
      `https://github.com/${INSTALL_REPO}/releases/download/v0.1.0/cyb-linux-amd64.tar.gz`,
    )
    expect(INSTALL_TAG_URLS.sha256()).toContain('SHA256SUMS.txt')
    expect(INSTALL_TAG_URLS.installSh).toBe('https://cybermanju.github.io/install.sh')
    expect(INSTALL_TAG_URLS.installPs1).toBe('https://cybermanju.github.io/install.ps1')
  })
})

describe('install platform table (App × CLI)', () => {
  it('covers android + ubuntu + arch + windows + macos + docker', () => {
    expect(INSTALL_TARGETS.map((t) => t.id)).toEqual([
      'android',
      'ubuntu',
      'arch',
      'windows',
      'macos',
      'docker',
    ])
  })

  it('gives every platform app links and per-OS specifics', () => {
    for (const t of INSTALL_TARGETS) {
      expect(t.app.length, `${t.id} app links`).toBeGreaterThan(0)
      expect(t.specifics.length, `${t.id} specifics`).toBeGreaterThan(0)
      expect(t.blurb, `${t.id} blurb`).toBeTruthy()
    }
  })

  it('ships CLI rows where a cyb binary exists (android is app-only)', () => {
    const cli = Object.fromEntries(INSTALL_TARGETS.map((t) => [t.id, t.cli.length]))
    expect(cli.ubuntu).toBeGreaterThan(0)
    expect(cli.arch).toBeGreaterThan(0)
    expect(cli.windows).toBeGreaterThan(0)
    expect(cli.macos).toBeGreaterThan(0)
    expect(cli.docker).toBeGreaterThan(0)
    // `cyb` cross-compiles linux/darwin/windows only — no Android CLI.
    expect(cli.android).toBe(0)
  })
})

describe('live asset resolution', () => {
  const assets: ReleaseAsset[] = [
    { name: 'CyberManju-OS_0.1.0_amd64.deb', url: 'https://dl/deb' },
    { name: 'CyberManju-OS-0.1.0.apk', url: 'https://dl/apk' },
    { name: 'cyb-linux-amd64.tar.gz', url: 'https://dl/cyb' },
  ]

  it('resolves assetKey rows to direct URLs', () => {
    const urls = pickInstallAssetUrls(assets, 'v0.1.0')
    expect(urls['ubuntu:.deb package']).toBe('https://dl/deb')
    expect(urls['android:APK (install on device)']).toBe('https://dl/apk')
    expect(urls['arch:cyb tarball (linux amd64/arm64)']).toBe('https://dl/cyb')
  })

  it('falls back to the release page for missing assets (never a dead button)', () => {
    const urls = pickInstallAssetUrls([], 'v0.1.0')
    expect(urls['ubuntu:.deb package']).toBe(releasePageUrl('v0.1.0'))
    expect(urls['windows:Installer (.msi)']).toBe(releasePageUrl('v0.1.0'))
  })
})

describe('install panel registration', () => {
  it('has metadata, is openable and is not an alias', () => {
    expect(MODULE_METADATA.install).toBeDefined()
    expect(MODULE_METADATA.install.requiresAuth).toBe(false)
    expect(isKnownPanel('install')).toBe(true)
    expect(resolvePanel('install')).toBe('install')
  })

  it('fires the open-install event without throwing headless', () => {
    expect(() => requestInstallWindow('host-unsupported')).not.toThrow()
  })
})
