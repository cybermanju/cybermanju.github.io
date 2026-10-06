// Spoken-word → text normalisation for voice input.
//
// Speech recognition returns words ("open bracket", "new line", "see dee").
// This module turns them into characters before they reach the agent prompt,
// the code editor, or cybsh — per mode, so prose keeps its capitals while
// code/shell get symbols and dictionary fixes.

import { bestMatch } from './fuzzyCorrect'

export type VoiceMode = 'prose' | 'code' | 'shell'

const PROSE_PUNCT: Array<[RegExp, string]> = [
  [/\bnew paragraph\b/gi, '\n\n'],
  [/\bnew line\b/gi, '\n'],
  [/\bquestion mark\b/gi, '?'],
  [/\bexclamation (mark|point)\b/gi, '!'],
  [/\bopen quote\b/gi, ' "'],
  [/\bclose quote\b/gi, '" '],
  [/\bcomma\b/gi, ','],
  [/\bperiod\b/gi, '.'],
  [/\bcolon\b/gi, ':'],
  [/\bsemicolon\b/gi, ';'],
]

const CODE_WORDS: Array<[RegExp, string]> = [
  [/\bopen paren(?:thesis|theses)?\b/gi, '('],
  [/\bclose paren(?:thesis|theses)?\b/gi, ')'],
  [/\bopen bracket\b/gi, '['],
  [/\bclose bracket\b/gi, ']'],
  [/\bopen brace\b/gi, '{'],
  [/\bclose brace\b/gi, '}'],
  [/\bopen angle\b/gi, '<'],
  [/\bclose angle\b/gi, '>'],
  [/\bdouble equals\b/gi, '=='],
  [/\bfat arrow\b/gi, '=>'],
  [/\barrow\b/gi, '->'],
  [/\bless than\b/gi, '<'],
  [/\bgreater than\b/gi, '>'],
  [/\bdouble quote\b/gi, '"'],
  [/\bsingle quote\b/gi, "'"],
  [/\bback ?tick\b/gi, '`'],
  [/\bunderscore\b/gi, '_'],
  [/\bhyphen\b/gi, '-'],
  [/\bforward slash\b/gi, '/'],
  [/\bbackslash\b/gi, '\\'],
  [/\bvertical bar\b/gi, '|'],
  [/\bampersand\b/gi, '&'],
  [/\bat sign\b/gi, '@'],
  [/\bhash(?:tag)?\b/gi, '#'],
  [/\bdollar(?: sign)?\b/gi, '$'],
  [/\bpercent\b/gi, '%'],
  [/\bcaret\b/gi, '^'],
  [/\btilde\b/gi, '~'],
  [/\basterisk\b/gi, '*'],
  [/\bplus\b/gi, '+'],
  [/\bequals?(?: sign)?\b/gi, '='],
  [/\bcolon\b/gi, ':'],
  [/\bsemicolon\b/gi, ';'],
  [/\bcomma\b/gi, ','],
  [/\bdot\b/gi, '.'],
  [/\bquestion mark\b/gi, '?'],
  [/\bexclamation (mark|point)\b/gi, '!'],
  [/\bnew line\b/gi, '\n'],
  [/\btab\b/gi, '\t'],
  [/\bspace\b/gi, ' '],
]

/** "camel case foo bar" → "fooBar", "snake case Foo Bar" → "foo_bar", etc. */
function applyCasePhrases(s: string): string {
  return s
    .replace(/\bcamel case ((?:[a-z]+\s?)+)/gi, (_, words: string) => {
      const parts = words.trim().split(/\s+/)
      return parts.map((p, i) => (i === 0 ? p.toLowerCase() : p[0].toUpperCase() + p.slice(1).toLowerCase())).join('')
    })
    .replace(/\bsnake case ((?:[a-z]+\s?)+)/gi, (_, words: string) => words.trim().toLowerCase().split(/\s+/).join('_'))
    .replace(/\bkebab case ((?:[a-z]+\s?)+)/gi, (_, words: string) => words.trim().toLowerCase().split(/\s+/).join('-'))
}

