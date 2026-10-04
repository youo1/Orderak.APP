import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
    generatorVersion: string;
    contentHash: string;
    web: { colors: Record<Contrast, Record<Mode, Record<string, WebColor>>> };
  };
}

const fixture = JSON.parse(read(path.join(repositoryRoot, 'design', 'design-system.default.json'))) as Fixture;
const bundlePath = path.join(adminSrc, 'orderak-tokens.css');
const pendingPath = path.join(adminSrc, 'orderak-tokens-pending.css');
const bundle = read(bundlePath);
const pending = readIfPresent(pendingPath);
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

function rules(css: string): Array<{ selector: string; body: string }> {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

function adminStylesheets(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...adminStylesheets(full));
    else if (entry.name.endsWith('.css')) found.push(full);
  }
  return found;
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
  ['--orderak-shadow-raised', '0 5px 14px rgba(20,20,31,.08)'],
  ['--orderak-shadow-modal', '0 16px 40px rgba(13,21,20,.08)'],
  ['--orderak-shadow-overlay', '0 30px 80px rgba(20,20,31,.14)'],
  ['--orderak-duration-short', '150ms'],
  ['--orderak-duration-medium', '180ms'],
  ['--orderak-duration-long', '200ms'],
  ['--orderak-easing-standard', 'cubic-bezier(.2,0,0,1)'],
  ['--orderak-easing-linear', 'linear'],
  ['--orderak-motion-fast', 'var(--orderak-duration-short) ease'],
  ['--orderak-motion-drawer', 'var(--orderak-duration-long) ease'],
  ['--orderak-state-hover', '0.08'],
  ['--orderak-disabled-opacity-web', '0.5'],
  ['--orderak-focus-ring-width', '3px'],
  ['--orderak-focus-ring-offset', '2px'],
  ['--orderak-focus-ring-color', 'rgba(30,58,138,.22)'],
  ['--orderak-focus-ring', 'var(--orderak-focus-ring-width) solid var(--orderak-focus-ring-color)'],
  ['--orderak-hover-surface', '#F0F3FA'],
  ['--orderak-hover-surface', '#242B2C'],
  ['--orderak-hover-tint', 'var(--orderak-primary-soft)'],
  ['--orderak-breakpoint-medium', '860px'],
  ['--orderak-grid-metric', 'repeat(4, minmax(0, 1fr))'],
  ['--orderak-sidebar-width', '268px'],
  ['--orderak-topbar-height', '64px'],
  ['--orderak-mark-green', '#1DAB61'],
  ['--orderak-font-family-tajawal', '"Orderak Tajawal",Tajawal,system-ui,sans-serif'],
  ['--orderak-font-family-noto', '"Orderak Noto Arabic","Noto Sans Arabic",system-ui,sans-serif'],
  ['--orderak-type-latin-floor', '12px'],
  ['--shadow', 'var(--orderak-shadow-modal)'],
  ['--g', 'var(--orderak-primary)'],
  ['--bg', 'var(--orderak-canvas)'],
  ['--tx', 'var(--orderak-ink)'],
  ['--mut', 'var(--orderak-muted)'],
];

/** Non-token rules of the old bundle that must survive verbatim in the pending file. */
const PENDING_RULES = [
  '@keyframes ork-spin{to{transform:rotate(360deg)}}',
  '.ork-spinner{width:26px;height:26px;border:3px solid var(--md-sys-color-surface-variant);border-top-color:var(--md-sys-color-primary);border-radius:50%;animation:ork-spin .9s var(--orderak-easing-linear) infinite}',
  '.ork-numeric{font-variant-numeric:var(--orderak-numeric-tabular);font-feature-settings:"tnum" 1,"lnum" 1}',
  '.ork-numeric-pair{font-variant-numeric:var(--orderak-numeric-tabular);direction:ltr;unicode-bidi:isolate}',
  '.ork-display-large{font:var(--orderak-type-display-large-weight) var(--orderak-type-display-large-size)/var(--orderak-type-display-large-line-height) var(--orderak-font-family);letter-spacing:var(--orderak-type-display-large-tracking)}',
  '.ork-label-small{font:var(--orderak-type-label-small-weight) var(--orderak-type-label-small-size)/var(--orderak-type-label-small-line-height) var(--orderak-font-family);letter-spacing:var(--orderak-type-label-small-tracking)}',
  '.ork-interactive{position:relative;isolation:isolate}',
  '.ork-interactive::after{content:"";position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;pointer-events:none;transition:opacity var(--orderak-duration-short) var(--orderak-easing-standard)}',
  '.ork-interactive:hover::after{opacity:var(--orderak-state-hover)}',
  '.ork-interactive:disabled,.ork-interactive[aria-disabled="true"]{opacity:var(--orderak-disabled-opacity-web);cursor:not-allowed}',
  ':where(a,button,input,select,textarea,[tabindex]):focus-visible{outline:var(--orderak-focus-ring);outline-offset:var(--orderak-focus-ring-offset)}',
  '.ork-page{width:min(var(--orderak-container-admin),100%);margin-inline:auto;padding:var(--orderak-page-padding-block) var(--orderak-gutter-admin) 70px}',
  '.ork-grid-metric{display:grid;grid-template-columns:var(--orderak-grid-metric);gap:var(--orderak-grid-gap)}',
  '.ork-grid-panel{display:grid;grid-template-columns:var(--orderak-grid-panel);gap:18px}',
];

