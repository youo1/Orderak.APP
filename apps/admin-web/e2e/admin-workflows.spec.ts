import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dashboard = {
  stores: { total: 12, active: 10 },
  buyers: { total: 31 },
  subscriptions: { total: 12, active: 9, grace: 1 },
  support: { open: 2, high: 1 },
  deletions: { actionable: 1 },
  security: { open: 0, critical: 0 },
  sessions: { active: 1 },
  generated_at: '2026-07-21T00:00:00Z',
};

function session(role: 'owner' | 'support' | 'readonly', permissions: string[]) {
  return {
    ok: true,
    admin: { id: 1, email: `${role}@orderak.app`, name: role, role, lang: 'en', timezone: 'Africa/Cairo', mfaEnabled: true, mustChangePassword: false },
    permissions,
    csrf_token: 'csrf-e2e-token',
    server_time: '2026-07-21T00:00:00Z',
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function routeDashboard(page: Page) {
  await page.route('**/api/admin/v1/control-plane/dashboard', route => json(route, dashboard));
}

test('password and TOTP establish the protected admin session', async ({ page }) => {
  let authenticated = false;
  await routeDashboard(page);
  await page.route('**/api/admin/v1/auth/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return authenticated ? json(route, session('owner', ['*'])) : json(route, { error: 'unauthorized' }, 401);
    if (path.endsWith('/login')) return json(route, { mfa_required: true, mfa_token: 'mfa-challenge' });
    if (path.endsWith('/mfa')) { authenticated = true; return json(route, session('owner', ['*'])); }
    return json(route, { ok: true });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Orderak Control Center' })).toBeVisible();
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
  await page.getByLabel('Six-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Truthful control policy is active')).toBeVisible();
});

test('permission-aware navigation hides and rejects unavailable modules', async ({ page }) => {
  await routeDashboard(page);
  await page.route('**/api/admin/v1/auth/me', route => json(route, session('readonly', ['dashboard:view', 'sellers:view'])));
  await page.route('**/api/admin/v1/stores', route => json(route, { stores: [] }));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Stores', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Plans & limits', exact: true })).toHaveCount(0);
  await page.goto('/commerce/plans');
  await expect(page).toHaveURL('http://127.0.0.1:4174/');
});

