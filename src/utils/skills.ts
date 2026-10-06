// CyberManju — Hermes skills pattern, TS side.
//
// Skills are versioned instruction packs (manifest + markdown body) folded
// into the system prompt as standing orders. This module is the pure,
// unit-tested half: frontmatter parsing, budget-capped assembly, and
// goal-overlap selection. Loading from disk / the volume stays with the
// drivers (native Rust `load_project_rules`, browser volume tools).
//
// Budgets mirror `docs/OPERATIONS.md` §4b: 8 KiB per file, 24 KiB total.

/** Per-file cap: one bloated skill cannot eat the window. */
export const SKILL_FILE_BUDGET = 8 * 1024
/** Total cap across all standing-order files. */
export const SKILL_TOTAL_BUDGET = 24 * 1024

export interface SkillManifest {
  name: string
  description: string
  version?: string
  tools: string[]
}

export interface ParsedSkill {
  manifest: SkillManifest | null
  body: string
}

function parseTools(value: string): string[] {
  const t = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  return t
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

/**
 * Parse `---\nkey: value\n---\nbody` frontmatter. Tolerant: no frontmatter →
 * `{ manifest: null, body: text }`; malformed lines are skipped; never throws.
 * Recognised keys (case-insensitive): `name`, `description`, `version`,
 * `tools` (csv or `[a, b]`).
 */
export function parseSkillFrontmatter(text: string): ParsedSkill {
  const src = text ?? ''
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { manifest: null, body: src }
  const raw: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    raw[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  const name = raw.name ?? ''
  const description = raw.description ?? ''
  if (!name && !description) return { manifest: null, body: src.slice(m[0].length) }
  return {
    manifest: {
      name,
      description,
      version: raw.version || undefined,
      tools: raw.tools ? parseTools(raw.tools) : [],
    },
    body: src.slice(m[0].length),
  }
}

export interface StandingOrderFile {
  path: string
  content: string
}

export interface StandingOrderEntry {
  path: string
  chars: number
  truncated: boolean
}

export interface StandingOrdersResult {
  block: string
  included: StandingOrderEntry[]
  /** Files dropped because the total budget was already spent. */
  omitted: string[]
}

/**
 * Assemble the `<standing-orders>` prompt block under the file/total budgets.
 * Truncated files carry a `truncated:` marker so the machine-prefix contract
 * still classifies them as partial, never as complete instructions.
 */
export function assembleStandingOrders(files: StandingOrderFile[]): StandingOrdersResult {
  const included: StandingOrderEntry[] = []
  const omitted: string[] = []
  const parts: string[] = []
  let used = 0
  for (const f of files) {
    const full = f.content ?? ''
    if (!full) continue
    const room = SKILL_TOTAL_BUDGET - used
    if (room <= 0) {
      omitted.push(f.path)
      continue
    }
    const fileCap = Math.min(SKILL_FILE_BUDGET, room)
    const truncated = full.length > fileCap
    const slice = truncated ? full.slice(0, fileCap) : full
    const cut = full.length - slice.length
    const body = truncated
      ? `${slice}\n…truncated: cut ${cut} chars (skill budget ${SKILL_FILE_BUDGET}/${SKILL_TOTAL_BUDGET})`
      : slice
    parts.push(`<file path="${f.path}">\n${body}\n</file>`)
    used += slice.length
    included.push({ path: f.path, chars: slice.length, truncated })
  }
  return {
    block: `<standing-orders>\n${parts.join('\n')}\n</standing-orders>`,
    included,
    omitted,
  }
}

export interface SkillRecord {
  id: string
  manifest: SkillManifest
  body: string
}

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 2)

/**
 * Rank skills by keyword overlap between the goal and `name + description`.
 * Deterministic (score desc, id asc). No overlap → `[]`: unrelated skills are
 * never injected. `limit` defaults to 3.
 */
export function selectSkills(skills: SkillRecord[], goal: string, limit = 3): SkillRecord[] {
  const want = new Set(tokenize(goal ?? ''))
  if (!want.size) return []
  const n = Math.max(1, Math.floor(limit))
  return skills
    .map(s => {
      const hay = `${s.manifest.name} ${s.manifest.description}`.toLowerCase()
      let score = 0
      for (const w of want) {
        if (hay.includes(w)) score++
      }
      return { s, score }
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0))
    .slice(0, n)
    .map(r => r.s)
}
