import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function srcPath(root: string, relative: string): string {
  return path.join(root, 'apps', 'admin-web', 'src', ...relative.split('/'));
}

function write(root: string, relative: string, text: string): void {
  const file = srcPath(root, relative);
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
    const committed = run(root, CONFORMANCE);
    expect(committed.status, committed.output).toBe(0);
    write(root, 'zz-pending-probe.css', '.pending-probe { transition: var(--orderak-motion-fast); width: var(--orderak-sidebar-width); box-shadow: var(--orderak-shadow-card); outline: var(--orderak-focus-ring); }\n');
    const result = run(root, CONFORMANCE);
    expect(result.status, result.output).toBe(0);
  }, 60_000);

  it('fails every hard-coded colour syntax in a normal admin stylesheet', () => {
    const root = sandbox();
    const literals = [
      '#123456', '#fff', '#ABCDEF80', 'rgb(1 2 3)', 'RGB(1, 2, 3)', 'rgba(1, 2, 3, .5)', 'hsl(120 50% 50%)',
      'hsla(120, 50%, 50%, .5)', 'oklch(60% 0.1 200)', 'OKLCH(60% 0.1 200)', 'oklab(60% 0.1 0.1)', 'lab(50% 20 30)',
      'lch(50% 30 200)', 'hwb(120 10% 10%)', 'color(display-p3 1 0 0)',
      'color-mix(in oklch, oklch(60% 0.1 200) 50%, transparent)',
    ];
    for (const literal of literals) {
      write(root, 'zz-colour-probe.css', `.colour-probe { color: ${literal}; }\n`);
      const result = run(root, CONFORMANCE);
      expect(result.status, `${literal} was accepted:\n${result.output}`).not.toBe(0);
    }
  }, 180_000);

  it('accepts token colours, the approved oklch mix and literals that only appear in comments', () => {
    const root = sandbox();
    write(
      root,
      'zz-accepted-probe.css',
      '/* #123456 rgb(1 2 3) oklch(60% 0.1 200) */\n' +
        '.accepted-probe { color: color-mix(in oklch, var(--orderak-primary) 40%, transparent); border-color: var(--md-sys-color-outline); background: color-mix(in oklch, var(--orderak-scrim) 48%, transparent); }\n',
    );
    const result = run(root, CONFORMANCE);
    expect(result.status, result.output).toBe(0);
  }, 60_000);

  it('does not exempt index.css or the preview stylesheet', () => {
    const indexRoot = sandbox();
    appendFileSync(srcPath(indexRoot, 'index.css'), '\n.zz-index-probe { color: #123456; }\n');
    const index = run(indexRoot, CONFORMANCE);
    expect(index.status, index.output).not.toBe(0);

    const previewRoot = sandbox();
    appendFileSync(srcPath(previewRoot, 'features/theme/preview/preview.css'), '\n.zz-preview-probe { color: #f3fbfa; }\n');
    const preview = run(previewRoot, CONFORMANCE);
    expect(preview.status, preview.output).not.toBe(0);
  }, 60_000);

  it('exempts only the two exact token-source files, not their names elsewhere', () => {
    for (const name of ['orderak-tokens.css', 'orderak-tokens-pending.css']) {
      const root = sandbox();
      write(root, `features/zz/${name}`, '.colour-probe { color: #123456; }\n');
      const result = run(root, CONFORMANCE);
      expect(result.status, `${name}:\n${result.output}`).not.toBe(0);
    }
  }, 60_000);

  it('still fails an unknown token', () => {
    const root = sandbox();
    write(root, 'zz-unknown-probe.css', '.unknown-probe { color: var(--orderak-no-such-token); }\n');
    const result = run(root, CONFORMANCE);
    expect(result.status, result.output).not.toBe(0);
  }, 60_000);

  it('fails a scrim background without the 48% mix and accepts the 48% mix', () => {
    const root = sandbox();
    for (const declaration of [
      'background: var(--orderak-scrim)',
      'background-color: var(--orderak-scrim)',
      'background-color: color-mix(in oklch, var(--orderak-scrim) 100%, transparent)',
    ]) {
      write(root, 'zz-scrim-probe.css', `.scrim-probe { ${declaration}; }\n`);
      const result = run(root, CONFORMANCE);
      expect(result.status, `${declaration} was accepted:\n${result.output}`).not.toBe(0);
    }
    write(root, 'zz-scrim-probe.css', '.scrim-probe { background: color-mix(in oklch, var(--orderak-scrim) 48%, transparent); }\n');
    const accepted = run(root, CONFORMANCE);
    expect(accepted.status, accepted.output).toBe(0);
  }, 90_000);
});

describe('verify-theme-authority.mjs', () => {
  const AUTHORITY = 'verify-theme-authority.mjs';
  const indexPath = (root: string): string => srcPath(root, 'index.css');
  const isImportOf = (line: string, file: string): boolean => {
    const trimmed = line.trim();
    return trimmed.startsWith(IMPORT) && (trimmed.includes(`"./${file}"`) || trimmed.includes(`'./${file}'`));
  };
  const BUNDLE = 'orderak-tokens.css';
  const PENDING = 'orderak-tokens-pending.css';

  function editIndex(root: string, edit: (lines: string[]) => string[]): void {
    const text = readFileSync(indexPath(root), 'utf8');
    writeFileSync(indexPath(root), edit(text.split(/\r?\n/)).join('\n'));
  }

  it('passes on the committed tree', () => {
    const root = sandbox();
    const result = run(root, AUTHORITY);
    expect(result.status, result.output).toBe(0);
  }, 60_000);

  it('fails when either import is missing', () => {
    for (const file of [BUNDLE, PENDING]) {
      const root = sandbox();
      editIndex(root, (lines) => lines.filter((line) => !isImportOf(line, file)));
      const result = run(root, AUTHORITY);
      expect(result.status, `${file}:\n${result.output}`).not.toBe(0);
    }
  }, 60_000);

  it('fails when either import leaves layer(orderak-fallback)', () => {
    for (const file of [BUNDLE, PENDING]) {
      const root = sandbox();
      let replaced = false;
      editIndex(root, (lines) => lines.map((line) => {
        if (!isImportOf(line, file)) return line;
        replaced = true;
        return `${IMPORT} "./${file}";`;
      }));
      expect(replaced).toBe(true);
      const result = run(root, AUTHORITY);
      expect(result.status, `${file}:\n${result.output}`).not.toBe(0);
    }
  }, 60_000);

  it('fails when index.css imports either source twice', () => {
    for (const file of [BUNDLE, PENDING]) {
      const root = sandbox();
      editIndex(root, (lines) => lines.flatMap((line) => (isImportOf(line, file) ? [line, line] : [line])));
      const result = run(root, AUTHORITY);
      expect(result.status, `${file}:\n${result.output}`).not.toBe(0);
    }
  }, 60_000);

  it('fails when another stylesheet also imports the pending tokens', () => {
    const root = sandbox();
    write(root, 'features/zz-second-import.css', `${IMPORT} "../${PENDING}";\n`);
    const result = run(root, AUTHORITY);
    expect(result.status, result.output).not.toBe(0);
  }, 60_000);
});
