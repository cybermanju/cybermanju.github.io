// CyberManju OS — Wiki deployment-base regressions.
// Role: execute the real generator and resolve its navigation in each deployment.
// Exports: none.
// Integrates: generate-wiki.mjs, temporary artifact directories, Vitest.
// Contracts: production stays at /; preview wiki and llms links stay under /develop/.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const origin = 'https://cybermanju.github.io'
const cases = [
  { name: 'default production base', base: undefined, prefix: '/' },
  { name: 'explicit production base', base: '/', prefix: '/' },
  { name: 'isolated develop preview', base: '/develop/', prefix: '/develop/' },
]
const outputs = new Map<string, string>()
let temporaryRoot: string | undefined

beforeAll(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'cybermanju-wiki-bases-'))
  for (const [index, entry] of cases.entries()) {
    const out = join(temporaryRoot, String(index))
    const env = { ...process.env }
    delete env.VITE_BASE
    if (entry.base !== undefined) env.VITE_BASE = entry.base
    execFileSync(process.execPath, [resolve('scripts/generate-wiki.mjs'), '--out', out], {
      env, timeout: 20_000, stdio: 'pipe',
    })
    outputs.set(entry.name, out)
  }
}, 60_000)

afterAll(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true })
})

function ownWikiUrls(text: string) {
  return [...text.matchAll(/https:\/\/cybermanju\.github\.io\/[^\s<>"')|]+/g)]
    .map(match => new URL(match[0]))
    .filter(url => url.pathname.includes('/wiki/') || url.pathname.endsWith('/llms.txt'))
}

function expectScoped(url: URL, prefix: string) {
  expect(url.origin).toBe(origin)
  expect(url.pathname.startsWith(`${prefix}wiki/`) || url.pathname === `${prefix}llms.txt`).toBe(true)
}

describe.each(cases)('$name', ({ name, prefix }) => {
  it('keeps the llms entry point and every subject URL in its deployment', () => {
    const text = readFileSync(join(outputs.get(name)!, 'llms.txt'), 'utf8')
    expect(text).toContain(`Interactive wiki for humans: ${origin}${prefix}wiki/`)
    expect(text).toContain(`${origin}${prefix}wiki/agent.txt`)
    expect(text).toContain(`Symbol deep view: ${origin}${prefix}wiki/symbols-<id>.json`)
    const urls = ownWikiUrls(text)
    expect(urls.length).toBeGreaterThan(10)
    for (const url of urls) expectScoped(url, prefix)
  })

  it('resolves every generated static-page navigation link inside its deployment', () => {
    const directory = join(outputs.get(name)!, 'wiki')
    const pages = readdirSync(directory).filter(file => file.endsWith('.html') && file !== 'graph.html')
    expect(pages.length).toBeGreaterThan(10)
    for (const file of pages) {
      const html = readFileSync(join(directory, file), 'utf8')
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])
      expect(hrefs.length).toBeGreaterThan(3)
      const pageUrl = `${origin}${prefix}wiki/${file}`
      for (const href of hrefs) expectScoped(new URL(href.replace(/&amp;/g, '&'), pageUrl), prefix)
      expect(html).toContain(`href="${origin}${prefix}llms.txt"`)
      expect(html).toContain(`href="${origin}${prefix}wiki/"`)
    }
  })

  it('scopes subject text URLs and preserves usable SPA deep links', () => {
    const directory = join(outputs.get(name)!, 'wiki')
    const subjects = readdirSync(directory).filter(file => file.endsWith('.txt'))
    expect(subjects.length).toBeGreaterThan(10)
    for (const file of subjects) {
      const text = readFileSync(join(directory, file), 'utf8')
      const id = file.replace(/\.txt$/, '')
      expect(text).toContain(`App: ${origin}${prefix}wiki/#/${id}`)
      expect(text).toContain(`${origin}${prefix}llms.txt`)
      for (const url of ownWikiUrls(text)) expectScoped(url, prefix)
    }
  })
})
