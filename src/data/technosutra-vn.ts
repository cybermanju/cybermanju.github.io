// CyberManju OS — The Stem Array Ren'Py Web build metadata.
// Role: single source of truth for the locally staged WebAssembly app.
// Exports: TECHNOSUTRA_VN_BUILD.
// Integrates: TechnosutraStudio and frontend integration tests.
// Contracts: this points only to the reviewed local static bundle; it does not deploy it.

export const TECHNOSUTRA_VN_BUILD = {
  assetBasePath: 'technosutra-vn/',
  validationCommit: '8a61887',
  buildId: 'verify-sprites-20261101-r2',
  renpyVersion: '8.5.3.26051504',
  optimizedBackgroundCount: 56,
  runtimeSpriteCount: 54,
  gameZipBytes: 5_779_947,
  gameZipSha256: 'a56d6aa05a6e224a38d307f8ad495573329cea259a83ce62d976f64186e0ce46',
  webOutputBytes: 122_647_442,
} as const
