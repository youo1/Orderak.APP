import type { AuthProvider } from '@refinedev/core';
import type { useAuth } from '@/features/auth/auth-context';

type Auth = ReturnType<typeof useAuth>;

/**
 * Thin adapter over `auth-context.tsx` — a factory, not a module-level
 * object, because it needs live values from the `useAuth()` hook. Build it
 * inside a component with `useMemo(() => createAuthProvider(auth), [auth])`.
 *
 * The MFA/enrollment/recovery-code state machine is NOT reimplemented here:
 * `login()` only drives the first credentials step, exactly like
 * `auth.login()` already does, and `LoginScreen.tsx` keeps owning the
 * mfa/enroll/recovery UI regardless of what calls into `auth.login()`.
 *
 * This app has no `/login` route: `App.tsx` renders `<LoginScreen/>` inline
 * whenever `auth.admin` is null, driven by the `orderak:unauthorized` window
 * event `client.ts` already dispatches on 401 and that `auth-context.tsx`
 * already listens for. So `onError` must not invent its own redirect for a
 * 401 — there is nowhere to redirect to; the existing event/state-clearing
 * path is what already drives the UI back to the login screen. A 403 must
 * never log the session out.
 */
export function createAuthProvider(auth: Auth): AuthProvider {
  return {
    login: async ({ email, password }: { email: string; password: string }) => {
      try {
        await auth.login(email, password);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error : new Error('Login failed') };
      }
    },
    logout: async () => {
      await auth.logout();
      return { success: true };
    },
    check: async () => ({ authenticated: Boolean(auth.admin) }),
    getIdentity: async () => (auth.admin ? { ...auth.admin, id: auth.admin.id, name: auth.admin.name ?? auth.admin.email } : null),
    onError: async (error: unknown) => {
      const statusCode = (error as { statusCode?: number } | null)?.statusCode;
      if (statusCode === 401) return { logout: true };
      return {};
    },
  };
}
