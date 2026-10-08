---
name: cybsh-script
description: Write `.cybsh` automation scripts for CyberManju OS (interpreted, no build): python-style print/if/def/try, dicts/lists, inline cybsh, js expressions, fetch, capabilities, replay journals, ui/theme, providers.
version: 1
tools: [read, list, grep, glob]
---
# `.cybsh` scripts — what to write

A `.cybsh` file is **interpreted automation over the same shell as the
Terminal** — no compiler, no build step. Run it with:

```bash
run /scripts/tidy.cybsh                              # execute
run /scripts/tidy.cybsh --dry                        # parse + budget-check only
run /scripts/tidy.cybsh --json                       # machine output {path, vars, caps, calls, output}
run /scripts/tidy.cybsh --record nightly.json        # capture sh/fetch into a journal
run /scripts/tidy.cybsh --replay nightly.json        # replay journal, no network/exec
```

The file **must** end in `.cybsh` (otherwise `run` refuses with
`invalid:`). Same language on all three transports (native shell
`crates/os/src/script.rs`, Pages twin `src/utils/cybshScript.ts`, WASM
fallback in `crates/os-wasm/src/os.rs`).

Pin the language and declare least privilege up top (both optional,
both recommended):

```python
# cybsh: 1
# cap: net=api.example.com read=/archive write=/archive deny=rm,sync
```

- `# cybsh: 1` — language version. Missing = allowed (back-compat);
  wrong number = honest `unsupported:` (reproducibility starts here).
- `# cap:` — Deno-style capabilities (may repeat, merged). `deny=`
  refuses shell verbs, `net=` allowlists `fetch` hosts, `read=`/`write=`
  declare intent (audited in `--json`, enforced at the agent gate).
  Deny always wins. Anything refused fails as `denied:` — prefix-first,
  so UI hints keep working (`denied: … (line 4)`).

## Statements (one per line, `#` comments)

```python
# variables — `let`/`const` identical, optional TS types stripped
let name = "manju"
let retries: number = 3
const bucket = "/backups"
name = "manju-os"                      # reassign, no `let` needed

print "hello"                          # python-style
print("two", "args")                   # comma args join with spaces
print len("abcd"), 1 + 2               # expressions everywhere

if retries > 0:                        # trailing `:` required
  print "retrying"
elif retries == 0:                     # `elif`, not `else if`
  print "last chance"
else:
  print "done"

# explicit failure handling (Elvish over bash: abort unless caught HERE)
try:
  sh "sync start"
catch e:                               # `catch:` without binding also works
  print "warn: " + e

fail "stop the world"                  # raise `fail: …` (caught by `catch`)

for f in ["a", "b"]:                   # lists, range(3), strings, dict→keys
  print f
for i in range(3):
  print i

let n = 0
while n < 3:                           # bounded (1000 iters max)
  let n = n + 1

# functions — lexical scope, owned values, no global mutation
def greet(name, punct):
  return "hi " + name + punct          # bare `return` = null

print greet("manju", "!")

vars                                   # list live bindings
free name                              # drop one binding
gc                                     # release last-output `_` buffer, report
```

`def` rules: params bind as locals (shadowing allowed), globals stay
readable, assignments never escape; recursion bounded (call depth 32);
`return` outside `def` is a syntax error; builtin names
(`len/int/str/json/split/range/sh/set/push/del/keys/values`, literals,
`and/or/not`) cannot be redefined — one meaning per name.

## Values: text is UI, structure is API (Nushell rule)

`null true false` numbers strings lists **dicts** (sorted keys —
display, iteration and `==` are deterministic on every transport):

```python
let d = {"b": 2, "a": 1}              # or {b: 2} — bare idents work
print d                                # {"a": 1, "b": 2} — sorted, always
print d.a                              # 1 — field access
print d["b"]                           # 2 — key access
print [10, 20][1]                      # 20 — list index
print "xy"[1]                          # y — string char

let e = set(d, "c", 3)                 # functional updates (new values)
let l = push([1], 2)                   # [1, 2]
let s = del(e, "a")                    # {"b": 2, "c": 3}
print keys(e)                          # [a, b, c] — sorted
print values(e)                        # [1, 2, 3] — key order
for k in e:                            # dicts iterate sorted keys
  print k + "=" + str(e[k])
```

`+` concatenates with strings (`"n=" + 1`), `"ab" * 3` repeats;
`==` across types compares displays (Starlark-strict `<` stays
same-type); `len()` counts chars/items/keys; `int()/str()` convert.

## Inline shell — the point of the file (one way, Oils rule)

Any real cybsh verb works **bare** (same table as `help`), or explicitly.
All forms are the same call — pick one per script:

```bash
ls /                                   # bare line, output shown + kept in `_`
$ sync status                          # `$` prefix, same thing
sh "providers --json"                  # `sh` form (quote it)
let listing = sh("ls / --json")        # capture instead of printing
sh("echo " + name)                     # any expression as the command
```

`sh()` with `--json` output **materializes into structure** — no
re-parsing (Nushell rule):

