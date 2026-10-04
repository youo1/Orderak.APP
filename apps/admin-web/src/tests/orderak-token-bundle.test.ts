import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const adminRoot = path.join(repositoryRoot, 'apps', 'admin-web');
const adminSrc = path.join(adminRoot, 'src');

function read(file: string): string {
  return readFileSync(file, 'utf8');
}
function readIfPresent(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

type Contrast = 'standard' | 'medium' | 'high';
type Mode = 'light' | 'dark';
interface WebColor { hex: string; rgb: string; oklch: string }
interface Fixture {
  snapshot: {
    generatorVersion: string;
    contentHash: string;
    web: { colors: Record<Contrast, Record<Mode, Record<string, WebColor>>> };
  };
}

const fixture = JSON.parse(read(path.join(repositoryRoot, 'design', 'design-system.default.json'))) as Fixture;
const bundle = read(path.join(adminSrc, 'orderak-tokens.css'));
const pending = readIfPresent(path.join(adminSrc, 'orderak-tokens-pending.css'));
const indexCss = read(path.join(adminSrc, 'index.css'));

const CONTRASTS: Contrast[] = ['standard', 'medium', 'high'];
const MODES: Mode[] = ['light', 'dark'];
const kebab = (role: string): string => role.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const declares = (css: string, name: string): boolean =>
  new RegExp(`(?:^|[\\s;{])${escapeRegExp(name)}\\s*:`).test(stripComments(css));

function depthAt(css: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
  }
  return depth;
}

