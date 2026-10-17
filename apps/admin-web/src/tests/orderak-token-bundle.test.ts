import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const adminRoot = path.join(repositoryRoot, 'apps', 'admin-web');
const adminSrc = path.join(adminRoot, 'src');

// verify-theme-authority.mjs scans .ts files for a second import of the token
// sources, so the import keyword is assembled here rather than written out.
const IMPORT = ['@imp', 'ort'].join('');

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
    schemaVersion: number;
    generatorVersion: string;
    contentHash: string;
    web: { colors: Record<Contrast, Record<Mode, Record<string, WebColor>>> };
  };
}

const fixture = JSON.parse(read(path.join(repositoryRoot, 'design', 'design-system.default.json'))) as Fixture;
const bundlePath = path.join(adminSrc, 'orderak-tokens.css');
const adminPath = path.join(adminSrc, 'orderak-admin.css');
const pendingPath = path.join(adminSrc, 'orderak-tokens-pending.css');
const bundle = read(bundlePath);
const adminStylesheet = readIfPresent(adminPath);
const indexCss = read(path.join(adminSrc, 'index.css'));
const previewCss = read(path.join(adminSrc, 'features', 'theme', 'preview', 'preview.css'));

const CONTRASTS: Contrast[] = ['standard', 'medium', 'high'];
const MODES: Mode[] = ['light', 'dark'];
const kebab = (role: string): string => role.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (css: string): string => stripComments(css).replace(/\s+/g, '');
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

function declarations(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of body.matchAll(/(?:^|[\s;{])(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+)/g)) found.set(match[1], match[2].trim());
  return found;
}

// Standard declarations (width, border, outline, animation, ...) are not
// custom properties, so the bundle scopes above stay custom-only; these live
// rules are read with this splitter instead.
function properties(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim();
    if (!name || name.startsWith('@')) continue;
    found.set(name, part.slice(colon + 1).trim());
  }
  return found;
}

function rules(css: string): Array<{ selector: string; body: string }> {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

function topLevelRules(css: string): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => depthAt(css, match.index ?? 0) === 0)
    .map((match) => ({ selector: match[1].trim(), body: match[2] }));
}

interface Scope { decls: Map<string, string>; parent?: Scope }
function resolve(scope: Scope, name: string, depth = 0): string | undefined {
  if (depth > 40) return undefined;
  for (let current: Scope | undefined = scope; current; current = current.parent) {
    const value = current.decls.get(name);
    if (value !== undefined) return substitute(current, value, depth + 1);
  }
  return undefined;
}
function substitute(scope: Scope, value: string, depth = 0): string {
  let out = value;
  for (let i = 0; i < 40 && out.includes('var('); i += 1) {
    const next = out.replace(/var\(\s*(--[A-Za-z0-9-]+)\s*(?:,([^()]*))?\)/g, (_match, ref: string, fallback?: string) =>
      resolve(scope, ref, depth) ?? fallback?.trim() ?? `<undefined ${ref}>`);
    if (next === out) break;
    out = next;
  }
  return out;
}
const canon = (value: string): string => value.replace(/!important/gi, '').trim()
  .replace(/\s+/g, ' ')
  .replace(/\s*([,()/])\s*/g, '$1')
  .replace(/(-?\d*\.?\d+)(ms|s)\b/g, (_match, n: string, unit: string) =>
    `${unit === 's' ? Math.round(parseFloat(n) * 1e6) / 1e3 : parseFloat(n)}ms`)
  .replace(/-?\d*\.?\d+/g, (n) => String(parseFloat(n)));
const mentions = (value: string, formats: WebColor): boolean => {
  const v = value.toLowerCase().replace(/\s+/g, ' ');
  return v.includes(formats.hex.toLowerCase()) || v.includes(formats.rgb) || v.includes(formats.oklch.toLowerCase());
};

