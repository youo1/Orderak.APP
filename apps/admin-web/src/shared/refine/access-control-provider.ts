import type { AccessControlProvider } from '@refinedev/core';
import type { useAuth } from '@/features/auth/auth-context';
import { sectionById } from '@/app/config/sections';

type Auth = ReturnType<typeof useAuth>;

const WRITE_ACTIONS = new Set(['create', 'edit', 'delete']);

/**
 * UI visibility only, never an authorization boundary. The Admin Worker
 * re-checks every protected operation server-side on every request
 * regardless of what `can` returns here — this only decides what the UI
 * chooses to render (menu items, buttons, `<CanAccess>` guards), the same
 * role the hand-rolled `<Permission>` wrapper in App.tsx plays today.
 *
 * `permissions` comes from the server on every session refresh
 * (`auth-context.tsx`); this is a read of that state, never its own
 * decision. Every section's manage permission is its view permission with
 * `view` replaced by `manage` — verified against every section in
 * `sections.ts`/`actions.ts` (e.g. `coupons:view`/`coupons:manage`,
 * `buyers:view`/`buyers:manage`). A section's id doesn't always match its
 * permission prefix (`privacy`'s view permission is `buyers:view`, not
 * `privacy:view`), so this derives from `section.permission` itself, never
 * from `resource`/`id` — and deliberately doesn't depend on `actions.ts`,
 * which is being retired resource-by-resource as each one migrates.
 */
export function createAccessControlProvider(auth: Auth): AccessControlProvider {
  return {
    can: async ({ resource, action }) => {
      if (!resource) return { can: true };
      const section = sectionById[resource];
      if (!section) return { can: true };
      const permission = WRITE_ACTIONS.has(action) ? section.permission.replace('view', 'manage') : section.permission;
      return { can: auth.can(permission) };
    },
  };
}
