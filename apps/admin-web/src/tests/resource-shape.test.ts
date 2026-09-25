import { describe, expect, it } from 'vitest';
import { groupRows, rowsForResource } from '@/shared/refine/resource-shape';

describe('groupRows', () => {
  it('returns nothing for an undefined payload', () => {
    expect(groupRows(undefined, ['items'])).toEqual([]);
  });

  it('groups only the result keys actually present as arrays (audit: single key)', () => {
    const payload = { ok: true, audit: [{ id: 1 }, { id: 2 }] };
    expect(groupRows(payload, ['audit'])).toEqual([{ key: 'audit', label: 'audit', rows: payload.audit }]);
  });

  it('produces one group per key when several are present at once (flags: definitions + rules)', () => {
    const payload = { items: [{ flag_key: 'a' }], rules: [{ id: 1, scope_type: 'global' }] };
    const groups = groupRows(payload, ['items', 'rules']);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: 'items', rows: payload.items });
    expect(groups[1]).toMatchObject({ key: 'rules', rows: payload.rules });
  });

  it('skips a declared result key that is absent from the real response (roadmap: items present, "roadmap" is not)', () => {
    const payload = { ok: true, items: [{ id: 1, title: 'Ship it' }] };
    const groups = groupRows(payload, ['items', 'roadmap']);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('items');
  });

  it('converts an object-valued key into rows keyed by its own entries', () => {
    const payload = { store_controls: { 'orders.accepting': { enabled: true }, 'ads.eligible': { enabled: false } } };
    const groups = groupRows(payload, ['store_controls']);
    expect(groups).toEqual([{
      key: 'store_controls',
      label: 'store controls',
      rows: [
        { name: 'orders.accepting', enabled: true },
        { name: 'ads.eligible', enabled: false },
      ],
    }]);
  });

  it('falls back to any array on the payload when none of the declared keys match', () => {
    const payload = { unexpected_key: [{ id: 1 }] };
    expect(groupRows(payload, ['items'])).toEqual([{ key: 'unexpected_key', label: 'unexpected_key', rows: payload.unexpected_key }]);
  });

  it('falls back to name/value pairs of the whole payload as a last resort', () => {
    const payload = { total: 5, ok: true };
    expect(groupRows(payload, ['items'])).toEqual([{ key: 'data', label: 'Data', rows: [{ name: 'total', value: 5 }, { name: 'ok', value: true }] }]);
  });
});

describe('rowsForResource', () => {
  it('returns an empty array for an undefined payload', () => {
    expect(rowsForResource(undefined, ['audit'])).toEqual([]);
  });

  it('returns the flat row array for a single-key resource', () => {
    const rows = [{ id: 1, admin_email: 'owner@orderak.app' }];
    expect(rowsForResource({ ok: true, audit: rows }, ['audit'])).toBe(rows);
  });

  it('takes only the first group for a resource with several simultaneous result keys', () => {
    // Documents the deliberate simplification: `flags`/`capabilities` return
    // two real datasets at once, and a Refine list resource can only be one
    // flat array — this is why those two stay on the legacy grouped
    // ResourcePage view instead of a Refine getList.
    const items = [{ flag_key: 'a' }];
    const rules = [{ id: 1 }];
    expect(rowsForResource({ items, rules }, ['items', 'rules'])).toBe(items);
  });
});
