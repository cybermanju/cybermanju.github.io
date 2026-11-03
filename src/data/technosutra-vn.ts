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
  gameZipBytes: 7_538_848,
  gameZipSha256: 'b689852712ba4c5b9fc89926dfe61a1d45b3750f6c76836ea7ed0de7f878d900',
  webOutputBytes: 122_647_442,
} as const
