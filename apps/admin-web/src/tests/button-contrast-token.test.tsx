import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Button } from '@/shared/ui/button';

// The default variant hard-coded text-white, which fails contrast against the
// dark scheme's primary. The fix must track the theme via the generated
// --orderak-on-primary token instead of a literal.
describe('Button default variant foreground', () => {
  it('tracks the theme instead of a hard-coded white foreground', () => {
    const { getByRole } = render(<Button>Save</Button>);
    const className = getByRole('button').className;
    expect(className).not.toMatch(/\btext-white\b/);
    expect(className).toMatch(/text-\[var\(--orderak-on-primary\)\]/);
  });
});
