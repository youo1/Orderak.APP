import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/shared/api/client')>('@/shared/api/client');
  return { ...actual, api: vi.fn() };
});

import { api, ApiError } from '@/shared/api/client';
import { dataProvider } from '@/shared/refine/data-provider';

const mockedApi = vi.mocked(api);

beforeEach(() => {
  mockedApi.mockReset();
});

describe('dataProvider.getList', () => {
  it('calls the resource endpoint from sections.ts and extracts its result key', async () => {
    mockedApi.mockResolvedValueOnce({ ok: true, audit: [{ id: 1 }, { id: 2 }] });
    const result = await dataProvider.getList({ resource: 'audit' } as never);
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/v1/audit', undefined);
    expect(result).toEqual({ data: [{ id: 1 }, { id: 2 }], total: 2 });
  });

  it('handles an empty result without throwing', async () => {
    mockedApi.mockResolvedValueOnce({ ok: true, audit: [] });
    const result = await dataProvider.getList({ resource: 'audit' } as never);
    expect(result).toEqual({ data: [], total: 0 });
  });

  it('throws for a resource with no configured endpoint', async () => {
    await expect(dataProvider.getList({ resource: 'not-a-real-section' } as never)).rejects.toThrow(/No admin API endpoint configured/);
  });
});

describe('dataProvider.getOne', () => {
  it('finds the row matching id out of the full list the endpoint returns', async () => {
    mockedApi.mockResolvedValueOnce({ ok: true, audit: [{ id: 1, action: 'a' }, { id: 2, action: 'b' }] });
    const result = await dataProvider.getOne({ resource: 'audit', id: 2 } as never);
    expect(result).toEqual({ data: { id: 2, action: 'b' } });
  });

  it('throws a 404-shaped error when no row matches', async () => {
    mockedApi.mockResolvedValueOnce({ ok: true, audit: [{ id: 1 }] });
    await expect(dataProvider.getOne({ resource: 'audit', id: 999 } as never)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('dataProvider.create', () => {
  it('POSTs to the resource endpoint and merges the submitted fields into the sparse response', async () => {
    mockedApi.mockResolvedValueOnce({ ok: true, id: 7 });
    const result = await dataProvider.create({ resource: 'tasks', variables: { title: 'Ship it', status: 'todo' } } as never);
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/v1/tasks', { method: 'POST', body: JSON.stringify({ title: 'Ship it', status: 'todo' }) });
    expect(result).toEqual({ data: { title: 'Ship it', status: 'todo', ok: true, id: 7 } });
  });
});

describe('dataProvider.update', () => {
  it('PUTs to /resource/:id (not PATCH) and merges id + submitted fields into the response', async () => {
    mockedApi.mockResolvedValueOnce({ ok: true });
    const result = await dataProvider.update({ resource: 'tasks', id: 7, variables: { status: 'done' } } as never);
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/v1/tasks/7', { method: 'PUT', body: JSON.stringify({ status: 'done' }) });
    expect(result).toEqual({ data: { id: 7, status: 'done', ok: true } });
  });
});

describe('dataProvider.deleteOne', () => {
  it('DELETEs /resource/:id and returns the id', async () => {
    mockedApi.mockResolvedValueOnce({ ok: true });
    const result = await dataProvider.deleteOne({ resource: 'tasks', id: 7 } as never);
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/v1/tasks/7', { method: 'DELETE' });
    expect(result).toEqual({ data: { id: 7 } });
  });
});

describe('dataProvider.custom', () => {
  it('sends the given method/payload and preserves the response', async () => {
    mockedApi.mockResolvedValueOnce({ ok: true });
    await dataProvider.custom!({ url: '/api/admin/v1/content-configs/1/publish', method: 'post', payload: {} } as never);
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/v1/content-configs/1/publish', { method: 'POST', body: '{}' });
  });
});

describe('error shape preservation (401 vs 403)', () => {
  it('preserves a 403 as statusCode 403, not swallowed or reclassified as 401', async () => {
    mockedApi.mockRejectedValueOnce(new ApiError(403, 'forbidden', 'Not permitted'));
    await expect(dataProvider.getList({ resource: 'audit' } as never)).rejects.toMatchObject({ statusCode: 403, message: 'Not permitted' });
  });

  it('preserves a 401 as statusCode 401', async () => {
    mockedApi.mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'Session expired'));
    await expect(dataProvider.getList({ resource: 'audit' } as never)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('passes through a non-ApiError rejection unchanged', async () => {
    mockedApi.mockRejectedValueOnce(new TypeError('network down'));
    await expect(dataProvider.getList({ resource: 'audit' } as never)).rejects.toBeInstanceOf(TypeError);
  });
});
