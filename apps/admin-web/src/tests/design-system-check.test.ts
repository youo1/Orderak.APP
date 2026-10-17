import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const backendRoot = path.join(repositoryRoot, 'services', 'backend');
const script = path.join(backendRoot, 'scripts', 'generate-design-system-fixture.ts');
const tsxCli = createRequire(path.join(backendRoot, 'package.json')).resolve('tsx/cli');

const BUNDLE = 'apps/admin-web/src/orderak-tokens.css';
/** Every file the fixture script writes; the script resolves them from its working directory's workspace. */
const GENERATED = [
  'design/design-system.default.json',
  'apps/seller-android/app/src/main/java/app/orderak/seller/core/ui/theme/DesignSystemContract.kt',
  'apps/seller-android/app/src/main/java/app/orderak/seller/core/ui/theme/GeneratedDesignSystem.kt',
  BUNDLE,
];

const sandboxes: string[] = [];
const at = (root: string, relative: string): string => path.join(root, ...relative.split('/'));

function sandbox(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'orderak-design-check-'));
  sandboxes.push(root);
  for (const relative of GENERATED) {
    mkdirSync(path.dirname(at(root, relative)), { recursive: true });
    cpSync(at(repositoryRoot, relative), at(root, relative));
  }
  mkdirSync(at(root, 'services/backend'), { recursive: true });
  return root;
}

function fixtureScript(root: string, ...args: string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [tsxCli, script, ...args], {
    cwd: at(root, 'services/backend'),
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

afterAll(() => {
  for (const root of sandboxes) rmSync(root, { recursive: true, force: true });
});

describe('design-system:generate and design-system:check cover the admin bundle', () => {
  it('regenerates every committed output byte for byte, including the admin bundle', () => {
    const root = sandbox();
    const generated = fixtureScript(root, '--write');
    expect(generated.status, generated.output).toBe(0);
    for (const relative of GENERATED) {
      expect(readFileSync(at(root, relative), 'utf8') === readFileSync(at(repositoryRoot, relative), 'utf8'), `${relative} drifted from the generator`).toBe(true);
    }
    const checked = fixtureScript(root);
    expect(checked.status, checked.output).toBe(0);
  }, 120_000);

  it('fails the check on a hand edit to the bundle and names the regenerate command', () => {
    const root = sandbox();
    const clean = fixtureScript(root);
    expect(clean.status, clean.output).toBe(0);

    const bundlePath = at(root, BUNDLE);
    const original = readFileSync(bundlePath, 'utf8');
    const edited = original.replace('--orderak-minimum-touch-target:48px', '--orderak-minimum-touch-target:47px');
    expect(edited).not.toBe(original);
    writeFileSync(bundlePath, edited);

    const drifted = fixtureScript(root);
    expect(drifted.status, drifted.output).not.toBe(0);
    expect(drifted.output).toContain('pnpm run design-system:generate');
  }, 120_000);
});
