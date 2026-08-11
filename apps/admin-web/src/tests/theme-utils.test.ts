import { describe, expect, it } from 'vitest';
import { RECOVERY_DAYS_MS, patchChanged, recoveryIsCurrent, recoveryKey } from '@/features/theme/theme-utils';

describe('design-system editor safety', () => {
  it('keys browser recovery by administrator and base revision', () => {
    expect(recoveryKey(12, 44)).toBe('orderak:theme-recovery:12:44');
  });

  it('accepts recovery only within the seven-day window', () => {
    const now = 1_000_000;
    expect(recoveryIsCurrent(now + RECOVERY_DAYS_MS, now)).toBe(true);
    expect(recoveryIsCurrent(now - 1, now)).toBe(false);
    expect(recoveryIsCurrent(now + RECOVERY_DAYS_MS + 1, now)).toBe(false);
  });

  it('rebases only local changes over a newly active revision', () => {
    const original = { colors: { primary: '#111111', secondary: '#222222' }, spacing: 4 };
    const active = { colors: { primary: '#111111', secondary: '#333333' }, spacing: 4 };
    const local = { colors: { primary: '#444444', secondary: '#222222' }, spacing: 4 };
    expect(patchChanged(original, active, local)).toEqual({
      colors: { primary: '#444444', secondary: '#333333' },
      spacing: 4,
    });
  });
});
