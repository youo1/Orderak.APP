import { createElement } from 'react';
import type { ResourceProps } from '@refinedev/core';
import { sections } from '@/app/config/sections';

/**
 * Generates Refine's resource registry from `sections.ts` so nav metadata
 * stays the single source of truth instead of forking into two configs.
 *
 * `list` is set from `section.path` for every resource EXCEPT the ones that
 * don't have a generic Refine list view: bespoke hand-written pages whose
 * DETAIL view is too custom for useShow/useForm to help with, so the
 * section never got its own dedicated list component (Runtime, Plans,
 * Theme, Jobs, Security, Admin access, Billing verifications — Deletions
 * also stays here, its list is small enough it was never split out), and
 * the two sections whose real API response returns more than one row group
 * at once (`flags`, `capabilities` — see `ResourcePage.tsx`). `stores` and
 * `support` DO have Refine list views (`StoresPage`/`SupportPage`, Phase 4)
 * even though their detail pages (`StoreDetailPage`/`TicketDetailPage`)
 * remain plain React. This must stay in sync with the equivalent exclusion
 * lists in `App.tsx`'s route mapping — both encode the same "is this
 * resource on a Refine list view" fact, from two different angles (routing
 * vs. resource registry), so there's no single field in `sections.ts` that
 * could replace either without merging routing concerns into nav config or
 * vice versa.
 */
const NOT_REFINE_LIST_IDS = new Set([
  'dashboard', 'deletions', 'runtime', 'jobs', 'security',
  'admins', 'plans', 'theme', 'billing-verifications', 'flags', 'capabilities',
]);

export const refineResources: ResourceProps[] = sections.map(section => ({
  name: section.id,
  list: NOT_REFINE_LIST_IDS.has(section.id) ? undefined : section.path,
  meta: {
    label: section.label,
    icon: createElement(section.icon, { size: 16 }),
    group: section.group,
    permission: section.permission,
  },
}));
