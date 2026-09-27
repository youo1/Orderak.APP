import { useCallback } from 'react';
import { api } from '@/shared/api/client';
import { useAuth } from '@/features/auth/auth-context';

/**
 * The owner-only step-up, in one place.
 *
 * `POST /api/admin/v1/action-authorizations` is gated on `security:manage` and
 * then refuses every role but `owner` with `owner_required`
 * (`admin-control-plane.ts:80,492`). Four call sites mint one, and three of them
 * used to collect a password and a fresh TOTP code from an operator who
 * satisfied the permission but not the role — the most expensive possible way to
 * say "not you", after they had already typed their credentials into a console
 * built for staff who are busy.
 *
 * The rule is two conditions, so it lives here as one function and the screens
 * ask it rather than re-deriving half of it from a permission string.
 */
export function stepUpAvailable(canSecurityManage: boolean, role: string | undefined): boolean {
  return canSecurityManage && role === 'owner';
}

/** Said once, so four screens do not say four different things about one rule. */
export const STEP_UP_UNAVAILABLE =
  'This action needs an owner account with the security permission. Yours does not have both, so it cannot be authorized from here.';

export function useStepUp() {
  const auth = useAuth();
  const available = stepUpAvailable(auth.can('security:manage'), auth.admin?.role);

  const authorize = useCallback(
    async (action: string, entityId: string, payloadHash: string, password: string, totpCode: string) => {
      const { authorization_id } = await api<{ authorization_id: string }>('/api/admin/v1/action-authorizations', {
        method: 'POST',
        body: JSON.stringify({
          action,
          entity_id: entityId,
          payload_hash: payloadHash,
          password,
          totp_code: totpCode,
        }),
      });
      return authorization_id;
    },
    [],
  );

  return { available, authorize };
}
