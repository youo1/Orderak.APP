import type { BaseRecord, DataProvider } from '@refinedev/core';
import { api, ApiError } from '@/shared/api/client';
import { sectionById } from '@/app/config/sections';
import { rowsForResource, type Row } from './resource-shape';

/**
 * Wraps the existing `api()` client; introduces no second HTTP client and no
 * change to CSRF/session/response shapes. Refine-shaped errors carry
 * `statusCode` so `access-control-provider.ts` and `auth-provider.ts` can
 * tell a 401 (session invalid) apart from a 403 (RBAC-denied) — never
 * collapse that distinction here.
 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError) {
      throw { message: error.message, statusCode: error.status, code: error.code, details: error.details };
    }
    throw error;
  }
}

function sectionFor(resource: string) {
  const section = sectionById[resource];
  if (!section?.endpoint) throw new Error(`No admin API endpoint configured for resource "${resource}".`);
  return section;
}

// The admin API returns untyped JSON per resource (there's no per-resource
// TypeScript model on the server side to check against), so every method
// below is generic over Refine's `TData` and casts our real `Row`/`Row[]`
// into it at the boundary — the same trust boundary the existing `api<T>()`
// client already has at every call site.
export const dataProvider: DataProvider = {
  getApiUrl: () => '/api/admin/v1',

  // The admin API isn't paginated: it returns the full collection per
  // request. Callers should use `pagination: { mode: 'client' }` in
  // `useTable`/`useList` so Refine paginates client-side against this.
  getList: async <TData extends BaseRecord = BaseRecord>({ resource }: { resource: string }) => {
    const section = sectionFor(resource);
    const payload = await call<Row>(section.endpoint!);
    const data = rowsForResource(payload, section.resultKeys || []);
    return { data: data as unknown as TData[], total: data.length };
  },

  getOne: async <TData extends BaseRecord = BaseRecord>({ resource, id }: { resource: string; id: BaseRecord['id'] }) => {
    const section = sectionFor(resource);
    const payload = await call<Row>(section.endpoint!);
    const rows = rowsForResource(payload, section.resultKeys || []);
    const data = rows.find(row => String(row.id) === String(id));
    if (!data) throw { message: `${resource} ${id} not found`, statusCode: 404 };
    return { data: data as unknown as TData };
  },

  // Plain CRUD only for resources whose endpoint really is one, and only
  // once the specific resource's real HTTP verbs are confirmed against the
  // backend route (see admin-project.ts for the "project control center"
  // domain: POST create, PUT `/resource/:id` update, DELETE
  // `/resource/:id` delete — confirmed for tasks/bugs and siblings in that
  // same file; re-verify before relying on this for a resource in a
  // different domain). Named workflow actions (approve/reject/publish/
  // transition) are domain commands, not disguised updates — call them
  // through `custom()` (or, for the step-up-authorized export flow,
  // through the existing `ExportDownload` component directly, bypassing
  // Refine entirely).
  //
  // These endpoints mostly return `{ ok: true }` or `{ ok: true, id }`, not
  // the full row (see e.g. createTask/updateTask in admin-project.ts) — the
  // submitted `variables` are merged back in under the server's response so
  // the UI has a complete record to show immediately, rather than waiting
  // on Refine's post-mutation list invalidation to refetch it.
  create: async <TData extends BaseRecord = BaseRecord>({ resource, variables }: { resource: string; variables: unknown }) => {
    const section = sectionFor(resource);
    const response = await call<Row>(section.endpoint!, { method: 'POST', body: JSON.stringify(variables) });
    return { data: { ...(variables as Row), ...response } as unknown as TData };
  },

  update: async <TData extends BaseRecord = BaseRecord>({ resource, id, variables }: { resource: string; id: BaseRecord['id']; variables: unknown }) => {
    const section = sectionFor(resource);
    const response = await call<Row>(`${section.endpoint}/${encodeURIComponent(String(id))}`, { method: 'PUT', body: JSON.stringify(variables) });
    return { data: { id, ...(variables as Row), ...response } as unknown as TData };
  },

  deleteOne: async <TData extends BaseRecord = BaseRecord>({ resource, id }: { resource: string; id: BaseRecord['id'] }) => {
    const section = sectionFor(resource);
    await call<Row>(`${section.endpoint}/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
    return { data: { id } as unknown as TData };
  },

  custom: async <TData extends BaseRecord = BaseRecord>({ url, method = 'get', payload }: { url: string; method?: string; payload?: unknown }) => {
    const data = await call<Row>(url, {
      method: method.toUpperCase(),
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    return { data: data as unknown as TData };
  },
};