```python
let st = sh("sync status --json")
print st.jobs                            # field access, no grep
let first = sh("ls / --json")
```

Inline lines support `&&`/`||`/`;` natively, `--json` for machine
parsing, and `${var}` interpolation. A failing line aborts as
`<cause> (line N)` — prefix-first, catchable:

```python
let dst = "/backups"
$ cp /report.pdf ${dst}/report.pdf
try:
  sh "sync start"
catch:
  sh "echo sync-offline"
```

## `js` expressions (subset, no engine needed)

```python
let x = js: 1 + 2 * 3                  # arithmetic, compare, and/or/not
js x > 5 and len(name) > 0             # statement form prints true/false
```

Supported: `+ - * / %`, `== != < <= > >=`, `and or not` (JS `&& || !`
`=== !==` normalized), parens, lists/dicts, `${var}` in strings,
`true/false/null`. `js` is **pure** — shell work needs `sh()`.

## `fetch`, providers, durability

```python
fetch "https://api.github.com/repos/o/r" as body   # static/Pages transport
print len(body)
```

- `fetch` **really runs on Pages/static** (10 s, 64 KiB, capability
  gated); the native Rust shells have no HTTP client and answer honest
  `unsupported:` — **unless replaying a journal** (below), which serves
  `fetch` deterministically everywhere.
- Providers/durability are just shell verbs — prefer them over `fetch`:
  `providers`, `quota`, `sync status|list`, `disk`, `mount`,
  `scrub`, `repair`, `gc`, `lease status`, `compress|decompress`,
  `encrypt|decrypt|keygen`, `search|grep|find`.
- Provider files live at `/providers/<mountId>/…` — same `cp/mv/rm/mkdir`
  verbs, cross-provider moves copy-then-delete.

## Replay journals — determinism you can file

Record once where the network lives, replay anywhere (Bazel rule:
same inputs → same outputs):

```bash
run /scripts/nightly.cybsh --record nightly.json     # on Pages/desktop
run /scripts/nightly.cybsh --replay nightly.json     # anywhere, offline
```

The journal captures every `sh` output and `fetch` body, fingerprinted
(FNV-1a/64) by script source. Replaying changed code is an `integrity:`
refusal, never a silent lie; a missing call is `not_found:`.

## OS interface — colours and theme

```bash
ui get                                 # show theme + accent
ui theme mac-dark                      # system: mac-light|mac-dark|mac-graphite-light|mac-graphite-dark|mac-midnight
                                       # color light: ocean-light|sunset-light|forest-light|lavender-light|rose-light
                                       # color night: ocean-night|forest-night|ember-night|nebula-night|cyber-night
ui accent #ff2d55                      # #rrggbb|#rgb, or `default` for system
theme nebula-night                     # short form (theme only)
```

Every mutation prints a machine `ui: theme=…` / `ui: accent=…` line: the
Terminal applies it live via `useTheme()`, and it persists to the volume
mirror (`/.cybermanju/theme.json`) + `localStorage`. From scripts:

```python
sh "ui theme mac-dark"
if "dark" == "dark":
  sh "ui accent #0a84ff"
```

## Memory model (why no GC tuning)

Values are **owned** — no aliasing, no tracing collector. Budgets bound
everything instead: 64 KiB source · 200 statements/block · 5000 steps ·
1000 loop iters · 64 vars · 32 defs · call depth 32 · 16 KiB/string ·
1024 list/dict items · 256 KiB output (truncated with a note, never
silently cut). Large command output lands in `_`; `free _` or `gc`
releases it. If a script outgrows this, it is two scripts (`run` nests
4 deep: `sh "run part2.cybsh"`).

## Errors (house `prefix: detail` contract, prefix-first)

`syntax:` (with line number) · `not_found:` · `invalid:` ·
`too_large:` (budget hit) · `denied:` (capability refusal) · `fail:`
(raised) · `unsupported:` (needs dashboard/Pages — never faked) ·
`integrity:` (stale journal) · `conflict:` (from `edit`). Location
rides along as a suffix: `unknown command: 'x' (line 4)`.

## Minimal complete example

```python
# cybsh: 1
# cap: deny=rm read=/providers/inbox write=/archive
# /scripts/nightly.cybsh — tidy inbox, report, restyle

def note(text):
  return "[nightly] " + text

print note("start")

try:
  let pending = sh("ls /providers/inbox")
  if len(pending) == 0:
    print "inbox empty — nothing to file"
  else:
    print "filing:"
    print pending
    $ cp /providers/inbox/notes.txt /archive/notes.txt
catch e:
  print "triage skipped: " + e

print "durability:"
sh "scrub || echo scrub-unavailable-here"
sh "gc --dry || echo gc-unavailable-here"

# green accent = tidy run finished; errors above abort first.
sh "ui accent #34c759"
print note("done")
```

Long jobs (`sync start`, `ai ask`) are **detached** (`202` + poll) — start
them, then `sync status` / `ai status`; never block a script waiting.
