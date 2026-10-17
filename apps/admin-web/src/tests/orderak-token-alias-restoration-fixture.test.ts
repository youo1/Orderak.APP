import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface WebColor { hex: string; rgb: string; oklch: string }
interface Fixture {
  snapshot: { web: { colors: { standard: { light: Record<string, WebColor>; dark: Record<string, WebColor> } } } };
}
const fixture = JSON.parse(readFileSync(path.join(repositoryRoot, 'design', 'design-system.default.json'), 'utf8')) as Fixture;
const light = fixture.snapshot.web.colors.standard.light;
const dark = fixture.snapshot.web.colors.standard.dark;

describe('the committed fixture already carries the restored roles at the approved hex values (fixture must not change)', () => {
  it('matches the exact restored values pinned by the task for light :root and .orderak-dark', () => {
    expect(light.onPrimaryContainer.hex).toBe('#054F50');
    expect(light.primaryContainer.hex).toBe('#B0EEEE');
    expect(light.surfaceContainerLowest.hex).toBe('#FFFFFF');
    expect(dark.onPrimaryContainer.hex).toBe('#B0EEEE');
    expect(dark.primaryContainer.hex).toBe('#054F50');
    expect(dark.surfaceContainerLowest.hex).toBe('#080F10');
  });
});
