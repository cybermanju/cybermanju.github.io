// CyberManju OS — provider mount resolution (src/utils/providerMountResolution.ts).
// Role: resolve a provider route to its matching current sync config without guessing accounts.
// Exports: resolveProviderConfigId, stableProviderMountId.
export interface ProviderConfigRef {
  id: string
}

export interface ProviderMountRef {
  id: string
  configId: string
}

/** Resolve only an actual mount mapping, exact config id, or exact pending-<config id> route. */
export function resolveProviderConfigId(
  mountId: string,
  configs: readonly ProviderConfigRef[],
  mounts: readonly ProviderMountRef[],
): string | null {
  const configIds = new Set(configs.map(config => config.id))
  const mount = mounts.find(candidate => candidate.id === mountId)
  if (mount && configIds.has(mount.configId)) return mount.configId

  const configId = mountId.startsWith('pending-') ? mountId.slice('pending-'.length) : mountId
  return configIds.has(configId) ? configId : null
}

/** Keep an existing mount's URL id; use the config's exact id to repair a missing mount row. */
export function stableProviderMountId(
  configId: string,
  mounts: readonly ProviderMountRef[],
): string {
  return mounts.find(mount => mount.configId === configId)?.id ?? configId
}
