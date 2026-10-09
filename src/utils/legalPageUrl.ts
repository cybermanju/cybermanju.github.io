const CANONICAL_LEGAL_BASE = 'https://cybermanju.github.io/'

type LegalPage = 'privacy.html' | 'terms.html'

/** Keep legal pages inside the active Pages preview; native/root builds use the canonical Pages URLs. */
export function legalPageUrl(page: LegalPage, baseUrl: string = import.meta.env.BASE_URL): string {
  if (baseUrl === '/develop/') return `${baseUrl}${page}`
  return `${CANONICAL_LEGAL_BASE}${page}`
}
