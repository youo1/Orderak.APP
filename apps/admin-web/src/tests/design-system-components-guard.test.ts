import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const GUARD = 'verify-design-system-components.mjs';
const GUARD_TEST = 'verify-design-system-components.test.mjs';
const INVENTORY = path.join('docs', 'domains', 'design-system-components.md');
const CORE_UI = path.join('apps', 'seller-android', 'app', 'src', 'main', 'java', 'app', 'orderak', 'seller', 'core', 'ui');
const ADMIN_UI = path.join('apps', 'admin-web', 'src', 'shared', 'ui');
const sandboxes: string[] = [];

/** A copy of the tooling, the docs, the Android sources (without reference images) and the admin sources. */
function sandbox(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'orderak-ds-components-'));
  sandboxes.push(root);
  cpSync(path.join(repositoryRoot, 'tooling'), path.join(root, 'tooling'), {
    recursive: true,
    filter: (source: string): boolean => !source.includes('node_modules'),
  });
  cpSync(path.join(repositoryRoot, 'docs'), path.join(root, 'docs'), { recursive: true });
  cpSync(path.join(repositoryRoot, 'apps', 'seller-android', 'app', 'src'), path.join(root, 'apps', 'seller-android', 'app', 'src'), {
    recursive: true,
    filter: (source: string): boolean => !source.toLowerCase().endsWith('.png'),
  });
  cpSync(path.join(repositoryRoot, 'apps', 'admin-web', 'src'), path.join(root, 'apps', 'admin-web', 'src'), {
    recursive: true,
    filter: (source: string): boolean => !source.includes('node_modules'),
  });
  return root;
}