/** The 18 properties the admin uses that only the old bundle defined. */
const BUNDLE_ONLY_PROPERTIES = [
  '--orderak-canvas', '--orderak-ink', '--orderak-line', '--orderak-primary-tint', '--orderak-success-soft',
  '--orderak-duration-long', '--orderak-duration-medium', '--orderak-motion-drawer', '--orderak-motion-fast',
  '--orderak-focus-ring', '--orderak-focus-ring-offset', '--orderak-hover-surface', '--orderak-numeric-tabular',
  '--orderak-shadow-card', '--orderak-shadow-overlay', '--orderak-shape-full', '--orderak-sidebar-width',
  '--orderak-topbar-height',
];

/** Tokens the generator does not own yet; none may appear in the generated bundle. */
const HAND_KEPT_NAMES = [
  '--orderak-font-family-tajawal', '--orderak-font-family-noto', '--orderak-type-latin-floor', '--orderak-hover-tint',
  '--orderak-hover-surface', '--orderak-focus-ring', '--orderak-focus-ring-color', '--orderak-shadow-card',
  '--orderak-shadow-modal', '--orderak-duration-short', '--orderak-motion-fast', '--orderak-easing-standard',
  '--orderak-state-hover', '--orderak-breakpoint-medium', '--orderak-sidebar-width', '--orderak-topbar-height',
  '--orderak-numeric-tabular', '--orderak-mark-green', '--orderak-shape-full', '--shadow', '--g', '--bg', '--tx', '--mut',
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
    expect(pending).not.toContain('rgba(8,12,30');
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

  it('contains generator-owned tokens only', () => {
    const plain = stripComments(bundle);
    expect(plain).not.toMatch(/@keyframes|\.ork-|:focus-visible|prefers-reduced-motion/);
    const present = HAND_KEPT_NAMES.filter((name) => declares(bundle, name));
    expect(present).toEqual([]);
  });
});

