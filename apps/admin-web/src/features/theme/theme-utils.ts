export const RECOVERY_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A copy of a stored source that this editor can publish. A revision stored before decision D-07 may name a
 * retired family (`tajawal`, `noto-arabic`). The backend now accepts only Cairo and the family selector is gone,
 * so the editor would otherwise load a source it can never save, with Reset as the only way out.
 */
export function editableSource<T extends { typography: { family: string } }>(source: T): T {
  const copy = clone(source);
  copy.typography = { ...copy.typography, family: 'cairo' };
  return copy;
}

/** True when a stored source names a family other than Cairo, retired by decision D-07. */
export function namesRetiredFamily(source: { typography: { family: string } }): boolean {
  return source.typography.family !== 'cairo';
}

export function recoveryKey(adminId: number, revisionId: number) {
  return `orderak:theme-recovery:${adminId}:${revisionId}`;
}

export function recoveryIsCurrent(expiresAt: number, now = Date.now()) {
  return Number.isFinite(expiresAt) && expiresAt > now && expiresAt <= now + RECOVERY_DAYS_MS;
}

function sortKeys(_key: string, value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return sorted;
}

export function deepEqual(a: unknown, b: unknown) {
  return JSON.stringify(a, sortKeys) === JSON.stringify(b, sortKeys);
}

/** Apply only fields changed locally relative to the original base. */
export function patchChanged<T>(original: T, current: T, local: T): T {
  if (typeof local !== 'object' || local === null || Array.isArray(local)) {
    return deepEqual(original, local) ? current : local;
  }
  const result = clone(current) as Record<string, unknown>;
  for (const key of Object.keys(local as Record<string, unknown>)) {
    result[key] = patchChanged(
      (original as Record<string, unknown>)?.[key],
      (current as Record<string, unknown>)?.[key],
      (local as Record<string, unknown>)[key],
    );
  }
  return result as T;
}
