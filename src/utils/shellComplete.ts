// Tab-completion + history + ghost auto-suggest helpers for the cybsh
// panels. Pure functions (vitest-covered); the components own the server
// round-trip (`completeShellLine`) and the DOM overlay.

export const CYBSH_HISTORY_KEY = 'cybermanju.cybsh.history'
const HISTORY_CAP = 500

/** Index where the word under `caret` starts (whitespace boundary). */
export function wordStart(line: string, caret: number = line.length): number {
  const upto = line.slice(0, caret)
  const m = upto.match(/[^\s]*$/)
  return m ? caret - m[0].length : caret
}

/** The word under `caret` (empty when the caret sits after whitespace). */
export function currentWord(line: string, caret: number = line.length): string {
  return line.slice(wordStart(line, caret), caret)
}

/** True when the caret is still inside the first token (verb position). */
export function isVerbPosition(line: string, caret: number = line.length): boolean {
  return wordStart(line, caret) === 0
}

/** Replace the word under `caret` with `replacement`. */
export function replaceWord(line: string, caret: number, replacement: string): { line: string; caret: number } {
  const start = wordStart(line, caret)
  const next = line.slice(0, start) + replacement + line.slice(caret)
  return { line: next, caret: start + replacement.length }
}

// ─── persistent history ─────────────────────────────────────────────────

export function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(CYBSH_HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string').slice(-HISTORY_CAP)
  } catch {
    return []
  }
}

export function saveHistory(entries: string[]): void {
  try {
    localStorage.setItem(CYBSH_HISTORY_KEY, JSON.stringify(entries.slice(-HISTORY_CAP)))
  } catch {
    /* private mode — session history still works */
  }
}

export function pushHistory(entries: string[], line: string): string[] {
  if (entries[entries.length - 1] === line) return entries
  return [...entries, line].slice(-HISTORY_CAP)
}

/**
 * Walk history backwards for the previous entry starting with `prefix`
 * (excluding an exact match), starting *before* `fromIndex`.
 */
export function prevHistoryMatch(entries: string[], prefix: string, fromIndex: number): number {
  for (let i = Math.min(fromIndex, entries.length - 1); i >= 0; i--) {
    if (entries[i] !== prefix && entries[i].startsWith(prefix)) return i
  }
  return -1
}

/**
 * Walk history forwards for the next entry starting with `prefix`
 * (excluding an exact match), starting *after* `fromIndex`.
 */
export function nextHistoryMatch(entries: string[], prefix: string, fromIndex: number): number {
  for (let i = fromIndex; i < entries.length; i++) {
    if (entries[i] !== prefix && entries[i].startsWith(prefix)) return i
  }
  return -1
}

/**
 * Distinct past argument tokens starting with `word` (most recent first).
 * The client-side fallback when the server has no candidates — e.g. file
 * names and flags the user already typed.
 */
export function historyTokenHints(entries: string[], word: string): string[] {
  if (!word) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (let i = entries.length - 1; i >= 0; i--) {
    for (const tok of entries[i].split(/\s+/)) {
      const clean = tok.replace(/^["']|["']$/g, '')
      if (clean.length > word.length && clean.startsWith(word) && !seen.has(clean)) {
        seen.add(clean)
        out.push(clean)
      }
    }
    if (out.length >= 12) break
  }
  return out
}

/**
 * Ghost auto-suggest: the remainder of the best full-line candidate, or ''
 * when there is nothing to offer. History wins over the static table.
 */
export function ghostSuffix(line: string, history: string[], tableHits: string[]): string {
  if (!line) return ''
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].length > line.length && history[i].startsWith(line)) {
      return history[i].slice(line.length)
    }
  }
  const hit = tableHits.find((h) => h.length > line.length && h.startsWith(line))
  return hit ? hit.slice(line.length) : ''
}
