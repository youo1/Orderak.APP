import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const adminSrc = path.join(repositoryRoot, 'apps', 'admin-web', 'src');
const bundle = readFileSync(path.join(adminSrc, 'orderak-tokens.css'), 'utf8');

interface WebColor { hex: string; rgb: string; oklch: string }
interface Fixture {
  snapshot: { web: { colors: { standard: { light: Record<string, WebColor>; dark: Record<string, WebColor> } } } };
}
const fixture = JSON.parse(readFileSync(path.join(repositoryRoot, 'design', 'design-system.default.json'), 'utf8')) as Fixture;

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

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

function resolve(decls: Map<string, string>, name: string, depth = 0): string | undefined {
  if (depth > 40) return undefined;
  const value = decls.get(name);
  if (value === undefined) return undefined;
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
  if (!ref) return value;
  return resolve(decls, ref[1], depth + 1);
}

const plain = stripComments(bundle);
const root = declarations(bodies(plain, /:root\s*\{/g, true));
const rail = declarations(bodies(plain, /\.orderak-dark\s*\{/g));
const light = fixture.snapshot.web.colors.standard.light;
const dark = fixture.snapshot.web.colors.standard.dark;

describe('committed admin bundle restores the three B1-remapped aliases', () => {
  it('resolves --primary-strong, --primary-soft and --surface to onPrimaryContainer/primaryContainer/surfaceContainerLowest in :root', () => {
    expect(resolve(root, '--primary-strong')).toBe(light.onPrimaryContainer.hex);
    expect(resolve(root, '--primary-soft')).toBe(light.primaryContainer.hex);
    expect(resolve(root, '--surface')).toBe(light.surfaceContainerLowest.hex);
    expect(resolve(root, '--orderak-primary-strong')).toBe(light.onPrimaryContainer.hex);
    expect(resolve(root, '--orderak-primary-soft')).toBe(light.primaryContainer.hex);
  });

  it('resolves the same three aliases in .orderak-dark to the dark-mode restored roles', () => {
    expect(resolve(rail, '--primary-strong')).toBe(dark.onPrimaryContainer.hex);
    expect(resolve(rail, '--primary-soft')).toBe(dark.primaryContainer.hex);
    expect(resolve(rail, '--surface')).toBe(dark.surfaceContainerLowest.hex);
  });
});
