// CyberManju OS — merged-window aliases (pure, unit-tested).
//
// Several historic panel ids render the same window (code→editor,
// storage→disks, …). Aliases resolve in `useWindowManager.open()` so there
// is ever ONE live window per surface; an optional per-alias tab prop
// steers the merged window to the right tab.

import type { PanelType } from '@/types'

/** Historic id → canonical window id. Targets must never be aliases. */
export const PANEL_ALIASES: Partial<Record<PanelType, PanelType>> = {
  code: 'editor',
  webdash: 'dashboard',
  storage: 'disks',
  compression: 'encryption',
  users: 'accounts',
  favorites: 'collections',
  'loose-groups': 'collections',
  style: 'collections',
  preview: 'files',
  cron: 'processes',
  automation: 'processes',
  schedules: 'processes',
}

/** Props injected when opening via an alias (usually the initial tab). */
export const ALIAS_TAB_PROPS: Partial<Record<PanelType, Record<string, unknown>>> = {
  webdash: {},
  storage: { tab: 'overview' },
  compression: { tab: 'compress' },
  users: { tab: 'users' },
  favorites: { tab: 'favorites' },
  'loose-groups': { tab: 'loose' },
  style: { tab: 'tags' },
  preview: { inspector: true, inspTab: 'info' },
  cron: { tab: 'schedules' },
  automation: { tab: 'schedules' },
  schedules: { tab: 'schedules' },
}

/** Canonical window id for a panel id (identity when not aliased). */
export function resolvePanel(panelType: PanelType): PanelType {
  return PANEL_ALIASES[panelType] ?? panelType
}