function bodies(css: string, opener: RegExp, topLevelOnly = false): string {
  const found: string[] = [];
  for (const match of css.matchAll(opener)) {
    const index = match.index ?? 0;
    if (topLevelOnly && depthAt(css, index) !== 0) continue;
    const open = index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          found.push(css.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return found.join('\n');
}

function rules(css: string): Array<{ selector: string; body: string }> {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

const SEMANTIC_ALIASES = [
  '--orderak-canvas', '--orderak-ink', '--orderak-line', '--orderak-muted', '--orderak-primary-tint',
  '--orderak-primary-strong', '--orderak-primary-soft', '--orderak-danger', '--orderak-danger-soft',
  '--orderak-warning-soft', '--orderak-accent', '--orderak-success-soft', '--orderak-information-soft',
  '--orderak-commerce-soft',
];
const LEGACY_ALIASES = [
  '--primary', '--primary-strong', '--primary-soft', '--primary-tint', '--canvas', '--surface', '--ink',
  '--muted', '--line', '--danger', '--danger-soft', '--warning', '--warning-soft', '--accent',
];

/** Hand-kept tokens and the values they carried before B1. */
const PENDING_VALUES: Array<[string, string]> = [
  ['--orderak-numeric-tabular', 'tabular-nums lining-nums'],
  ['--orderak-shape-full', '999px'],
  ['--orderak-shadow-card', '0 5px 18px rgba(20,20,31,.04)'],
  ['--orderak-shadow-overlay', '0 30px 80px rgba(20,20,31,.14)'],
  ['--orderak-duration-medium', '180ms'],
  ['--orderak-duration-long', '200ms'],
  ['--orderak-motion-fast', 'var(--orderak-duration-short) ease'],
  ['--orderak-motion-drawer', 'var(--orderak-duration-long) ease'],
  ['--orderak-focus-ring-offset', '2px'],
  ['--orderak-focus-ring', 'var(--orderak-focus-ring-width) solid var(--orderak-focus-ring-color)'],
  ['--orderak-hover-surface', '#F0F3FA'],
  ['--orderak-hover-surface', '#242B2C'],
  ['--orderak-sidebar-width', '268px'],
  ['--orderak-topbar-height', '64px'],
];

/** The 18 properties the admin uses that only the old bundle defined. */
const BUNDLE_ONLY_PROPERTIES = [
  '--orderak-canvas', '--orderak-ink', '--orderak-line', '--orderak-primary-tint', '--orderak-success-soft',
  '--orderak-duration-long', '--orderak-duration-medium', '--orderak-motion-drawer', '--orderak-motion-fast',
  '--orderak-focus-ring', '--orderak-focus-ring-offset', '--orderak-hover-surface', '--orderak-numeric-tabular',
  '--orderak-shadow-card', '--orderak-shadow-overlay', '--orderak-shape-full', '--orderak-sidebar-width',
  '--orderak-topbar-height',
];

describe('generated admin token bundle', () => {
  it('carries a generated header that matches the committed fixture snapshot', () => {
    const header = /^\s*\/\*[\s\S]*?\*\//.exec(bundle)?.[0] ?? '';
    expect(header).toContain('designSystemCss');
    expect(header).toContain(fixture.snapshot.generatorVersion);
    expect(header).toContain(fixture.snapshot.contentHash);
    expect(header).toContain('pnpm run design-system:generate');
    expect(header).toMatch(/by hand/i);
    expect(bundle).not.toContain('2026-09-04');
  });

  it('holds every web colour role for the six themes and for .orderak-dark', () => {
    const css = stripComments(bundle);
    const scopes: Record<string, string> = {
      'standard.light': bodies(css, /:root\s*\{/g, true),
      'standard.dark': bodies(css, /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g),
      'medium.light': bodies(css, /:root\[data-orderak-contrast=["']?medium["']?\]\s*\{/g),
      'medium.dark': bodies(css, /:root\[data-orderak-theme=["']?dark["']?\]\[data-orderak-contrast=["']?medium["']?\]\s*\{/g),
      'high.light': bodies(css, /:root\[data-orderak-contrast=["']?high["']?\]\s*\{/g),
      'high.dark': bodies(css, /:root\[data-orderak-theme=["']?dark["']?\]\[data-orderak-contrast=["']?high["']?\]\s*\{/g),
      rail: bodies(css, /\.orderak-dark\s*\{/g),
    };
    const missing: string[] = [];
    const check = (scope: string, contrast: Contrast, mode: Mode): void => {
      for (const [role, formats] of Object.entries(fixture.snapshot.web.colors[contrast][mode])) {
        const name = kebab(role);
        if (!scopes[scope].includes(`--md-sys-color-${name}:${formats.hex}`)) missing.push(`${scope} --md-sys-color-${name}`);
        if (!scopes[scope].includes(`--orderak-${name}:${formats.oklch}`)) missing.push(`${scope} --orderak-${name}`);
      }
    };
    for (const contrast of CONTRASTS) for (const mode of MODES) check(`${contrast}.${mode}`, contrast, mode);
    check('rail', 'standard', 'dark');
    expect(missing).toEqual([]);

    const aliasMissing: string[] = [];
    for (const alias of [...SEMANTIC_ALIASES, ...LEGACY_ALIASES]) {
      if (!declares(scopes['standard.light'], alias)) aliasMissing.push(`:root ${alias}`);
      if (!declares(scopes.rail, alias)) aliasMissing.push(`.orderak-dark ${alias}`);
    }
    expect(aliasMissing).toEqual([]);
  });

  it('keeps the generated scrim opaque and drops the stale translucent fallback', () => {
    const scrim = fixture.snapshot.web.colors.standard.light.scrim;
    expect(scrim.oklch).not.toContain('/');
    expect(bundle).toContain(`--orderak-scrim:${scrim.oklch}`);
    expect(bundle).not.toContain('rgba(8,12,30');
    expect(declares(pending, '--orderak-scrim')).toBe(false);
  });

  it('loads all three families from unchanged files under src/fonts', () => {
    const urls = [...bundle.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThanOrEqual(12);
    expect(bundle).not.toContain('/static/fonts/');
    for (const url of urls) {
      expect(url.startsWith('./fonts/')).toBe(true);
      expect(existsSync(path.join(adminSrc, url))).toBe(true);
    }
    for (const family of ['Orderak Cairo', 'Orderak Tajawal', 'Orderak Noto Arabic']) {
      expect(bundle).toMatch(new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${family}"`));
    }
  });
});

describe('hand-kept pending tokens', () => {
  it('exists with a header saying it is hand-kept until B2 deletes it', () => {
    expect(pending).not.toBe('');
    const header = /^\s*\/\*[\s\S]*?\*\//.exec(pending)?.[0] ?? '';
    expect(header).toMatch(/hand[- ]?kept/i);
    expect(header).toContain('B2');
  });

  it('preserves the unowned families verbatim and holds no generator-owned tokens', () => {
    const plain = stripComments(pending);
    for (const [name, value] of PENDING_VALUES) {
      expect(plain).toMatch(new RegExp(`${escapeRegExp(name)}\\s*:\\s*${escapeRegExp(value)}\\s*[;}]`));
    }
    expect(plain).not.toContain('@font-face');
    expect(plain).not.toMatch(/--md-sys-color-[a-z-]+\s*:/);
    expect(plain).not.toMatch(/--orderak-type-[a-z-]+-size\s*:/);
    expect(plain).not.toMatch(/--orderak-space\d+\s*:/);
    for (const alias of SEMANTIC_ALIASES) expect(declares(plain, alias)).toBe(false);
    for (const name of ['--orderak-sidebar-width', '--orderak-motion-fast', '--orderak-focus-ring', '--orderak-shadow-card', '--orderak-hover-surface', '--orderak-shape-full']) {
      expect(declares(bundle, name)).toBe(false);
    }
  });

  it('leaves none of the 18 bundle-only properties the admin uses undefined', () => {
    const undefinedProperties = BUNDLE_ONLY_PROPERTIES.filter((name) => !declares(bundle, name) && !declares(pending, name));
    expect(undefinedProperties).toEqual([]);
    for (const name of ['--orderak-canvas', '--orderak-ink', '--orderak-line', '--orderak-primary-tint', '--orderak-success-soft']) {
      expect(declares(bundle, name)).toBe(true);
    }
  });
});

describe('admin stylesheet', () => {
  const importLines = indexCss.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('@import'));

  it('imports each token source exactly once inside layer(orderak-fallback)', () => {
    for (const file of ['orderak-tokens.css', 'orderak-tokens-pending.css']) {
      const lines = importLines.filter((line) => new RegExp(`["']\\./${escapeRegExp(file)}["']`).test(line));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/layer\(\s*orderak-fallback\s*\)\s*;$/);
    }
    expect(indexCss).toContain('orderak-fallback');
  });

  it('drops the #fff literal fallback for the primary foreground', () => {
    expect(indexCss).not.toMatch(/var\(\s*--orderak-on-primary\s*,\s*#fff\s*\)/i);
    expect(indexCss).toMatch(/--color-primary-foreground\s*:\s*var\(\s*--orderak-on-primary\s*\)/);
  });

  it('paints every backdrop with the opaque scrim at 48% and never at full opacity', () => {
    const all = rules(indexCss);
    const fullOpacity = /background(?:-color)?\s*:\s*var\(\s*--orderak-scrim\s*\)\s*(?:;|!|$)/;
    expect(all.filter((rule) => fullOpacity.test(rule.body.trim())).map((rule) => rule.selector)).toEqual([]);
    const mixed = /background(?:-color)?\s*:\s*color-mix\(\s*in\s+oklch\s*,\s*var\(\s*--orderak-scrim\s*\)\s+48%\s*,\s*transparent\s*\)/;
    for (const cls of ['drawer-backdrop', 'modal-backdrop', 'palette-backdrop', 'mobile-overlay']) {
      const selector = new RegExp(`\\.${cls}(?![\\w-])`);
      const own = all.filter((rule) => selector.test(rule.selector));
      expect(own.length).toBeGreaterThan(0);
      expect(own.some((rule) => mixed.test(rule.body))).toBe(true);
    }
  });
});

describe('generation and CI wiring', () => {
  it('has the fixture script write and check the admin bundle with the pnpm regenerate message', () => {
    const script = read(path.join(repositoryRoot, 'services', 'backend', 'scripts', 'generate-design-system-fixture.ts'));
    expect(script).toContain('orderak-tokens.css');
    expect(script).toContain('fontUrlBase');
    expect(script).toContain('./fonts/');
    expect(script).toContain('designSystemCss');
    expect(script).toContain('pnpm run design-system:generate');
    expect(script).not.toMatch(/(?<!p)npm run design-system/);
  });

  it('runs design-system:check in backend CI from services/backend', () => {
    const workflow = read(path.join(repositoryRoot, '.github', 'workflows', 'backend-ci.yml'));
    const steps = workflow.split(/\n\s*-\s+(?=name:|uses:)/);
    const step = steps.find((chunk) => chunk.includes('design-system:check'));
    expect(step).toBeDefined();
    expect(step ?? '').toMatch(/run:\s*pnpm run design-system:check/);
    expect(step ?? '').toMatch(/working-directory:\s*\.?\/?services\/backend\s*$/m);
  });

  it('type-checks tests in their own Node-aware project and keeps Node out of the browser project', () => {
    const app = read(path.join(adminRoot, 'tsconfig.app.json'));
    const testConfig = readIfPresent(path.join(adminRoot, 'tsconfig.test.json'));
    const solution = read(path.join(adminRoot, 'tsconfig.json'));
    expect(app).toMatch(/"types"\s*:\s*\[\s*"vite\/client"\s*\]/);
    expect(app).toMatch(/"exclude"\s*:\s*\[[^\]]*"(?:\.\/)?src\/tests/);
    expect(testConfig).toMatch(/"types"\s*:\s*\[[^\]]*"vite\/client"[^\]]*\]/);
    expect(testConfig).toMatch(/"types"\s*:\s*\[[^\]]*"node"[^\]]*\]/);
    expect(testConfig).toMatch(/"include"\s*:\s*\[[^\]]*"(?:\.\/)?src\/tests/);
    expect(solution).toMatch(/"path"\s*:\s*"\.\/tsconfig\.test\.json"/);
    expect(solution).toMatch(/"path"\s*:\s*"\.\/tsconfig\.app\.json"/);
  });
});
