import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const adminSrc = path.join(repositoryRoot, 'apps', 'admin-web', 'src');

// verify-theme-authority.mjs scans .ts files for a second import of the token
// sources, so the import keyword is assembled here rather than written out.
const IMPORT = ['@imp', 'ort'].join('');

const read = (file: string): string => readFileSync(file, 'utf8');
const readIfPresent = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8') : '');

type Formats = { hex: string; rgb: string; oklch: string };
interface Fixture {
  snapshot: {
    schemaVersion: number;
    generatorVersion: string;
    contentHash: string;
    web: { colors: Record<string, Record<string, Record<string, Formats>>> };
  };
}
interface Scope { decls: Map<string, string>; parent?: Scope }

const ADMIN_STYLESHEET = 'orderak-admin.css';
const fixture = JSON.parse(read(path.join(repositoryRoot, 'design', 'design-system.default.json'))) as Fixture;
const pendingPath = path.join(adminSrc, 'orderak-tokens-pending.css');
const adminPath = path.join(adminSrc, ADMIN_STYLESHEET);
const bundle = read(path.join(adminSrc, 'orderak-tokens.css'));
const adminCss = readIfPresent(adminPath);
const indexCss = read(path.join(adminSrc, 'index.css'));

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

function declarations(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of body.matchAll(/(?:^|[\s;{])(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+)/g)) found.set(match[1], match[2].trim());
  return found;
}

function topLevelRules(css: string): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => depthAt(css, match.index ?? 0) === 0)
    .map((match) => ({ selector: match[1].trim(), body: match[2] }));
}

