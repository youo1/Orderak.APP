import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('backend-ci runs the admin accessibility gate', () => {
  it('installs Chromium with its system dependencies and runs test:a11y', () => {
    const workflow = readFileSync(resolve(process.cwd(), '../../.github/workflows/backend-ci.yml'), 'utf8');
    expect(workflow).toMatch(/playwright install --with-deps chromium/);
    expect(workflow).toMatch(/pnpm --dir apps\/admin-web run test:a11y/);
  });
});
