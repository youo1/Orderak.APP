import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Sentry from '@sentry/react';
import { ADMIN_SENTRY_OPTIONS } from '@/app/sentry-options';

// vitest runs this file with cwd = apps/admin-web (pnpm --dir apps/admin-web ...).
const root = process.cwd();

// The admin screens are searched by seller and buyer phone number, and the
// search lands in the URL. Sentry 11 sends URL query values, and tells Sentry
// to record the visitor's IP address (`infer_ip: "auto"`), unless it is told
// not to.
describe('admin Sentry data collection', () => {
  it('sends no phone number from the URL and no IP address', async () => {
    const sent: unknown[] = [];
    window.history.pushState({}, '', '/sellers?phone=%2B201000000777&q=201000000777');
    Sentry.init({
      ...ADMIN_SENTRY_OPTIONS,
      dsn: 'https://public@sentry.example.test/1',
      transport: () => ({
        send: async (envelope) => {
          sent.push(envelope);
          return {};
        },
        flush: async () => true,
      }),
    });
    Sentry.captureException(new Error('sentry-data-collection probe'));
    await Sentry.flush(2000);

    const wire = JSON.stringify(sent);
    expect(wire).toContain('sentry-data-collection probe');
    expect(wire).toContain('/sellers');
    expect(wire).not.toContain('201000000777');
    expect(wire).toContain('"infer_ip":"never"');
    expect(wire).not.toContain('{{auto}}');
  });

  it('main.tsx starts Sentry with these options', () => {
    const main = readFileSync(resolve(root, 'src/app/main.tsx'), 'utf8');
    expect(main).toMatch(/Sentry\.init\(\{\s*\.\.\.ADMIN_SENTRY_OPTIONS,/);
  });
});
