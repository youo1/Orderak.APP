export type Row = Record<string, unknown>;
export type RowGroup = { key: string; label: string; rows: Row[] };

/**
 * Groups rows out of an admin API payload by result key. Moved here from
 * ResourcePage.tsx (formerly `rowsFromPayload`) so both the legacy
 * ResourcePage grouped view and the Refine data provider share one
 * implementation instead of two copies drifting apart.
 */
export function groupRows(payload: Row | undefined, keys: string[]): RowGroup[] {
  if (!payload) return [];
  const groups = keys.flatMap(key => {
    const value = payload[key];
    if (Array.isArray(value)) return [{ key, label: key.replaceAll('_', ' '), rows: value as Row[] }];
    if (value && typeof value === 'object') {
      return [{
        key,
        label: key.replaceAll('_', ' '),
        rows: Object.entries(value as Row).map(([name, item]) => ({ name, ...(typeof item === 'object' && item ? item as Row : { value: item }) })),
      }];
    }
    return [];
  });
  if (groups.length) return groups;
  const arrays = Object.entries(payload).filter(([, value]) => Array.isArray(value));
  if (arrays.length) return arrays.map(([key, value]) => ({ key, label: key, rows: value as Row[] }));
  return [{ key: 'data', label: 'Data', rows: Object.entries(payload).map(([name, value]) => ({ name, value })) }];
}

/**
 * A flat row array for a single Refine resource's `getList`/`getOne`.
 *
 * Most sections expose one result key (e.g. `{ audit: [...] }`), which is
 * the shape Refine expects. A section with several result keys (e.g.
 * plan-catalog's plans/revisions/definitions/values) isn't one Refine
 * resource — it stays on the grouped ResourcePage view until it's
 * deliberately redesigned into separate resources, so this takes the first
 * group only as a deliberate simplification, not a general solution for
 * multi-key sections.
 */
export function rowsForResource(payload: Row | undefined, resultKeys: string[]): Row[] {
  return groupRows(payload, resultKeys)[0]?.rows ?? [];
}
