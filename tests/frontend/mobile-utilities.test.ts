// CyberManju OS — Mobile utilities (tests/frontend/mobile-utilities.test.ts).
// Role: Guard responsive utility app layouts across the complete phone range.
// Exports: Vitest regression suite.
// Integrates: Archive, Backup, Sync, Tasks, Devices, Secrets, Permissions, Dashboard.
// Contracts: Mobile changes preserve desktop controls and all utility actions.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse, compileStyle } from '@vue/compiler-sfc'

const read = (name: string) => readFileSync(`src/components/${name}.vue`, 'utf8')
const cases = [
  ['ArchivePanel', '.ar-tabs { flex-wrap: nowrap; overflow-x: auto', '.dataset-table { width: max-content'],
  ['BackupPanel', '.bk-grid { grid-template-columns: minmax(0, 1fr)', '.bk-radio'],
  ['SyncPanel', '@media (max-width: 768px)', 'min-height: 44px'],
  ['ProcessPanel', '.watch-grid { grid-template-columns: minmax(0, 1fr)', '.watch-select'],
  ['DevicesPanel', '@media (max-width: 768px)', 'min-height: 44px'],
  ['SecretsPanel', 'grid-template-columns: minmax(0, 1fr)', '.sp-form-row { grid-template-columns: minmax(0, 1fr)'],
  ['FilePermissionsPanel', '@media (max-width: 768px)', 'min-height: 44px'],
  ['WebDashboardPanel', '@media (max-width: 768px)', 'min-height: 44px'],
]
describe('utility app phone layouts', () => {
  for (const [name, layout, touch] of cases) {
    it(`${name} retains a responsive layout and accessible actions`, () => {
      const source = read(name)
      expect(source).toContain(layout)
      expect(source).toContain(touch)
      const { descriptor, errors } = parse(source)
      expect(errors).toEqual([])
      for (const style of descriptor.styles) {
        expect(compileStyle({ source: style.content, filename: `${name}.vue`, id: 'data-v-utility-check', scoped: style.scoped }).errors).toEqual([])
      }
    })
  }
})