test('desktop navigation can be hidden, restored, and remembered without changing the mobile drawer', async ({ page }) => {
  await routeDashboard(page);
  await page.route('**/api/admin/v1/auth/me', route => json(route, session('readonly', ['dashboard:view', 'sellers:view'])));
  await page.goto('/');

  const navigation = page.locator('#admin-navigation');
  const toggle = page.getByRole('button', { name: 'Hide navigation' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Show navigation' })).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('orderak:admin-sidebar:1'))).toBe('hidden');
  await expect(page.locator('.workspace')).toHaveCSS('margin-left', '0px');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Show navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Show navigation' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('orderak:admin-sidebar:1'))).toBe('visible');

  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(navigation).toHaveAttribute('aria-hidden', 'false');
  await expect(navigation.getByRole('button', { name: 'Close navigation' })).toBeVisible();
});

test('support agent opens a ticket and sends an audited CSRF-protected reply', async ({ page }) => {
  let replyBody = '';
  let csrf = '';
  await routeDashboard(page);
  await page.route('**/api/admin/v1/auth/me', route => json(route, session('support', ['dashboard:view', 'support:view', 'support:manage'])));
  await page.route('**/api/admin/v1/support/tickets', route => json(route, { tickets: [{ id: 7, subject: 'Unable to log in', store_name: 'Cairo Market', status: 'open', priority: 'high', updated_at: '2026-07-21 00:00:00' }] }));
  await page.route('**/api/admin/v1/support/tickets/7', async route => {
    if (route.request().method() === 'POST') {
      replyBody = route.request().postData() || '';
      csrf = route.request().headers()['x-csrf-token'] || '';
      return json(route, { ok: true });
    }
    return json(route, { ticket: { id: 7, subject: 'Unable to log in', status: 'open', priority: 'high', created_at: '2026-07-20 23:00:00' }, messages: [{ id: 1, sender: 'seller', body: 'Please help', created_at: '2026-07-20 23:01:00' }] });
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Support', exact: true }).click();
  await page.getByText('Unable to log in').click();
  await page.getByLabel('Reply').fill('Your access has been restored.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect.poll(() => replyBody).toContain('Your access has been restored.');
  expect(csrf).toBe('csrf-e2e-token');
});

test('audit log renders through the Refine data provider, and only a 401 ends the session', async ({ page }) => {
  let auditMode: 'ok' | 'forbidden' | 'unauthorized' = 'ok';
  await routeDashboard(page);
  await page.route('**/api/admin/v1/auth/me', route => json(route, session('owner', ['dashboard:view', 'audit:view'])));
  await page.route('**/api/admin/v1/audit', route => {
    if (auditMode === 'forbidden') return json(route, { code: 'forbidden', detail: 'Not permitted' }, 403);
    if (auditMode === 'unauthorized') return json(route, { code: 'unauthorized' }, 401);
    return json(route, { audit: [{ id: 1, admin_email: 'owner@orderak.app', action: 'theme.publish', entity: 'design_system_revisions', entity_id: '2', ip: '10.0.0.1', created_at: '2026-07-21 00:00:00' }] });
  });

  await page.goto('/system/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'owner@orderak.app' })).toBeVisible();

  // A 403 (RBAC-denied) must show an in-place error without ending the
  // session — see the Refine install plan's non-goal against conflating a
  // 401 with a 403.
  auditMode = 'forbidden';
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('heading', { name: 'Could not load this section' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Orderak Control Center' })).toHaveCount(0);

  // A 401 (session invalid) must still end the session, exactly as it did
  // before Refine was introduced.
  auditMode = 'unauthorized';
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('heading', { name: 'Orderak Control Center' })).toBeVisible();
});

test('tasks: create, edit, and delete a record through the Refine data provider', async ({ page }) => {
  let tasks: Array<Record<string, unknown>> = [];
  let nextId = 1;
  await routeDashboard(page);
  await page.route('**/api/admin/v1/auth/me', route => json(route, session('owner', ['dashboard:view', 'tasks:view', 'tasks:manage'])));
  await page.route('**/api/admin/v1/tasks', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      const id = nextId++;
      tasks.push({ id, title: body.title, description: body.description ?? '', status: body.status ?? 'todo', priority: body.priority ?? 'medium', assigned_to: body.assigned_to ?? '', related_area: body.related_area ?? '' });
      return json(route, { ok: true, id }, 201);
    }
    return json(route, { ok: true, tasks });
  });
  await page.route('**/api/admin/v1/tasks/*', async route => {
    const id = Number(new URL(route.request().url()).pathname.split('/').pop());
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      tasks = tasks.map(task => task.id === id ? { ...task, ...body, id } : task);
      return json(route, { ok: true });
    }
    if (route.request().method() === 'DELETE') {
      tasks = tasks.filter(task => task.id !== id);
      return json(route, { ok: true });
    }
    return json(route, { ok: true });
  });

  await page.goto('/internal/tasks');
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();

  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title *').fill('Verify Refine write path');
  await page.getByLabel('Assignee').fill('owner@orderak.app');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('cell', { name: 'Verify Refine write path' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'owner@orderak.app' })).toBeVisible();

  await page.getByRole('cell', { name: 'Verify Refine write path' }).click();
  await expect(page.getByRole('heading', { name: 'Edit task' })).toBeVisible();
  await page.getByLabel('Status').selectOption('done');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: 'done' })).toBeVisible();

  await page.getByRole('cell', { name: 'Verify Refine write path' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('cell', { name: 'Verify Refine write path' })).toHaveCount(0);
});

test('translations: approving a row refetches the Refine-backed list, not a stale query key', async ({ page }) => {
  let status = 'pending';
  await routeDashboard(page);
  await page.route('**/api/admin/v1/auth/me', route => json(route, session('owner', ['dashboard:view', 'translations:view', 'translations:manage'])));
  await page.route('**/api/admin/v1/product-translations', route => json(route, { translations: [{ product_code: 'PRD-1', lang: 'ar', status, title: 'Sample product', updated_at: '2026-07-21 00:00:00' }] }));
  await page.route('**/api/admin/v1/product-translations/PRD-1/ar', async route => {
    const body = route.request().postDataJSON();
    status = body.status;
    return json(route, { ok: true });
  });

  await page.goto('/communication/translations');
  await expect(page.getByRole('heading', { name: 'Translations' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'pending' })).toBeVisible();

  await page.getByRole('cell', { name: 'PRD-1' }).click();
  await page.getByRole('button', { name: 'Approve current translation' }).click();
  // This is the regression the Refine migration could have introduced:
  // TranslationActions used to invalidate the old `['resource','translations']`
  // TanStack Query key after mutating, which nothing subscribes to any more
  // now that the list is fetched through Refine's own (differently-keyed)
  // query — it must call the passed-down `refetch` instead, or this row
  // would silently stay on "pending" forever after a successful approval.
  await expect(page.getByRole('cell', { name: 'reviewed' })).toBeVisible();
});

test('theme manager previews and applies an immutable generated checkpoint', async ({ page }) => {
  const artifact = JSON.parse(readFileSync(resolve(process.cwd(), '..', 'design', 'design-system.default.json'), 'utf8'));
  const snapshot = artifact.snapshot;
  let publishedBody: Record<string, unknown> | null = null;
  let csrf = '';
  const active = {
    id: 1,
    name: null,
    source: snapshot.source,
    overrides: {},
    snapshot,
    validation: snapshot.validation,
    contentHash: snapshot.contentHash,
    generatorVersion: snapshot.generatorVersion,
    publishedAt: '2026-07-28T00:00:00Z',
  };
  await routeDashboard(page);
  await page.route('**/api/admin/v1/auth/me', route => json(route, session('owner', ['dashboard:view', 'theme:view', 'theme:manage'])));
  await page.route('**/api/admin/v1/theme', async route => {
    if (route.request().method() === 'PUT') {
      publishedBody = route.request().postDataJSON();
      csrf = route.request().headers()['x-csrf-token'] || '';
      const nextSource = (publishedBody as { source: unknown }).source;
      const nextSnapshot = { ...snapshot, source: nextSource };
      return json(route, {
        ok: true,
        active: { ...active, id: 2, source: nextSource, snapshot: nextSnapshot, contentHash: 'published-hash' },
      });
    }
    return json(route, {
      ok: true,
      activeRevisionId: 1,
      active,
      defaults: snapshot.source,
      approvedFonts: ['cairo', 'tajawal', 'noto-arabic'],
      capabilities: { generatorVersion: snapshot.generatorVersion, maxOverrides: 128, maxBodyBytes: 65_536 },
      generatorUpgradePreview: null,
    });
  });
  await page.route('**/api/admin/v1/theme/preview', route => json(route, { ok: true, snapshot }));

  await page.goto('/system/theme');
  await expect(page.getByRole('heading', { name: 'Theme Builder' })).toBeVisible();
  const preview = page.frameLocator('iframe[title="Isolated design system preview"]');
  await expect(preview.getByRole('heading', { name: 'Run your store with confidence' })).toBeVisible();
  await page.getByLabel('primary hex value').fill('#224488');
  await expect(page.getByRole('button', { name: 'Apply as current' }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Apply as current' }).first().click();
  await expect(page.getByRole('heading', { name: 'Apply this configuration as current?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply as current' }).click();
  await expect(page.getByText('Revision 2 is now current.')).toBeVisible();
  expect(publishedBody).toMatchObject({ baseRevisionId: 1 });
  expect(csrf).toBe('csrf-e2e-token');
});

test('revision history groups current, saved, and recent checkpoints with managed actions', async ({ page }) => {
  const artifact = JSON.parse(readFileSync(resolve(process.cwd(), '..', 'design', 'design-system.default.json'), 'utf8'));
  const snapshot = artifact.snapshot;
  const active = {
    id: 3,
    name: null,
    source: snapshot.source,
    overrides: {},
    snapshot,
    validation: snapshot.validation,
    contentHash: snapshot.contentHash,
    generatorVersion: snapshot.generatorVersion,
    publishedAt: '2026-07-28T03:00:00Z',
  };
  let namedBody: Record<string, unknown> | null = null;
  let activatedBody: Record<string, unknown> | null = null;
  let deletedId: number | null = null;

  await routeDashboard(page);
  await page.route('**/api/admin/v1/auth/me', route => json(route, session('owner', ['dashboard:view', 'theme:view', 'theme:manage', 'theme:rollback'])));
  await page.route('**/api/admin/v1/theme', route => {
    return json(route, {
      ok: true,
      activeRevisionId: active.id,
      active,
      defaults: snapshot.source,
      approvedFonts: ['cairo', 'tajawal', 'noto-arabic'],
      capabilities: { generatorVersion: snapshot.generatorVersion, maxOverrides: 128, maxBodyBytes: 65_536 },
      generatorUpgradePreview: null,
    });
  });
  await page.route('**/api/admin/v1/theme/preview', route => json(route, { ok: true, snapshot }));
  await page.route('**/api/admin/v1/theme/revisions**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const match = /\/revisions\/(\d+)(?:\/activate)?$/.exec(url.pathname);
    if (request.method() === 'PATCH' && match) {
      namedBody = request.postDataJSON();
      return json(route, { ok: true, revision: { id: Number(match[1]), name: String(namedBody.name).trim() } });
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/activate') && match) {
      activatedBody = request.postDataJSON();
      return json(route, { ok: true, activeRevisionId: 4, active: { ...active, id: 4 } });
    }
    if (request.method() === 'DELETE' && match) {
      deletedId = Number(match[1]);
      return json(route, { ok: true, deletedRevisionId: deletedId });
    }
    if (url.searchParams.get('kind') === 'saved') {
      return json(route, { ok: true, revisions: [{
        id: 1, name: 'Launch palette', schema_version: 2, generator_version: snapshot.generatorVersion,
        content_hash: 'saved-hash', created_by: 1, created_at: '2026-07-28T01:00:00Z',
        published_at: '2026-07-28T01:00:00Z', rollback_of_revision_id: null, is_current: 0,
      }], nextBeforeRevisionId: null });
    }
    return json(route, { ok: true, revisions: [{
      id: 2, name: null, schema_version: 2, generator_version: snapshot.generatorVersion,
      content_hash: 'checkpoint-hash', created_by: 1, created_at: '2026-07-28T02:00:00Z',
      published_at: '2026-07-28T02:00:00Z', rollback_of_revision_id: null, is_current: 0,
    }], nextBeforeRevisionId: null });
  });

  await page.goto('/system/theme');
  await page.getByRole('tab', { name: 'Revision history' }).click();
  await expect(page.getByRole('heading', { name: 'Current configuration' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saved configurations' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent checkpoints' })).toBeVisible();

  const recent = page.getByRole('heading', { name: 'Recent checkpoints' }).locator('..');
  await recent.getByRole('button', { name: 'Save version' }).click();
  await page.getByLabel('Configuration name').fill('Evening campaign');
  await page.getByRole('dialog').getByRole('button', { name: 'Save name' }).click();
  await expect.poll(() => namedBody).toMatchObject({ name: 'Evening campaign' });

  const savedGroup = page.getByRole('heading', { name: 'Saved configurations' }).locator('..');
  await savedGroup.getByRole('button', { name: 'Make current' }).click();
  await expect.poll(() => activatedBody).toMatchObject({ baseRevisionId: 3 });

  await savedGroup.getByRole('button', { name: 'Delete permanently' }).click();
  await page.getByLabel('Permanent deletion confirmation').fill('Launch palette');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect.poll(() => deletedId).toBe(1);
});
