// CyberManju OS — Disk mobile layout tests (tests/frontend/disk-mobile-layout.test.ts).
// Role: pin the per-disk card structure and prevent mobile overflow regressions.
// Exports: none.
// Integrates: DiskManagerPage Vue SFC, Vitest.
// Contracts: keep disk controls reachable at narrow widths without changing disk transport semantics.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/components/DiskManagerPage.vue', 'utf8')
const scopedCss = source.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''
const mobileCss = scopedCss.slice(scopedCss.indexOf('@media (max-width: 768px)'))

describe('DiskManagerPage mobile per-drive layout', () => {
  it('keeps each drive self-contained with accessible usage and capacity stats', () => {
    expect(source).toContain('class="cards"')
    expect(source).toContain('class="card"')
    expect(source).toContain('role="progressbar"')
    expect(source).toContain(':aria-valuenow="diskPct(disk.usedBytes, disk.capacityBytes)"')
    expect(source).toContain('CAPACITY {{ humanBytes(disk.capacityBytes) }}')
    expect(source).toContain('humanBytes(Math.max(0, disk.capacityBytes - disk.usedBytes))')
  })

  it('stacks the create form and keeps fields and primary action within the card width', () => {
    expect(mobileCss).toMatch(/\.create-row\s*\{[^}]*flex-direction:\s*column/)
    expect(mobileCss).toMatch(/\.field,\s*\.field\.grow\s*\{[^}]*min-width:\s*0/)
    expect(mobileCss).toMatch(/\.field \.input,[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0/)
    expect(mobileCss).toMatch(/\.create-row > \.ghost-btn\s*\{[^}]*width:\s*100%/)
  })

  it('uses a single-column drive-card layout with wrapped, touch-sized actions', () => {
    expect(mobileCss).toMatch(/\.cards\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(mobileCss).toMatch(/\.card-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
    expect(mobileCss).toMatch(/\.card-actions \.ghost-btn\s*\{[^}]*min-height:\s*44px/)
    expect(mobileCss).toMatch(/\.card-head\s*\{[^}]*align-items:\s*flex-start/)
  })

  it('retains the Android SD-card section while disk styles change', () => {
    expect(source).toContain('aria-label="Android external storage"')
    expect(source).toContain('SELECT SD CARD')
    expect(source).toContain('Add to transfers')
  })

  it('provisions cloud disks remotely and reports incomplete cloud setup without recreating the disk', () => {
    expect(source).toContain("['googleDrive', 'github', 'gitlab'].includes(config.backendType)")
    expect(source).toContain('store.createDiskWithRemote(config, {')
    expect(source).toContain('sizeMb: createSizeMb.value')
    expect(source).toContain('result.remoteWarning')
    expect(source).toContain('Cloud setup is incomplete:')
    expect(source).toMatch(/finally\s*\{\s*creating\.value = false/)
    expect(source).toContain('Capacity is a logical limit, not preallocated cloud space.')
  })
})
