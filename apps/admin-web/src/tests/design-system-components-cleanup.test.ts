import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const android = path.join(repositoryRoot, 'apps', 'seller-android');
const coreUi = path.join(android, 'app', 'src', 'main', 'java', 'app', 'orderak', 'seller', 'core', 'ui');
const adminUi = path.join(repositoryRoot, 'apps', 'admin-web', 'src', 'shared', 'ui');
const inventoryPath = path.join(repositoryRoot, 'docs', 'domains', 'design-system-components.md');

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function sourceFiles(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === 'build' || entry === '.gradle' || entry === 'node_modules') continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(kt|kts|java)$/.test(entry)) out.push(full);
  }
  return out;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
}

function rowsNaming(text: string, names: string[]): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .filter((line) => cells(line).some((cell) => names.includes(cell.replace(/`/g, '').trim().replace(/\(\)$/, ''))));
}

describe('B3 Android cleanup', () => {
  it('deletes the two unused components', () => {
    expect(existsSync(path.join(coreUi, 'OsmMapView.kt'))).toBe(false);
    expect(existsSync(path.join(coreUi, 'SearchableAutocompleteField.kt'))).toBe(false);
  });

  it('removes osmdroid from the catalogue, the app build and every source file', () => {
    expect(read(path.join(android, 'gradle', 'libs.versions.toml'))).not.toMatch(/osmdroid/i);
    expect(read(path.join(android, 'app', 'build.gradle.kts'))).not.toMatch(/osmdroid/i);
    const app = read(path.join(android, 'app', 'src', 'main', 'java', 'app', 'orderak', 'seller', 'app', 'OrderakApp.kt'));
    expect(app).not.toMatch(/osmdroid/i);
    expect(app).not.toContain('OsmConfig');
    const importers = sourceFiles(android).filter((file) => read(file).includes('org.osmdroid'));
    expect(importers).toEqual([]);
  });

  it('draws both gate badges through FeatureAvailabilityChip with today\'s labels', () => {
    const code = withoutComments(read(path.join(coreUi, 'FeatureGate.kt')));
    expect(count(code, 'FeatureAvailabilityChip(')).toBe(2);
    expect(code).not.toMatch(/\bSemanticChip\s*\(/);
    expect(code).toMatch(/FeatureAvailabilityChip\(\s*(?:availability\s*=\s*)?FeatureAvailability\.LockedByPlan\b/);
    expect(code).toMatch(/FeatureAvailabilityChip\(\s*(?:availability\s*=\s*)?FeatureAvailability\.NotBuilt\b/);
    expect(count(code, 'stringResource(R.string.gate_upgrade_action)')).toBe(2);
    expect(count(code, 'stringResource(R.string.gate_not_built_badge)')).toBe(2);
    expect(code).toContain('if (onUpgrade != null)');
  });
});

describe('B3 admin cleanup', () => {
  it('removes the three unused exports', () => {
    expect(read(path.join(adminUi, 'card.tsx'))).not.toMatch(/\bCardFooter\b/);
    const dialog = read(path.join(adminUi, 'dialog.tsx'));
    expect(dialog).not.toMatch(/\bDialogTrigger\b/);
    expect(dialog).not.toMatch(/\bDialogClose\b/);
  });
});

describe('B3 third-party register', () => {
  const register = read(path.join(repositoryRoot, 'docs', 'governance', 'registers', 'third-party-and-permission-register.md'));
  const row = (id: string): string => register.split(/\r?\n/).find((line) => line.includes(`\`${id}\``) && line.trim().startsWith('|')) ?? '';

  it('records TP-007 as removed by B3', () => {
    const tp007 = row('TP-007');
    expect(tp007).not.toBe('');
    expect(tp007).toMatch(/removed/i);
    expect(tp007).toMatch(/\bB3\b/);
    expect(tp007).not.toContain('Runtime component used');
  });

  it('no longer gives map tiles as an INTERNET permission purpose', () => {
    const prm001 = row('PRM-001');
    expect(prm001).not.toBe('');
    expect(prm001).not.toMatch(/map tiles/i);
  });
});

describe('B3 component inventory', () => {
  it('exists with current frontmatter and is linked from the reference', () => {
    const inventory = read(inventoryPath);
    expect(inventory.startsWith('---')).toBe(true);
    const frontmatter = inventory.slice(0, inventory.indexOf('\n---', 3));
    expect(frontmatter).toMatch(/^status:\s*current\s*$/m);
    expect(frontmatter).toMatch(/^owner:\s*governance\s*$/m);
    const reference = read(path.join(repositoryRoot, 'docs', 'domains', 'design-system-reference.md'));
    expect(reference).toMatch(/\]\((?:\.\/)?design-system-components\.md(?:#[^)]*)?\)/);
  });

  it('states the rule for adding and deleting a component', () => {
    const inventory = read(inventoryPath);
    expect(inventory).toMatch(/visual primitive/i);
    expect(inventory).toMatch(/at least one caller/i);
    expect(inventory).toMatch(/last caller/i);
  });

  it('carries one row per key, including private composables, same-file overloads, the colors utility and alias exports', () => {
    const inventory = read(inventoryPath);
    const chip = rowsNaming(inventory, ['FeatureAvailabilityChip']);
    expect(chip).toHaveLength(1);
    expect(chip[0]).toContain('SemanticChip.kt');
    expect(chip[0]).toContain('FeatureGate.kt');
    expect(rowsNaming(inventory, ['FeatureGate'])).toHaveLength(1);
    expect(rowsNaming(inventory, ['LockedByPlanNotice'])).toHaveLength(1);
    expect(rowsNaming(inventory, ['NotBuiltNotice'])).toHaveLength(1);
    const colors = rowsNaming(inventory, ['colors', 'SemanticRole.colors']);
    expect(colors).toHaveLength(1);
    expect(colors[0]).toContain('SemanticRole.kt');
    const dialog = rowsNaming(inventory, ['Dialog']);
    expect(dialog).toHaveLength(1);
    expect(dialog[0]).toContain('dialog.tsx');
    const content = rowsNaming(inventory, ['DialogContent']);
    expect(content).toHaveLength(1);
    expect(content[0]).toContain('dialog.tsx');
  });

  it('lists no deleted component and links to no source file', () => {
    const inventory = read(inventoryPath);
    for (const gone of ['OsmMapView', 'SearchableAutocompleteField', 'CardFooter', 'DialogTrigger', 'DialogClose']) {
      expect(rowsNaming(inventory, [gone]), gone).toHaveLength(0);
    }
    expect(inventory).not.toContain('OsmMapView.kt');
    expect(inventory).not.toContain('SearchableAutocompleteField.kt');
    expect(inventory).not.toMatch(/\]\([^)]*(?:apps|tooling)\//);
  });
});

describe('B3 docs CI wiring', () => {
  it('runs the guard test before the guard, in docs-ci', () => {
    const workflow = read(path.join(repositoryRoot, '.github', 'workflows', 'docs-ci.yml'));
    const testAt = workflow.indexOf('node --test tooling/repository/verify-design-system-components.test.mjs');
    const guardAt = workflow.indexOf('node tooling/repository/verify-design-system-components.mjs');
    expect(testAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(testAt).toBeLessThan(guardAt);
  });
});
