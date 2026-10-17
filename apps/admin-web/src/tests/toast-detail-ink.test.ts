import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css'), 'utf8');

describe('toast detail ink', () => {
  it('draws the optional detail line at 75% ink, as the approved design specifies', () => {
    const bodies = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(match => match[1].split(',').some(selector => selector.trim() === '.toast-detail'))
      .map(match => match[2])
      .join('\n');
    expect(bodies).toMatch(/color\s*:\s*color-mix\([^;]*75%|opacity\s*:\s*0?\.75\b/);
  });
});
