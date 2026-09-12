// The admin edge Worker's behaviour, tested directly.
//
// Playwright cannot reach any of this: playwright.config.ts points at the Vite
// dev server, which never runs src/edge/worker.ts. So the Worker's own
// decisions — which host it answers on, what it does when the theme origin is
// down — have no coverage unless it is imported and called here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '@/edge/worker';

function env(overrides: Record<string, unknown> = {}) {
  return {
    CANONICAL_HOST: 'admin.orderak.app',
    THEME_ORIGIN: 'https://api.orderak.app',
    ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
    ADMIN_WORKER: { fetch: async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }) },
    ...overrides,
  } as never;
}

const call = (url: string, e = env()) => worker.fetch(new Request(url), e);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme stylesheet proxy', () => {
  it('caches a good stylesheet briefly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('body{color:red}', {
      status: 200, headers: { 'content-type': 'text/css' },
    })));

    const res = await call('https://admin.orderak.app/theme.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await res.text()).toContain('color:red');
  });

  it('does not cache, or forward, an upstream failure', async () => {
    // The policy used to be set unconditionally while the upstream status was
    // forwarded, so a 502 was relabelled as CSS and marked publicly cacheable
    // for a minute — one bad response became sixty seconds of them.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', {
      status: 502, headers: { 'content-type': 'text/html' },
    })));

    const res = await call('https://admin.orderak.app/theme.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('text/css');
    // An empty stylesheet, never the upstream error body.
    expect(await res.text()).not.toContain('Bad Gateway');
  });

  it('never passes an upstream set-cookie through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('body{}', {
      status: 200,
      headers: { 'content-type': 'text/css', 'set-cookie': 'leaked=1; Path=/' },
    })));

    const res = await call('https://admin.orderak.app/theme.css');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('host confinement', () => {
  it('refuses a hostname that is not the canonical one', async () => {
    const res = await call('https://orderak-admin-edge.workers.dev/');
    expect(res.status).toBe(404);
  });

  it('hardens admin API responses', async () => {
    const res = await call('https://admin.orderak.app/api/admin/v1/health');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