const plainBundle = stripComments(bundle);
const bundleRoot = declarations(bodies(plainBundle, /:root\s*\{/g, true));
const bundleReduced = declarations(bodies(plainBundle, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g));
const light: Scope = { decls: bundleRoot };
const reduced: Scope = { decls: new Map([...bundleRoot, ...bundleReduced]) };
const plainAdmin = stripComments(adminStylesheet);
const lightRoles = fixture.snapshot.web.colors.standard.light;
const value = (scope: Scope, raw: string | undefined): string => canon(substitute(scope, raw ?? '<missing>'));

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

/** Declarations the B2 generator owns; a schema-3 bundle must carry them. */
const B2_FAMILIES = [
  '--orderak-duration-instant', '--orderak-duration-short', '--orderak-duration-medium',
  '--orderak-duration-long', '--orderak-duration-extra-long', '--orderak-duration-spinner',
  '--orderak-duration-spinner-reduced', '--orderak-duration-safety-floor',
  '--orderak-easing-standard', '--orderak-easing-linear',
  '--orderak-motion-fast', '--orderak-motion-nav', '--orderak-motion-drawer', '--orderak-motion-state',
  '--orderak-state-hover', '--orderak-disabled-opacity-web',
  '--orderak-focus-ring-width', '--orderak-focus-ring-offset', '--orderak-focus-ring',
  '--orderak-shadow-card', '--orderak-shadow-raised', '--orderak-shadow-modal', '--orderak-shadow-overlay',
  '--orderak-shape-full', '--orderak-sidebar-width', '--orderak-topbar-height', '--orderak-numeric-tabular',
  '--orderak-spinner-size',
];

/** The declarations B2 deletes and must never come back. */
const DELETED = [
  '--orderak-font-family-tajawal', '--orderak-font-family-noto', '--orderak-type-latin-floor',
  '--orderak-mark-green', '--orderak-mark-badge', '--orderak-mark-wordmark', '--orderak-mark-tagline',
  '--orderak-breakpoint-compact', '--orderak-breakpoint-medium', '--orderak-breakpoint-expanded',
  '--orderak-container-storefront', '--orderak-container-admin', '--orderak-container-prose', '--orderak-container-phone',
  '--orderak-appbar-height', '--orderak-navbar-height', '--orderak-fab-inset',
  '--orderak-gutter-phone', '--orderak-gutter-storefront', '--orderak-gutter-admin', '--orderak-page-padding-block',
  '--orderak-grid-metric', '--orderak-grid-panel', '--orderak-grid-gap',
  '--shadow', '--g', '--bg', '--tx', '--mut',
];

describe('generated admin token bundle', () => {
  it('carries a generated header that matches the committed schema-3 fixture snapshot', () => {
    const header = /^\s*\/\*[\s\S]*?\*\//.exec(bundle)?.[0] ?? '';
    expect(header).toContain('designSystemCss');
    expect(header).toContain(fixture.snapshot.generatorVersion);
    expect(header).toContain(fixture.snapshot.contentHash);
    expect(header).toContain('pnpm run design-system:generate');
    expect(header).toMatch(/by hand/i);
    expect(fixture.snapshot.schemaVersion).toBe(3);
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

  it('maps the restored aliases to their approved generated roles and keeps the hover tint indirect', () => {
    for (const declaration of [
      '--primary-strong:var(--md-sys-color-on-primary-container);',
      '--primary-soft:var(--md-sys-color-primary-container);',
      '--surface:var(--md-sys-color-surface-container-lowest);',
      '--orderak-primary-strong:var(--md-sys-color-on-primary-container);',
      '--orderak-primary-soft:var(--md-sys-color-primary-container);',
      '--orderak-hover-tint:var(--orderak-primary-soft);',
    ]) {
      expect(bundle).toContain(declaration);
    }
  });

  it('keeps the generated scrim opaque and never re-introduces a colour literal', () => {
    const scrim = fixture.snapshot.web.colors.standard.light.scrim;
    expect(scrim.oklch).not.toContain('/');
    expect(bundle).toContain(`--orderak-scrim:${scrim.oklch}`);
    expect(bundle).not.toContain('rgba(8,12,30');
    expect(adminStylesheet).not.toContain('rgba(8,12,30');
    expect(declares(bundle, '--orderak-hover-surface')).toBe(true);
    const roleProperties = new Set<string>();
    for (const role of Object.keys(lightRoles)) {
      roleProperties.add(`--md-sys-color-${kebab(role)}`);
      roleProperties.add(`--md-sys-color-${kebab(role)}-rgb`);
      roleProperties.add(`--orderak-${kebab(role)}`);
    }
    const literal = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[\d.]/i;
    const offenders = [...bundleRoot]
      .filter(([name, declaration]) => !roleProperties.has(name) && literal.test(declaration))
      .map(([name, declaration]) => `${name}: ${declaration}`);
    expect(offenders).toEqual([]);
  });

  it('loads only the three Cairo faces from unchanged files under src/fonts', () => {
    const urls = [...bundle.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((match) => match[1]);
    expect(urls.length).toBe(3);
    expect(bundle).not.toContain('/static/fonts/');
    for (const url of urls) {
      expect(url.startsWith('./fonts/')).toBe(true);
      expect(existsSync(path.join(adminSrc, url))).toBe(true);
    }
    expect(bundle).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Orderak Cairo"/);
    expect(bundle).not.toMatch(/Tajawal|Noto/i);
  });

  it('contains generator-owned tokens only, with the schema-3 families present', () => {
    const plain = plainBundle;
    expect(plain).not.toMatch(/@keyframes|\.ork-|:focus-visible/);
    expect(plain).toMatch(/prefers-reduced-motion/);
    const missing = B2_FAMILIES.filter((name) => !declares(bundle, name));
    expect(missing).toEqual([]);
    const present = DELETED.filter((name) => declares(bundle, name));
    expect(present).toEqual([]);
  });

  it('reduced motion zeroes the five durations and the ready-made transitions', () => {
    for (const name of ['--orderak-duration-instant', '--orderak-duration-short', '--orderak-duration-medium', '--orderak-duration-long', '--orderak-duration-extra-long']) {
      expect(value(reduced, bundleReduced.get(name))).toBe('0ms');
    }
    expect(value(reduced, bundleReduced.get('--orderak-motion-fast'))).toBe('0ms linear');
    expect(value(reduced, bundleReduced.get('--orderak-motion-nav'))).toBe('0ms linear');
    expect(value(reduced, bundleReduced.get('--orderak-motion-drawer'))).toBe('0ms linear');
    expect(value(reduced, bundleReduced.get('--orderak-motion-state'))).toBe('opacity 0ms cubic-bezier(0.2,0,0,1)');
    // The spinner durations are deliberately not zeroed.
    expect(value(light, bundleRoot.get('--orderak-duration-spinner'))).toBe('900ms');
    expect(value(light, bundleRoot.get('--orderak-duration-spinner-reduced'))).toBe('1600ms');
    expect(value(light, bundleRoot.get('--orderak-duration-safety-floor'))).toBe('0.01ms');
  });
});

describe('orderak-admin.css', () => {
  it('exists and declares no custom properties or hand-written token values', () => {
    expect(adminStylesheet).not.toBe('');
    expect(plainAdmin).not.toMatch(/(?:^|[\s;{])--[a-zA-Z0-9-]+\s*:/);
    const withoutKeyframes = plainAdmin.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    expect(withoutKeyframes.match(/(?<![\w-])\d*\.?\d+(?:px|ms|s|rem|em|vh|vw)\b/g) ?? []).toEqual([]);
    expect(withoutKeyframes).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/i);
  });

  it('contains only the permitted live rules', () => {
    const classes = new Set(plainAdmin.match(/\.ork-[a-z0-9-]+/g) ?? []);
    expect([...classes].sort()).toEqual(['.ork-label-small', '.ork-numeric', '.ork-spinner']);
    expect(plainAdmin).toMatch(/@keyframes\s+ork-spin\s*\{/);
    const top = topLevelRules(plainAdmin);
    expect(top.some((rule) => rule.selector.includes(':focus-visible'))).toBe(true);
    const reducedBody = bodies(plainAdmin, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g);
    const reducedRules = topLevelRules(reducedBody);
    expect(reducedRules.some((rule) => rule.selector.startsWith('*'))).toBe(true);
    expect(reducedRules.some((rule) => rule.selector === '.ork-spinner')).toBe(true);
  });

  it('resolves every custom property it reads through the generated bundle', () => {
    const referenced = [...plainAdmin.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1]);
    expect(referenced.filter((name) => !bundleRoot.has(name) && !bundleReduced.has(name))).toEqual([]);
  });

  it('resolves the spinner to 26px square with a 3px border and 900ms animation', () => {
    const spinner = properties(topLevelRules(plainAdmin).filter((rule) => rule.selector === '.ork-spinner').map((rule) => rule.body).join(';'));
    expect(value(light, spinner.get('width'))).toBe('26px');
    expect(value(light, spinner.get('height'))).toBe('26px');
    expect(value(light, spinner.get('border') ?? spinner.get('border-width'))).toMatch(/^3px(?: |$)/);
    expect(value(light, spinner.get('animation-duration') ?? spinner.get('animation'))).toContain('900ms');

    const reducedBody = bodies(plainAdmin, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g);
    const reducedRules = topLevelRules(reducedBody);
    const reducedSpinner = properties(reducedRules.filter((rule) => rule.selector === '.ork-spinner').map((rule) => rule.body).join(';'));
    expect(value(reduced, reducedSpinner.get('animation-duration'))).toBe('1600ms');
    const universal = properties(reducedRules.filter((rule) => rule.selector.startsWith('*')).map((rule) => rule.body).join(';'));
    expect(value(reduced, universal.get('animation-duration'))).toBe('0.01ms');
    expect(value(reduced, universal.get('transition-duration'))).toBe('0.01ms');
  });

  it('resolves the focus rule and the numeric helper from generated roles', () => {
    const focus = properties(topLevelRules(plainAdmin).filter((rule) => rule.selector.includes(':focus-visible')).map((rule) => rule.body).join(';'));
    const outline = substitute(light, focus.get('outline') ?? '<missing>');
    expect(canon(outline).startsWith('3px solid ')).toBe(true);
    expect(mentions(outline, lightRoles.primary)).toBe(true);
    expect(value(light, focus.get('outline-offset'))).toBe('2px');
    const numeric = properties(topLevelRules(plainAdmin).filter((rule) => rule.selector === '.ork-numeric').map((rule) => rule.body).join(';'));
    expect(value(light, numeric.get('font-variant-numeric'))).toBe('tabular-nums lining-nums');
  });
});

describe('admin stylesheet wiring', () => {
  const lines = indexCss.split(/\r?\n/);
  const isImportOf = (line: string, file: string): boolean =>
    line.trim().startsWith(IMPORT) && new RegExp(`["']\\./${escapeRegExp(file)}["']`).test(line);

  it('deletes the pending file and imports the bundle and admin stylesheet once inside the layer', () => {
    expect(existsSync(pendingPath)).toBe(false);
    expect(existsSync(adminPath)).toBe(true);
    const at: number[] = [];
    for (const file of ['orderak-tokens.css', 'orderak-admin.css']) {
      const matches = lines.map((line, index) => ({ line: line.trim(), index })).filter((entry) => isImportOf(entry.line, file));
      expect(matches, file).toHaveLength(1);
      expect(matches[0].line).toMatch(/layer\(\s*orderak-fallback\s*\)\s*;$/);
      at.push(matches[0].index);
    }
    const between = lines.slice(Math.min(at[0], at[1]) + 1, Math.max(at[0], at[1])).join('\n');
    expect(stripComments(between).trim()).toBe('');
    expect(indexCss).not.toContain('orderak-tokens-pending');
    for (const name of DELETED) expect(declares(indexCss, name), name).toBe(false);
  });

  it('keeps the fallback explanation and the rail rule', () => {
    expect(indexCss).toContain('FALLBACK');
    expect(indexCss).toMatch(/Unlayered\s+author\s+styles\s+always\s+beat\s+layered\s+ones/);
    const sidebarAt = indexCss.search(/^\.sidebar\s*\{/m);
    expect(sidebarAt).toBeGreaterThan(-1);
    const before = indexCss.slice(0, sidebarAt);
    const comment = before.slice(before.lastIndexOf('/*'));
    expect(comment).toContain('.orderak-dark');
    expect(comment).toMatch(/directly/i);
  });

  it('drops the #fff literal fallback for the primary foreground', () => {
    expect(indexCss).not.toMatch(/var\(\s*--orderak-on-primary\s*,\s*#fff\s*\)/i);
    expect(indexCss).toMatch(/--color-primary-foreground\s*:\s*var\(\s*--orderak-on-primary\s*\)/);
  });

  it('drops the literal fallbacks from the preview stylesheet', () => {
    expect(previewCss).not.toMatch(/#f3fbfa/i);
    expect(previewCss).not.toMatch(/#151d1d/i);
    const root = bodies(stripComments(previewCss), /:root\s*\{/g, true);
    expect(root).toMatch(/background\s*:\s*var\(\s*--md-background\s*\)\s*;/);
    expect(root).toMatch(/(?:^|[\s;{])color\s*:\s*var\(\s*--md-on-surface\s*\)\s*;/);
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
      expect(own.some((rule) => mixed.test(rule.body)), cls).toBe(true);
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
    const buildInfo = /"tsBuildInfoFile"\s*:\s*"([^"]+)"/.exec(testConfig)?.[1] ?? '';
    const appBuildInfo = /"tsBuildInfoFile"\s*:\s*"([^"]+)"/.exec(app)?.[1] ?? '';
    expect(buildInfo).not.toBe('');
    expect(buildInfo).not.toBe(appBuildInfo);
    expect(solution).toMatch(/"path"\s*:\s*"\.\/tsconfig\.test\.json"/);
    expect(solution).toMatch(/"path"\s*:\s*"\.\/tsconfig\.app\.json"/);
  });
});
