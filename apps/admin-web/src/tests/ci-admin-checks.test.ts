import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Deploy Staging and Deploy Production run these; without them in backend-ci a
// dependency bump that breaks the admin passes its pull request and fails at deploy.
describe('backend-ci runs the admin checks the deploy workflows run', () => {
  it('runs the admin unit tests, end-to-end tests, lint and edge Worker types check', () => {
    const workflow = readFileSync(resolve(process.cwd(), '../../.github/workflows/backend-ci.yml'), 'utf8');
    expect(workflow).toMatch(/pnpm --dir apps\/admin-web run test\s*$/m);
    expect(workflow).toMatch(/pnpm --dir apps\/admin-web run test:e2e/);
    expect(workflow).toMatch(/pnpm --dir apps\/admin-web run lint/);
    expect(workflow).toMatch(/pnpm --dir apps\/admin-web run cf-types:check/);
  });
});
