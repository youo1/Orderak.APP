import { useMemo, type ReactNode } from 'react';
import { Refine } from '@refinedev/core';
import { useQueryClient } from '@tanstack/react-query';
import routerProvider from '@refinedev/react-router';
import { useAuth } from '@/features/auth/auth-context';
import { dataProvider } from '@/shared/refine/data-provider';
import { createAuthProvider } from '@/shared/refine/auth-provider';
import { createAccessControlProvider } from '@/shared/refine/access-control-provider';
import { refineResources } from '@/shared/refine/resources';

/**
 * Wraps the existing route tree with Refine's providers. Must render as a
 * child of `AuthProvider` (auth-context.tsx) so `authProvider`/
 * `accessControlProvider` can be built from live `useAuth()` values —
 * Refine wants plain objects, not hooks, so they're constructed here with
 * `useMemo` rather than as module-level constants.
 *
 * This does not take over routing: `<Routes>`/`<Route>` in App.tsx stay
 * exactly as they are, unchanged. `routerProvider` only binds Refine's
 * hooks (`useGo`, `useNavigation`, menu active-item detection, ...) to the
 * router that's already there.
 *
 * `options.reactQuery.clientConfig` is NOT optional here: `<Refine>`'s
 * container creates and provides its OWN internal `QueryClient` whenever
 * `clientConfig` isn't already a `QueryClient` instance — it does not fall
 * back to whatever `QueryClientProvider` happens to be above it in the
 * tree. Passing the app's real client (created once in `main.tsx`, read
 * here via `useQueryClient()`) is what makes Refine's queries actually
 * inherit `main.tsx`'s `retry: 1`/`staleTime` defaults instead of
 * react-query's own built-in defaults (retry: 3) under a second, shadow
 * QueryClient nested inside the first.
 */
export function RefineRoot({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const authProvider = useMemo(() => createAuthProvider(auth), [auth]);
  const accessControlProvider = useMemo(() => createAccessControlProvider(auth), [auth]);

  return (
    <Refine
      dataProvider={dataProvider}
      authProvider={authProvider}
      accessControlProvider={accessControlProvider}
      routerProvider={routerProvider}
      resources={refineResources}
      options={{
        disableTelemetry: true,
        syncWithLocation: false,
        warnWhenUnsavedChanges: false,
        reactQuery: { clientConfig: queryClient },
      }}
    >
      {children}
    </Refine>
  );
}
