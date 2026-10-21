// CyberManju OS — mobile Supabase build assertion.
// Role: fail trusted mobile builds if their public broker pair is missing.
// Integrates: GitHub Actions, Vite dist; never prints configuration values.
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function verifySupabaseBuild(directory, env = process.env) {
  const url = (env.VITE_SUPABASE_URL || '').trim()
  const key = (env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_KEY || '').trim()
  if (!url && !key && env.REQUIRE_BROKER !== '1') return 'Skipped: broker secrets unavailable for this event.'
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('Mobile broker project URL is missing or invalid.') }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || key.length < 8) {
    throw new Error('Mobile broker URL + public key must both be configured.')
  }
  async function collect(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    return (await Promise.all(entries.map(async entry => {
      const file = resolve(dir, entry.name)
      return entry.isDirectory() ? collect(file) : entry.name.endsWith('.js') ? [await readFile(file, 'utf8')] : []
    }))).flat()
  }
  const assets = await collect(resolve(directory))
  // Vite statically substitutes string literals before runtime trim().
  const literal = value => JSON.stringify(value).slice(1, -1)
  const baked = assets.some(text => text.includes('cybermanju.supabaseUrl') && text.includes(literal(env.VITE_SUPABASE_URL)) && text.includes(literal(env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_KEY)))
  if (!baked) throw new Error('Built mobile JavaScript is missing the expected Supabase broker pair; refusing to publish.')
  return 'Verified: Supabase broker URL + public key are baked into mobile JavaScript.'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifySupabaseBuild(process.argv[2] || 'dist').then(message => console.log(message)).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
