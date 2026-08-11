// ============================================================
// Shared Hono context shape for the admin surface.
//
// Lives in its own module so the domain route modules and admin.ts can both
// use it without importing each other.
//
// `admin` and `gate` are set once by the admin pipeline middleware in
// admin.ts; every mounted sub-app reads them from the context instead of
// receiving them as parameters.
// ============================================================

import type { AdminClaims } from "../identity/auth";

/** Returns a permission-denied Response, or null when the admin may proceed. */
export type Gate = (perm: string) => Response | null;

export type AdminEnv = {
	Bindings: AdminWorkerEnv;
	Variables: { admin: AdminClaims; gate: Gate };
};