/** Collapse spaces that symbol replacement leaves behind: `foo . bar` → `foo.bar`. */
function glueSymbols(s: string): string {
  return s
    .replace(/\s*([.()[\]{};:,])\s*/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
}

/** Capitalise sentence starts for prose dictation. */
function capitaliseProse(s: string): string {
  const t = s.trimStart()
  if (!t) return s
  return s.replace(/(^|[.!?]\s+|\n+)(\w)/g, (_, pre: string, ch: string) => pre + ch.toUpperCase())
}

/** Multi-word speech splits for two-letter shell verbs ("see dee" → "cd"). */
const SHELL_SPLITS: Record<string, string> = {
  'see dee': 'cd',
  'see pea': 'cp',
  'ell ess': 'ls',
  'pee ess': 'ps',
  'tee oh pee': 'top',
  'dee eff': 'df',
  'dee you': 'du',
  'pee double you dee': 'pwd',
  'make deer': 'mkdir',
  'are em': 'rm',
  'em vee': 'mv',
}

function joinShellSplits(s: string): string {
  let out = ` ${s.toLowerCase()} `
  for (const [k, v] of Object.entries(SHELL_SPLITS)) out = out.replace(` ${k} `, ` ${v} `)
  return out.trim()
}

// ─── cybsh dictionary (mirrors crates/os `command_table`) ───────────────

export const CYBSH_COMMANDS = [
  'help', 'history', 'clear', 'version', 'echo', 'ls', 'cd', 'pwd', 'cat',
  'cp', 'mv', 'rm', 'mkdir', 'touch', 'stat', 'du', 'df', 'mount', 'umount',
  'disk', 'providers', 'quota', 'sync', 'scrub', 'repair', 'gc', 'lease',
  'ps', 'top', 'kill', 'jobs', 'compute', 'workers', 'keygen', 'encrypt',
  'decrypt', 'search', 'ai',
] as const

const CYBSH_SUBCOMMANDS: Record<string, readonly string[]> = {
  disk: ['create', 'attach', 'detach', 'resize', 'check', 'destroy', 'list'],
  sync: ['start', 'status', 'runs', 'cancel', 'restore'],
  compute: ['run'],
  lease: ['acquire', 'release', 'status'],
  repair: ['run', 'rebuild', 'gc', 'status'],
  scrub: ['run', 'runs'],
  ai: ['ask', 'prompt'],
}

/** Every completable phrase (`disk create`, …) for ghost text when offline. */
export const CYBSH_PHRASES: string[] = [
  ...CYBSH_COMMANDS,
  ...Object.entries(CYBSH_SUBCOMMANDS).flatMap(([cmd, subs]) => subs.map((s) => `${cmd} ${s}`)),
  'history clear',
]

const CYBSH_ALIASES: Record<string, string> = {
  dir: 'ls',
  del: 'rm',
  erase: 'rm',
  copy: 'cp',
  move: 'mv',
  cls: 'clear',
  quit: 'clear',
  exit: 'clear',
  list: 'ls',
}

export interface ShellFix {
  line: string
  fixed: boolean
  fixes: string[]
}

/** Split a shell line on whitespace, honouring single/double quotes. */
function splitShell(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (const ch of line.trim()) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out
}

/**
 * Dictionary fallback for a cybsh line: fixes the verb (aliases + fuzzy
 * neighbours like `lss→ls`, `sl→ls`) and known subcommands
 * (`disk lis→list`). Never invents — unknown words pass through untouched
 * for the server's own did-you-mean.
 */
export function correctShellLine(raw: string): ShellFix {
  const line = joinShellSplits(raw)
  const parts = splitShell(line)
  if (!parts.length) return { line: '', fixed: false, fixes: [] }
  const fixes: string[] = []
  const verb = parts[0].toLowerCase()
  if (CYBSH_ALIASES[verb]) {
    parts[0] = CYBSH_ALIASES[verb]
    fixes.push(`${verb}→${parts[0]}`)
  } else if (!(CYBSH_COMMANDS as readonly string[]).includes(verb)) {
    const hit = bestMatch(verb, CYBSH_COMMANDS)
    if (hit) {
      parts[0] = hit.match
      fixes.push(`${verb}→${hit.match}`)
    }
  }
  const subs = CYBSH_SUBCOMMANDS[parts[0]]
  if (subs && parts[1] && !parts[1].startsWith('-')) {
    const sub = parts[1].toLowerCase()
    if (!subs.includes(sub)) {
      const hit = bestMatch(sub, subs)
      if (hit) {
        parts[1] = hit.match
        fixes.push(`${sub}→${hit.match}`)
      }
    }
  }
  return { line: parts.join(' '), fixed: fixes.length > 0, fixes }
}

// ─── code-word fixes (homophones STT mangles) ────────────────────────────

const CODE_HOMOPHONES: Record<string, string> = {
  function: 'function',
  funkshun: 'function',
  const: 'const',
  cost: 'const',
  let: 'let',
  lent: 'let',
  return: 'return',
  import: 'import',
  export: 'export',
  class: 'class',
  async: 'async',
  await: 'await',
}

export function correctCodeWords(s: string): string {
  return s.replace(/\b[a-z]+\b/gi, (w) => {
    const fix = CODE_HOMOPHONES[w.toLowerCase()]
    return fix ?? w
  })
}

/** Full pipeline: spoken words → insertable text for the given mode. */
export function normalizeSpoken(raw: string, mode: VoiceMode): string {
  let s = raw.trim()
  if (!s) return s
  if (mode === 'shell') {
    s = joinShellSplits(s)
    for (const [re, rep] of CODE_WORDS) s = s.replace(re, rep)
    return glueSymbols(s)
  }
  if (mode === 'code') {
    for (const [re, rep] of CODE_WORDS) s = s.replace(re, rep)
    s = applyCasePhrases(s)
    s = correctCodeWords(s)
    return glueSymbols(s)
  }
  for (const [re, rep] of PROSE_PUNCT) s = s.replace(re, rep)
  s = s.replace(/\s+/g, ' ').replace(/\s+([,.?!;:])/g, '$1')
  return capitaliseProse(s)
}
