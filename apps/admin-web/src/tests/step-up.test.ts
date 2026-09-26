import { describe, expect, it } from 'vitest';
import { stepUpAvailable } from '@/shared/api/step-up';

/**
 * The owner-only step-up is two conditions, and half of it is not enough.
 *
 * `POST /api/admin/v1/action-authorizations` is gated on `security:manage` and
 * then refuses every role but `owner` with `owner_required`. Three screens used
 * to check only the permission, so a finance operator was asked for a password and
 * a fresh TOTP code before being told no. These four cases are the whole rule.
 */
describe('stepUpAvailable', () => {
  it('needs the permission and the owner role together', () => {
    expect(stepUpAvailable(true, 'owner')).toBe(true);
  });

  it('refuses a role that has the permission but is not an owner', () => {
    expect(stepUpAvailable(true, 'finance')).toBe(false);
    expect(stepUpAvailable(true, 'support')).toBe(false);
    expect(stepUpAvailable(true, 'readonly')).toBe(false);
  });

  it('refuses an owner whose session lacks the permission', () => {
    expect(stepUpAvailable(false, 'owner')).toBe(false);
  });

  it('refuses a session that has not resolved yet', () => {
    expect(stepUpAvailable(false, undefined)).toBe(false);
    expect(stepUpAvailable(true, undefined)).toBe(false);
  });
});
