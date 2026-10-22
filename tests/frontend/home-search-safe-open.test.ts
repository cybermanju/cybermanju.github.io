// CyberManju OS — Home search safe-open regression tests.
// Role: exercise actual search activation/menu functions against the native suspension barrier.
// Exports: Vitest suite. Integrates: OmniSearchPanel SFC, TypeScript AST and mocked window/store services.
// Contracts: refused or rejected suspension cannot open panels or mutate selection; menu actions recheck.
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const script = parse(readFileSync('src/components/OmniSearchPanel.vue', 'utf8')).descriptor.scriptSetup!.content
const tree = ts.createSourceFile('search.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const names = new Set(['activate', 'openFilesAt', 'openCtx'])
const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name!.text)).map(node => node.getText(tree)).join('\n')
const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
function harness(beforeOpen?: () => Promise<boolean>) {
  const store = { collections: [], faceGroups: [], files: [], currentPath: '/', selectFile: vi.fn(), fetchFiles: vi.fn() }
  const wm = { open: vi.fn() }, ctx = { replaceEntries: vi.fn(), open: vi.fn() }, remember = vi.fn()
  const handlers = new Function('props', 'store', 'wm', 'ctx', 'q', 'rememberSearch', 'fileById', `${compiled}\nreturn { activate, openCtx }`)(
    { beforeOpen }, store, wm, ctx, { value: 'query' }, remember, () => null,
  )
  return { ...handlers, store, wm, ctx, remember }
}
const row = { key: 'test', refId: 'files', name: 'Files', kind: 'apps' }
describe('Home search suspension composition', () => {
  it.each(['false', 'reject'] as const)('blocks every local activation before side effects on %s', async outcome => {
    const barrier = outcome === 'false' ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(new Error('host refused'))
    const t = harness(barrier)
    for (const section of ['apps', 'collections', 'people', 'providers', 'folders', 'files', 'content']) await t.activate(section, row)
    await t.openCtx({}, 'apps', row)
    expect(t.wm.open).not.toHaveBeenCalled()
    expect(t.store.selectFile).not.toHaveBeenCalled()
    expect(t.store.fetchFiles).not.toHaveBeenCalled()
    expect(t.store.currentPath).toBe('/')
    expect(t.remember).not.toHaveBeenCalled()
    expect(t.ctx.open).not.toHaveBeenCalled()
  })
  it('opens app and file results only after successful suspension, leaving non-Home usage compatible', async () => {
    const barrier = vi.fn().mockResolvedValue(true), t = harness(barrier)
    await t.activate('apps', row)
    await t.activate('files', { ...row, refId: 'file-1' })
    expect(barrier).toHaveBeenCalledTimes(2)
    expect(t.wm.open.mock.calls).toEqual([['files'], ['files']])
    expect(t.store.selectFile).toHaveBeenCalledExactlyOnceWith('file-1')
    const windowSearch = harness()
    await windowSearch.activate('apps', row)
    expect(windowSearch.wm.open).toHaveBeenCalledExactlyOnceWith('files')
  })
  it.each(['apps', 'providers', 'files'])('rechecks safe-hide when a previously opened %s menu action runs', async section => {
    const barrier = vi.fn().mockResolvedValue(true), t = harness(barrier)
    await t.openCtx({}, section, row)
    expect(t.ctx.open).toHaveBeenCalledOnce()
    const entries = t.ctx.replaceEntries.mock.calls[0]![1]
    barrier.mockResolvedValue(false)
    for (const id of ['open', 'sync', 'show']) {
      const action = entries.find((entry: { id: string }) => entry.id === id)?.action
      if (action) await action()
    }
    expect(t.wm.open).not.toHaveBeenCalled()
    expect(t.store.selectFile).not.toHaveBeenCalled()
  })
})
