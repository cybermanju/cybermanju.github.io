// CyberManju OS — Skills (src/utils/skills.ts).
// Role: skills as shareable apps, day one (ANALYSIS.md §4.8) —
// `.cybermanju/skills/*/SKILL.md` + the sync layer → installable skills that
// ship prompts + `.cybsh` scripts. No marketplace infrastructure: a skill is
// a folder, `SKILL.md` is the manifest, `skill install <url>` copies it.
// Exports: SkillManifest, parseSkillMd, validateSkill, listSkills,
// skillSlug.
// Integrates: standalone over `{ path, content }` volume listings;
// `skill` cybsh verb (staticCybsh.ts) executes; sync carries the folder.
// Contracts: pure, never throws; frontmatter is `---\nkey: value\n---`;
// name+description required, everything else optional with safe defaults.
export interface SkillManifest {
  /** Folder slug (`photo-triage`). */
  slug: string
  name: string
  version: string
  description: string
  /** `.cybsh` entry point relative to the skill folder. */
  run: string
  /** Full volume path of the SKILL.md file. */
  path: string
}

export function skillSlug(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.pop() ?? 'skill'
}

/** Parse `SKILL.md` text; null when the manifest is unusable. */
export function parseSkillMd(path: string, text: string): SkillManifest | null {
  const lines = text.split(/\r?\n/)
  let body = text
  const meta: Record<string, string> = {}
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const m = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line)
        if (m) meta[m[1].toLowerCase()] = m[2].trim()
      }
      body = lines.slice(end + 1).join('\n')
    }
  }
  const name = (meta.name ?? '').trim() || skillSlug(path).replace(/-/g, ' ')
  const description = (meta.description ?? '').trim() || body.trim().split('\n')[0]?.slice(0, 200) || name
  if (!name || !description) return null
  return {
    slug: skillSlug(path),
    name,
    version: (meta.version ?? '').trim() || '0.1.0',
    description,
    run: (meta.run ?? '').trim() || 'skill.cybsh',
    path,
  }
}

/** Human-readable problems (empty = installable). */
export function validateSkill(manifest: SkillManifest, files: string[]): string[] {
  const problems: string[] = []
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.slug)) {
    problems.push(`slug '${manifest.slug}' must be lowercase alnum + dashes`)
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    problems.push(`version '${manifest.version}' should be semver`)
  }
  const dir = manifest.path.split('/').slice(0, -1).join('/')
  if (!files.some((f) => f === `${dir}/${manifest.run}`)) {
    problems.push(`missing run script ${dir}/${manifest.run}`)
  }
  return problems
}

/** Every `SKILL.md` under `.cybermanju/skills/` becomes a manifest. */
export function listSkills(files: Array<{ path: string; content: string }>): SkillManifest[] {
  const out: SkillManifest[] = []
  for (const file of files) {
    if (!file.path.includes('.cybermanju/skills/')) continue
    if (!file.path.endsWith('/SKILL.md') && file.path !== '.cybermanju/skills/SKILL.md') continue
    const manifest = parseSkillMd(file.path, file.content)
    if (manifest) out.push(manifest)
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug))
  return out
}
