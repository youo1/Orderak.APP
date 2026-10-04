import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const sandboxes: string[] = [];

// verify-theme-authority.mjs scans .ts files for a second import of the token
// sources, so the import text is assembled here rather than written out.
const IMPORT = ['@imp', 'ort'].join('');

/** A copy of the verifiers and the admin sources; each verifier resolves the repository from its own path. */
function sandbox(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'orderak-admin-guards-'));
  sandboxes.push(root);
  cpSync(path.join(repositoryRoot, 'tooling', 'repository'), path.join(root, 'tooling', 'repository'), { recursive: true });
  const testsDir = path.join(repositoryRoot, 'apps', 'admin-web', 'src', 'tests');
  cpSync(path.join(repositoryRoot, 'apps', 'admin-web', 'src'), path.join(root, 'apps', 'admin-web', 'src'), {
    recursive: true,
    filter: (source: string): boolean => !source.startsWith(testsDir) && !source.includes('node_modules'),
  });
  cpSync(path.join(repositoryRoot, 'apps', 'admin-web', 'components.json'), path.join(root, 'apps', 'admin-web', 'components.json'));
  return root;
}

function run(root: string, script: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [path.join(root, 'tooling', 'repository', script)], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function write(root: string, relative: string, text: string): void {
  const file = path.join(root, 'apps', 'admin-web', 'src', ...relative.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

afterAll(() => {
  for (const root of sandboxes) rmSync(root, { recursive: true, force: true });
});

describe('verify-admin-token-conformance.mjs', () => {
  const CONFORMANCE = 'verify-admin-token-conformance.mjs';

  it('passes on the committed tree, with pending tokens counted as declared', () => {
    const root = sandbox();
    expect(run(root, CONFORMANCE).status, run(root, CONFORMANCE).output).toBe(0);
    write(root, 'zz-pending-probe.css', '.pending-probe { transition: var(--orderak-motion-fast); width: var(--orderak-sidebar-width); box-shadow: var(--orderak-shadow-card); outline: var(--orderak-focus-ring); }\n');
    const result = run(root, CONFORMANCE);
    expect(result.status, result.output).toBe(0);
  }, 60_000);

  it('fails a hard-coded colour in a normal admin stylesheet', () => {
    const root = sandbox();
    const literals = ['#123456', '#fff', 'rgb(1 2 3)', 'rgba(1, 2, 3, .5)', 'hsl(120 50% 50%)', 'hsla(120, 50%, 50%, .5)', 'oklch(60% 0.1 200)'];
    for (const literal of literals) {
      write(root, 'zz-colour-probe.css', `.colour-probe { color: ${literal}; }\n`);
      const result = run(root, CONFORMANCE);
      expect(result.status, `${literal} was accepted:\n${result.output}`).not.toBe(0);
    }
  }, 120_000);

  it('exempts only the two exact token-source files, not their names elsewhere', () => {
    const root = sandbox();
    write(root, 'features/zz/orderak-tokens.css', '.colour-probe { color: #123456; }\n');
    const result = run(root, CONFORMANCE);
    expect(result.status, result.output).not.toBe(0);
  }, 60_000);

  it('fails a full-opacity scrim background and accepts the 48% mix', () => {
    const root = sandbox();
    for (const property of ['background', 'background-color']) {
      write(root, 'zz-scrim-probe.css', `.scrim-probe { ${property}: var(--orderak-scrim); }\n`);
      const result = run(root, CONFORMANCE);
      expect(result.status, `${property} at full opacity was accepted:\n${result.output}`).not.toBe(0);
    }
    write(root, 'zz-scrim-probe.css', '.scrim-probe { background: color-mix(in oklch, var(--orderak-scrim) 48%, transparent); }\n');
    const accepted = run(root, CONFORMANCE);
    expect(accepted.status, accepted.output).toBe(0);
  }, 60_000);
});

describe('verify-theme-authority.mjs', () => {
  const AUTHORITY = 'verify-theme-authority.mjs';
  const indexPath = (root: string): string => path.join(root, 'apps', 'admin-web', 'src', 'index.css');
  const isPendingImport = (line: string): boolean => line.trim().startsWith(IMPORT) && line.includes('orderak-tokens-pending.css');

  it('passes on the committed tree', () => {
    const root = sandbox();
    const result = run(root, AUTHORITY);
    expect(result.status, result.output).toBe(0);
  }, 60_000);

  it('fails when the pending import is missing', () => {
    const root = sandbox();
    const text = readFileSync(indexPath(root), 'utf8');
    writeFileSync(indexPath(root), text.split(/\r?\n/).filter((line) => !isPendingImport(line)).join('\n'));
    const result = run(root, AUTHORITY);
    expect(result.status, result.output).not.toBe(0);
  }, 60_000);

  it('fails when the pending import leaves layer(orderak-fallback)', () => {
    const root = sandbox();
    const text = readFileSync(indexPath(root), 'utf8');
    const unlayered = `${IMPORT} "./orderak-tokens-pending.css";`;
    let replaced = false;
    const lines = text.split(/\r?\n/).map((line) => {
      if (!isPendingImport(line)) return line;
      replaced = true;
      return unlayered;
    });
    expect(replaced).toBe(true);
    writeFileSync(indexPath(root), lines.join('\n'));
    const result = run(root, AUTHORITY);
    expect(result.status, result.output).not.toBe(0);
  }, 60_000);

  it('fails when another stylesheet also imports the pending tokens', () => {
    const root = sandbox();
    write(root, 'features/zz-second-import.css', `${IMPORT} "../orderak-tokens-pending.css";\n`);
    const result = run(root, AUTHORITY);
    expect(result.status, result.output).not.toBe(0);
  }, 60_000);
});