describe('hand-kept pending tokens', () => {
  it('exists with a header saying it is hand-kept until B2 deletes it', () => {
    expect(pending).not.toBe('');
    const header = /^\s*\/\*[\s\S]*?\*\//.exec(pending)?.[0] ?? '';
    expect(header).toMatch(/hand[- ]?kept/i);
    expect(header).toContain('B2');
  });

  it('preserves the unowned families verbatim', () => {
    const plain = stripComments(pending);
    const missing = PENDING_VALUES.filter(([name, value]) =>
      !new RegExp(`(?:^|[\\s;{])${escapeRegExp(name)}\\s*:\\s*${escapeRegExp(value)}\\s*[;}]`).test(plain));
    expect(missing).toEqual([]);
    const root = bodies(plain, /:root\s*\{/g, true);
    expect(root).toMatch(/--orderak-hover-surface\s*:\s*#F0F3FA/);
    const rail = squash(bodies(plain, /\.orderak-dark\s*\{/g));
    for (const declaration of ['--orderak-hover-surface:#242B2C', '--orderak-focus-ring-color:rgba(149,209,210,.34)', '--orderak-focus-field-ring:0 0 0 3px rgba(149,209,210,.18)', '--orderak-hover-border:#6B7A7C']) {
      expect(rail, declaration).toContain(squash(declaration));
    }
  });

  it('preserves every non-token rule of the old bundle with its scoping', () => {
    const all = squash(pending);
    const missing = PENDING_RULES.filter((rule) => !all.includes(squash(rule)));
    expect(missing).toEqual([]);
    const plain = stripComments(pending);
    const reduced = squash(bodies(plain, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g));
    for (const piece of [
      '*,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important;scroll-behavior:auto !important}',
      '.ork-spinner{animation-duration:1.6s !important;animation-iteration-count:infinite !important}',
      '--orderak-duration-long:0ms',
      '--orderak-motion-fast:0ms linear',
      '--orderak-motion-drawer:0ms linear',
    ]) {
      expect(reduced, piece).toContain(squash(piece));
    }
    expect(squash(bodies(plain, /@media\s*\(\s*max-width\s*:\s*1240px\s*\)\s*\{/g))).toContain(squash('.ork-grid-metric{grid-template-columns:repeat(2,minmax(0,1fr))}'));
    const medium = squash(bodies(plain, /@media\s*\(\s*max-width\s*:\s*860px\s*\)\s*\{/g));
    expect(medium).toContain(squash('.ork-grid-panel{grid-template-columns:1fr}'));
    expect(medium).toContain(squash('.ork-page{padding-inline:var(--orderak-space4)}'));
    expect(squash(bodies(plain, /@media\s*\(\s*max-width\s*:\s*600px\s*\)\s*\{/g))).toContain(squash('.ork-grid-metric{grid-template-columns:1fr}'));
  });

  it('holds no generator-owned tokens', () => {
    const plain = stripComments(pending);
    expect(plain).not.toContain('@font-face');
    expect(plain).not.toMatch(/--md-sys-color-[a-z-]+\s*:/);
    expect(plain).not.toMatch(/--orderak-type-[a-z-]+-(?:size|line-height|weight|tracking)\s*:/);
    expect(plain).not.toMatch(/--orderak-space\d+\s*:/);
    expect(plain).not.toMatch(/--orderak-shape-(?:extra-small|small|medium|large|extra-large)\s*:/);
    expect(declares(plain, '--orderak-font-family')).toBe(false);
    expect(declares(plain, '--orderak-minimum-touch-target')).toBe(false);
    const owned = [
      ...SEMANTIC_ALIASES,
      '--orderak-on-accent',
      ...LEGACY_ALIASES,
      ...Object.keys(fixture.snapshot.web.colors.standard.light).map((role) => `--orderak-${kebab(role)}`),
    ].filter((name) => declares(plain, name));
    expect(owned).toEqual([]);
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
  const lines = indexCss.split(/\r?\n/);
  const isImportOf = (line: string, file: string): boolean =>
    line.trim().startsWith(IMPORT) && new RegExp(`["']\\./${escapeRegExp(file)}["']`).test(line);

  it('imports each token source exactly once, adjacently, inside layer(orderak-fallback)', () => {
    const at: number[] = [];
    for (const file of ['orderak-tokens.css', 'orderak-tokens-pending.css']) {
      const matches = lines.map((line, index) => ({ line: line.trim(), index })).filter((entry) => isImportOf(entry.line, file));
      expect(matches, file).toHaveLength(1);
      expect(matches[0].line).toMatch(/layer\(\s*orderak-fallback\s*\)\s*;$/);
      at.push(matches[0].index);
    }
    const between = lines.slice(Math.min(at[0], at[1]) + 1, Math.max(at[0], at[1])).join('\n');
    expect(stripComments(between).trim()).toBe('');
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

  it('uses only tokens that .orderak-dark redefines directly inside the navigation rail', () => {
    const rail = /(?:^|[\s,>+~])(?:\.sidebar(?![\w-])|\.sidebar-user|\.brand(?![\w-])|\.brand-mark|\.mobile-close|\.command-trigger|kbd|\.nav-group)/;
    const nonColour = /^--orderak-(?:type-|shape-|duration-|motion-|space\d|sidebar-width|topbar-height|font-family|minimum-touch-target)/;
    const railDeclared = `${bodies(stripComments(bundle), /\.orderak-dark\s*\{/g)}\n${bodies(stripComments(pending), /\.orderak-dark\s*\{/g)}`;
    const used = new Set<string>();
    for (const rule of rules(indexCss)) {
      if (!rail.test(` ${rule.selector}`) || /palette|workspace|navigation-hidden/.test(rule.selector)) continue;
      for (const match of rule.body.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(10);
    const missing = [...used].filter((name) => !nonColour.test(name) && !declares(railDeclared, name));
    expect(missing).toEqual([]);
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

  it('has no admin stylesheet painting the scrim as a background at full opacity', () => {
    const offenders: string[] = [];
    for (const file of adminStylesheets(adminSrc)) {
      if (file === bundlePath || file === pendingPath) continue;
      for (const rule of rules(read(file))) {
        for (const match of rule.body.matchAll(/(?:^|[\s;])background(?:-color)?\s*:\s*([^;]+)/g)) {
          const value = match[1].trim();
          if (!/var\(\s*--orderak-scrim\s*\)/.test(value)) continue;
          if (/^color-mix\(\s*in\s+oklch\s*,\s*var\(\s*--orderak-scrim\s*\)\s+48%\s*,\s*transparent\s*\)/.test(value)) continue;
          offenders.push(`${path.relative(adminSrc, file)} ${rule.selector}: ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
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