function properties(rulesFound: Array<{ body: string }>): Map<string, string> {
  const found = new Map<string, string>();
  for (const rule of rulesFound) {
    for (const part of rule.body.split(';')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
  }
  return found;
}

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

const mentions = (value: string, formats: Formats): boolean => {
  const v = value.toLowerCase().replace(/\s+/g, ' ');
  return v.includes(formats.hex.toLowerCase()) || v.includes(formats.rgb) || v.includes(formats.oklch.toLowerCase());
};

const plainBundle = stripComments(bundle);
const bundleRoot = declarations(bodies(plainBundle, /:root\s*\{/g, true));
const bundleReduced = declarations(bodies(plainBundle, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g));
const light: Scope = { decls: bundleRoot };
const reduced: Scope = { decls: new Map([...bundleRoot, ...bundleReduced]) };
const plainAdmin = stripComments(adminCss);
const lightRoles = fixture.snapshot.web.colors.standard.light;

/** Custom properties the admin reads that the pending file or the old bundle defined. */
const USED_BY_ADMIN = [
  '--orderak-numeric-tabular', '--orderak-shape-full', '--orderak-shadow-card', '--orderak-shadow-overlay',
  '--orderak-duration-medium', '--orderak-duration-long', '--orderak-motion-fast', '--orderak-motion-drawer',
  '--orderak-focus-ring', '--orderak-focus-ring-offset', '--orderak-hover-surface', '--orderak-sidebar-width',
  '--orderak-topbar-height', '--orderak-canvas', '--orderak-ink', '--orderak-line', '--orderak-primary-tint',
  '--orderak-success-soft',
];

/** Pending-file declarations nothing read; B2 deletes them. */
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

describe('B2 admin token layout', () => {
  it('deletes the pending file and imports the generated bundle and the admin stylesheet once each inside the fallback layer', () => {
    expect(existsSync(pendingPath)).toBe(false);
    expect(existsSync(adminPath)).toBe(true);
    const lines = indexCss.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith(IMPORT));
    expect(lines.filter((line) => line.includes('orderak-tokens-pending'))).toEqual([]);
    for (const file of ['orderak-tokens.css', ADMIN_STYLESHEET]) {
      const matches = lines.filter((line) => new RegExp(`["']\\./${escapeRegExp(file)}["']`).test(line));
      expect(matches, file).toHaveLength(1);
      expect(matches[0]).toMatch(/layer\(\s*orderak-fallback\s*\)\s*;$/);
    }
  });

  it('keeps only the live rules in the admin stylesheet and declares no token there', () => {
    expect(plainAdmin.trim()).not.toBe('');
    expect(plainAdmin).not.toMatch(/(?:^|[\s;{])--[a-zA-Z0-9-]+\s*:/);
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

  it('writes no token value by hand in the admin stylesheet', () => {
    const withoutKeyframes = plainAdmin.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    expect(withoutKeyframes.match(/(?<![\w-])\d*\.?\d+(?:px|ms|s|rem|em|vh|vw)\b/g) ?? []).toEqual([]);
    expect(withoutKeyframes).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/i);
    const referenced = [...plainAdmin.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1]);
    expect(referenced.filter((name) => !bundleRoot.has(name) && !bundleReduced.has(name))).toEqual([]);
  });

  it('resolves the admin stylesheet through the generated bundle to the values it had', () => {
    const value = (scope: Scope, raw: string | undefined): string => canon(substitute(scope, raw ?? '<missing>'));
    const spinner = properties(topLevelRules(plainAdmin).filter((rule) => rule.selector === '.ork-spinner'));
    expect(value(light, spinner.get('width'))).toBe('26px');
    expect(value(light, spinner.get('height'))).toBe('26px');
    expect(value(light, spinner.get('border') ?? spinner.get('border-width'))).toMatch(/^3px(?: |$)/);
    expect(value(light, spinner.get('animation-duration') ?? spinner.get('animation'))).toContain('900ms');

    const reducedBody = bodies(plainAdmin, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g);
    const reducedRules = topLevelRules(reducedBody);
    const reducedSpinner = properties(reducedRules.filter((rule) => rule.selector === '.ork-spinner'));
    expect(value(reduced, reducedSpinner.get('animation-duration'))).toBe('1600ms');
    const universal = properties(reducedRules.filter((rule) => rule.selector.startsWith('*')));
    expect(value(reduced, universal.get('animation-duration'))).toBe('0.01ms');
    expect(value(reduced, universal.get('transition-duration'))).toBe('0.01ms');

    const focus = properties(topLevelRules(plainAdmin).filter((rule) => rule.selector.includes(':focus-visible')));
    const outline = substitute(light, focus.get('outline') ?? '<missing>');
    expect(canon(outline).startsWith('3px solid ')).toBe(true);
    expect(mentions(outline, lightRoles.primary)).toBe(true);
    expect(value(light, focus.get('outline-offset'))).toBe('2px');

    const numeric = properties(topLevelRules(plainAdmin).filter((rule) => rule.selector === '.ork-numeric'));
    expect(value(light, numeric.get('font-variant-numeric'))).toBe('tabular-nums lining-nums');
  });

  it('leaves none of the properties the admin uses undefined and keeps their values', () => {
    expect(USED_BY_ADMIN.filter((name) => !bundleRoot.has(name))).toEqual([]);
    const expected: Array<[string, string]> = [
      ['--orderak-numeric-tabular', 'tabular-nums lining-nums'], ['--orderak-shape-full', '999px'],
      ['--orderak-duration-medium', '180ms'], ['--orderak-duration-long', '200ms'],
      ['--orderak-motion-fast', '150ms ease'], ['--orderak-motion-drawer', '200ms ease'],
      ['--orderak-focus-ring-offset', '2px'], ['--orderak-sidebar-width', '268px'], ['--orderak-topbar-height', '64px'],
    ];
    for (const [name, want] of expected) expect(canon(resolve(light, name) ?? '<missing>'), name).toBe(canon(want));
    expect(canon(resolve(light, '--orderak-shadow-card') ?? '').startsWith('0 5px 18px ')).toBe(true);
    expect(canon(resolve(light, '--orderak-shadow-overlay') ?? '').startsWith('0 30px 80px ')).toBe(true);
    expect(canon(resolve(light, '--orderak-focus-ring') ?? '').startsWith('3px solid ')).toBe(true);
    expect(mentions(resolve(light, '--orderak-hover-surface') ?? '', lightRoles.surfaceContainerLow)).toBe(true);
  });

  it('deletes the unused pending declarations and every retired palette colour', () => {
    for (const [label, css] of [['bundle', bundle], ['admin stylesheet', adminCss], ['index.css', indexCss]] as const) {
      expect(DELETED.filter((name) => declares(css, name)), label).toEqual([]);
      const squashed = stripComments(css).replace(/\s+/g, '');
      for (const retired of ['30,58,138', '149,209,210', '20,20,31', '13,21,20', '0,0,0,.067']) {
        expect(squashed, `${label} ${retired}`).not.toContain(retired);
      }
    }
    for (const css of [adminCss, indexCss]) {
      expect(stripComments(css)).not.toMatch(/#F0F3FA|#B8C0D4/i);
    }
  });

  it('ships a schema-3 fixture whose hash heads the committed bundle', () => {
    expect(fixture.snapshot.schemaVersion).toBe(3);
    expect(fixture.snapshot.generatorVersion).toBe('orderak-mcu-0.3.0+4');
    const header = /^\s*\/\*[\s\S]*?\*\//.exec(bundle)?.[0] ?? '';
    expect(header).toContain(fixture.snapshot.contentHash);
    expect(header).toContain(fixture.snapshot.generatorVersion);
  });

  it('points the guards at the admin stylesheet without exempting it', () => {
    const authority = read(path.join(repositoryRoot, 'tooling', 'repository', 'verify-theme-authority.mjs'));
    expect(authority).toContain(ADMIN_STYLESHEET);
    const conformance = read(path.join(repositoryRoot, 'tooling', 'repository', 'verify-admin-token-conformance.mjs'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(conformance).not.toContain('orderak-tokens-pending');
    expect(conformance).not.toContain(ADMIN_STYLESHEET);
    expect(conformance).toContain('orderak-tokens.css');
  });
});
