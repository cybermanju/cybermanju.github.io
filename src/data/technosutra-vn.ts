// CyberManju OS — local fallback for The Stem Array Ren'Py Web build metadata.
// Role: dev/test fallback only; main CI replaces this with same-run SHA metadata before bundling.
// Exports: TECHNOSUTRA_VN_BUILD.
// Integrates: TechnosutraStudio and frontend integration tests.
// Contracts: no Pages build may use this fallback as deployment provenance.

export const TECHNOSUTRA_VN_BUILD = {
  assetBasePath: 'technosutra-vn/',
  validationCommit: 'GENERATED_BY_MAIN_CI',
  buildId: 'verify-sprites-20261101-r2',
  renpyVersion: '8.5.3.26051504',
  optimizedBackgroundCount: 56,
  runtimeSpriteCount: 54,
  gameZipBytes: 5_779_947,
  gameZipSha256: 'a56d6aa05a6e224a38d307f8ad495573329cea259a83ce62d976f64186e0ce46',
  webOutputBytes: 122_647_442,
} as const
