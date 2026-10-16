import { describe, expect, it } from 'vitest';
import { RECOVERY_DAYS_MS, deepEqual, editableSource, namesRetiredFamily, patchChanged, recoveryIsCurrent, recoveryKey } from '@/features/theme/theme-utils';

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

  it('treats objects as equal regardless of key order, at any nesting depth', () => {
    expect(deepEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
  });

  it('stays order-sensitive for arrays but order-insensitive for objects inside them', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([{ a: 1, b: 2 }], [{ b: 2, a: 1 }])).toBe(true);
  });

  it('still detects genuinely different values and missing keys', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('rebases a reordered-but-equal local object as unchanged', () => {
    const original = { colors: { primary: '#111111', secondary: '#222222' } };
    const active = { colors: { primary: '#999999', secondary: '#888888' } };
    const local = { colors: { secondary: '#222222', primary: '#111111' } };
    expect(patchChanged(original, active, local)).toEqual({
      colors: { primary: '#999999', secondary: '#888888' },
    });
  });

  it('rebases reordered leaf objects and keeps real array changes', () => {
    expect(patchChanged({ x: 1, y: 2 }, { x: 5, y: 6 }, { y: 2, x: 1 })).toEqual({ x: 5, y: 6 });
    expect(patchChanged(['a'], ['b'], ['a'])).toEqual(['b']);
    expect(patchChanged({ list: [1, 2] }, { list: [3] }, { list: [2, 1] })).toEqual({ list: [2, 1] });
  });
});

describe('retired font families (decision D-07)', () => {
  const stored = (family: string) => ({ colors: { primary: '#014D4E' }, typography: { family, multiplier: 1.05 } });

  it('loads a source that names a retired family as Cairo, keeping every other value', () => {
    for (const family of ['tajawal', 'noto-arabic']) {
      const source = stored(family);
      const editable = editableSource(source);
      expect(editable).toEqual({ colors: { primary: '#014D4E' }, typography: { family: 'cairo', multiplier: 1.05 } });
      expect(source.typography.family).toBe(family);            // the stored revision is not mutated
      expect(namesRetiredFamily(source)).toBe(true);
    }
  });

  it('leaves a Cairo source as it is', () => {
    expect(editableSource(stored('cairo'))).toEqual(stored('cairo'));
    expect(namesRetiredFamily(stored('cairo'))).toBe(false);
  });
});
