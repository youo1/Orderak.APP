import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest runs this file with cwd = apps/admin-web (pnpm --dir apps/admin-web ...).
const root = process.cwd();

describe('a11y pipeline wiring', () => {
  it('declares exactly the two approved a11y devDependencies at the pinned versions', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['axe-core']).toBe('4.14.0');
    expect(pkg.devDependencies['@vitest/browser-playwright']).toBe('4.1.11');
    expect(pkg.devDependencies['@axe-core/playwright']).toBeUndefined();
    expect(pkg.devDependencies['jest-axe']).toBeUndefined();
    expect(pkg.devDependencies['cypress-axe']).toBeUndefined();
  });

  it('runs test:a11y through a dedicated vitest config, not the default one', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:a11y']).toContain('vitest.a11y.config');
  });

  it('keeps the jsdom suite from also running the accessibility test file', () => {
    const jsdomConfig = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8');
    expect(jsdomConfig).toMatch(/exclude/);
    expect(jsdomConfig).toMatch(/src\/tests\/accessibility\.test\.tsx/);
  });

  it('has a dedicated browser-mode config limited to the accessibility test, in headless Chromium via Playwright', () => {
    const configPath = resolve(root, 'vitest.a11y.config.ts');
    expect(existsSync(configPath)).toBe(true);
    const a11yConfig = readFileSync(configPath, 'utf8');
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(a11yConfig).toMatch(/src\/tests\/accessibility\.test\.tsx/);
    expect(a11yConfig).toMatch(/playwright/i);
    expect(a11yConfig).toMatch(/chromium/i);
    expect(a11yConfig + String(pkg.scripts['test:a11y'])).toMatch(/headless/i);
  });
});
