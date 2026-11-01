// CyberManju OS — Touch-first shell policy (src/utils/mobileShell.ts).
// Role: resolve mobile shell mode consistently across portrait and landscape.
// Exports: mobile viewport predicate shared by the shell and phone windows.
// Integrates: browser media-query state and frontend shell components.
// Contracts: narrow layouts stay mobile; short coarse-pointer landscape stays touch-first.
export function isTouchFirstViewport(width: number, height: number, coarsePointer: boolean): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && (width <= 768 || (coarsePointer && height <= 600))
}

export const MOBILE_SHELL_MEDIA_QUERY = '(max-width: 768px), (pointer: coarse) and (max-height: 600px)'
