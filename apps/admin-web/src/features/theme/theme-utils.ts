export const RECOVERY_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function recoveryKey(adminId: number, revisionId: number) {
  return `orderak:theme-recovery:${adminId}:${revisionId}`;
}

export function recoveryIsCurrent(expiresAt: number, now = Date.now()) {
  return Number.isFinite(expiresAt) && expiresAt > now && expiresAt <= now + RECOVERY_DAYS_MS;
}

export function deepEqual(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
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
