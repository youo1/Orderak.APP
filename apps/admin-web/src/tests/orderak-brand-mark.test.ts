import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Plan item B9: the admin favicon must be the approved Orderak mark, not
// Vite's default placeholder.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const adminPublic = path.join(repositoryRoot, 'apps', 'admin-web', 'public');

describe('plan item B9: admin-web drops the legacy Orderak mark', () => {
  it('serves the exported favicon SVG byte for byte, not the Vite placeholder', () => {
    const exported = readFileSync(path.join(repositoryRoot, 'design', 'assets', 'brand', 'svg', 'orderak-favicon.svg'));
    const served = readFileSync(path.join(adminPublic, 'favicon.svg'));
    expect(served.equals(exported)).toBe(true);
  });
});