function run(root: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [path.join(root, 'tooling', 'repository', GUARD)], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function write(root: string, relative: string, text: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
}

function normalise(cell: string): string {
  return cell.replace(/`/g, '').trim().replace(/\(\)$/, '');
}

/** Indexes of inventory table rows that carry a cell holding exactly the component name. */
function rowsNaming(lines: string[], name: string): number[] {
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (!line.trim().startsWith('|')) return;
    if (cells(line).some((cell) => normalise(cell) === name)) found.push(index);
  });
  return found;
}

afterAll(() => {
  for (const root of sandboxes) rmSync(root, { recursive: true, force: true });
});

describe('verify-design-system-components.mjs', () => {
  it('passes on the real tree', () => {
    expect(existsSync(path.join(repositoryRoot, 'tooling', 'repository', GUARD))).toBe(true);
    const result = run(repositoryRoot);
    expect(result.status, result.output).toBe(0);
  }, 120_000);

  it('passes on an untouched sandbox copy, and still passes with a @Preview function nobody calls', () => {
    const root = sandbox();
    const clean = run(root);
    expect(clean.status, clean.output).toBe(0);
    write(
      root,
      path.join(CORE_UI, 'ZzPreviewProbe.kt'),
      [
        'package app.orderak.seller.core.ui',
        '',
        'import androidx.compose.runtime.Composable',
        'import androidx.compose.ui.tooling.preview.Preview',
        '',
        '@Preview',
        '@Composable',
        'private fun ZzPreviewProbe() {',
        '    SemanticChip(SemanticRole.Info, "probe")',
        '}',
        '',
      ].join('\n'),
    );
    const preview = run(root);
    expect(preview.status, preview.output).toBe(0);
  }, 120_000);

  it('fails on a reintroduced core/ui composable with no caller, naming it and its file', () => {
    const root = sandbox();
    write(
      root,
      path.join(CORE_UI, 'ZzUnusedProbe.kt'),
      [
        'package app.orderak.seller.core.ui',
        '',
        'import androidx.compose.runtime.Composable',
        '',
        '@Composable',
        'fun ZzUnusedProbe(label: String) {',
        '    SemanticChip(SemanticRole.Info, label)',
        '}',
        '',
      ].join('\n'),
    );
    const result = run(root);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('ZzUnusedProbe');
    expect(result.output).toContain('ZzUnusedProbe.kt');
  }, 120_000);

  it('fails when FeatureAvailabilityChip loses its only main-source caller, even though the inventory still lists it', () => {
    const root = sandbox();
    const gate = path.join(root, CORE_UI, 'FeatureGate.kt');
    const text = readFileSync(gate, 'utf8');
    expect(text).toContain('FeatureAvailabilityChip');
    writeFileSync(gate, text.replace(/FeatureAvailabilityChip/g, 'ZzRemovedCall'));
    const result = run(root);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('FeatureAvailabilityChip');
    expect(result.output).toContain('SemanticChip.kt');
  }, 120_000);

  it('fails on a reintroduced unused admin export, even when a test imports it', () => {
    const root = sandbox();
    const card = path.join(root, ADMIN_UI, 'card.tsx');
    writeFileSync(
      card,
      `${readFileSync(card, 'utf8')}\nexport const CardFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex items-center p-5 pt-0', className)} {...props} />;\n`,
    );
    write(
      root,
      path.join('apps', 'admin-web', 'src', 'tests', 'zz-card-footer-probe.test.tsx'),
      "import { CardFooter } from '@/shared/ui/card';\nexport const probe = <CardFooter />;\n",
    );
    const result = run(root);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('CardFooter');
    expect(result.output).toContain('card.tsx');
  }, 120_000);

  it('fails on an unused PascalCase alias export', () => {
    const root = sandbox();
    const dialog = path.join(root, ADMIN_UI, 'dialog.tsx');
    writeFileSync(dialog, `${readFileSync(dialog, 'utf8')}\nexport const DialogClose = DialogPrimitive.Close;\n`);
    const result = run(root);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('DialogClose');
    expect(result.output).toContain('dialog.tsx');
  }, 120_000);

  it('ignores exported types and lowercase values', () => {
    const root = sandbox();
    const card = path.join(root, ADMIN_UI, 'card.tsx');
    writeFileSync(
      card,
      `${readFileSync(card, 'utf8')}\nexport type ZzProbeProps = { label: string };\nexport interface ZzProbeShape { label: string }\nexport const zzProbeValue = 1;\n`,
    );
    const result = run(root);
    expect(result.status, result.output).toBe(0);
  }, 120_000);

  it('fails when a component row is removed from the inventory, naming the component, its file and the inventory', () => {
    const root = sandbox();
    const inventory = path.join(root, INVENTORY);
    const lines = readFileSync(inventory, 'utf8').split(/\r?\n/);
    const rows = rowsNaming(lines, 'FeatureAvailabilityChip');
    expect(rows, 'exactly one inventory row names FeatureAvailabilityChip').toHaveLength(1);
    writeFileSync(inventory, lines.filter((_, index) => index !== rows[0]).join('\n'));
    const result = run(root);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('FeatureAvailabilityChip');
    expect(result.output).toContain('SemanticChip.kt');
    expect(result.output).toContain('design-system-components.md');
  }, 120_000);

  it('fails when the inventory lists a component the tree does not have', () => {
    const root = sandbox();
    const inventory = path.join(root, INVENTORY);
    const lines = readFileSync(inventory, 'utf8').split(/\r?\n/);
    const rows = rowsNaming(lines, 'FeatureAvailabilityChip');
    expect(rows).toHaveLength(1);
    const original = lines[rows[0]];
    const ghostCells = cells(original).map((cell) => (normalise(cell) === 'FeatureAvailabilityChip' ? ' `ZzGhostChip` ' : cell));
    const ghost = `|${ghostCells.join('|')}|`;
    lines.splice(rows[0] + 1, 0, ghost);
    writeFileSync(inventory, lines.join('\n'));
    const result = run(root);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('ZzGhostChip');
    expect(result.output).toContain('design-system-components.md');
  }, 120_000);

  it('fails when an inventory row keeps the right basename but points at the wrong directory', () => {
    const root = sandbox();
    const inventory = path.join(root, INVENTORY);
    const lines = readFileSync(inventory, 'utf8').split(/\r?\n/);
    const rows = rowsNaming(lines, 'FeatureAvailabilityChip');
    expect(rows, 'exactly one inventory row names FeatureAvailabilityChip').toHaveLength(1);
    const original = lines[rows[0]];
    const correctPath = 'apps/seller-android/app/src/main/java/app/orderak/seller/core/ui/SemanticChip.kt';
    const wrongPath = 'apps/seller-android/app/src/main/java/app/orderak/seller/core/ui/theme/SemanticChip.kt';
    expect(original).toContain(correctPath);
    lines[rows[0]] = original.replace(correctPath, wrongPath);
    writeFileSync(inventory, lines.join('\n'));
    const result = run(root);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('FeatureAvailabilityChip');
    expect(result.output).toContain(correctPath);
    expect(result.output).toContain(wrongPath);
  }, 120_000);

  it('tells apart two same-basename components in different core/ui directories by full path', () => {
    const root = sandbox();
    const declaration = (pkg: string, name: string): string =>
      [
        `package ${pkg}`,
        '',
        'import androidx.compose.runtime.Composable',
        '',
        '@Composable',
        `fun ${name}(label: String) {`,
        '    SemanticChip(SemanticRole.Info, label)',
        '}',
        '',
      ].join('\n');
    write(root, path.join(CORE_UI, 'ZzTwinDirProbe.kt'), declaration('app.orderak.seller.core.ui', 'ZzTwinDirProbe'));
    write(
      root,
      path.join(CORE_UI, 'variant', 'ZzTwinDirProbe.kt'),
      declaration('app.orderak.seller.core.ui.variant', 'ZzTwinDirProbe'),
    );
    write(
      root,
      path.join('apps', 'seller-android', 'app', 'src', 'main', 'java', 'app', 'orderak', 'seller', 'feature', 'orders', 'ZzTwinDirCaller.kt'),
      [
        'package app.orderak.seller.feature.orders',
        '',
        'import app.orderak.seller.core.ui.ZzTwinDirProbe',
        'import app.orderak.seller.core.ui.variant.ZzTwinDirProbe',
        '',
        'fun probeCaller() {',
        '    ZzTwinDirProbe("a")',
        '}',
        '',
      ].join('\n'),
    );
    const result = run(root);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('core/ui/ZzTwinDirProbe.kt');
    expect(result.output).toContain('core/ui/variant/ZzTwinDirProbe.kt');
  }, 120_000);

  it('fails on a one-line "@Composable fun" declaration with no caller', () => {
    const root = sandbox();
    write(
      root,
      path.join(CORE_UI, 'ZzOneLinerProbe.kt'),
      [
        'package app.orderak.seller.core.ui',
        '',
        'import androidx.compose.runtime.Composable',
        'import androidx.compose.material3.Text',
        '',
        '@Composable fun ZzOneLinerProbe(label: String) { Text(label) }',
        '',
      ].join('\n'),
    );
    const result = run(root);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('ZzOneLinerProbe');
    expect(result.output).toContain('ZzOneLinerProbe.kt');
  }, 120_000);

  it('fails when an inventory row is missing a caller the guard computes', () => {
    const root = sandbox();
    const inventory = path.join(root, INVENTORY);
    const lines = readFileSync(inventory, 'utf8').split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => cells(line).map((cell) => cell.trim()).includes('Callers'));
    expect(headerIndex, 'inventory header names a Callers column').not.toBe(-1);
    const callersIndex = cells(lines[headerIndex]).map((cell) => cell.trim()).indexOf('Callers');
    const rows = rowsNaming(lines, 'SyncStatusBanner');
    expect(rows, 'exactly one inventory row names SyncStatusBanner').toHaveLength(1);
    const rowCells = cells(lines[rows[0]]);
    expect(rowCells[callersIndex]).toContain('MainScreen.kt');
    rowCells[callersIndex] = ' ';
    lines[rows[0]] = `|${rowCells.join('|')}|`;
    writeFileSync(inventory, lines.join('\n'));
    const result = run(root);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('SyncStatusBanner');
    expect(result.output).toContain('MainScreen.kt');
    expect(result.output).toContain('design-system-components.md');
  }, 120_000);

  it('has a companion node:test suite that passes', () => {
    const testFile = path.join(repositoryRoot, 'tooling', 'repository', GUARD_TEST);
    expect(existsSync(testFile)).toBe(true);
    const result = spawnSync(process.execPath, ['--test', testFile], { cwd: repositoryRoot, encoding: 'utf8' });
    expect(result.status, `${result.stdout ?? ''}${result.stderr ?? ''}`).toBe(0);
  }, 600_000);

  it('imports only Node built-ins and relative modules', () => {
    const source = readFileSync(path.join(repositoryRoot, 'tooling', 'repository', GUARD), 'utf8');
    const specifiers = [
      ...[...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]),
      ...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
      ...[...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
    ];
    for (const specifier of specifiers) {
      expect(specifier.startsWith('node:') || specifier.startsWith('.'), specifier).toBe(true);
    }
  });
});
