import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';

// src/tests/accessibility.test.tsx is being rewritten into browser-based axe
// checks; these two jsdom-level semantic assertions it used to carry must not
// quietly disappear in that rewrite.
describe('DataTable and StatusBadge semantics survive the a11y suite rewrite', () => {
  it('renders semantic column headers, a labelled filter input and named pagination controls', () => {
    render(<DataTable rows={[{ id: 1, store_name: 'North Market', status: 'active' }]} preferred={['store_name', 'status']} />);
    expect(screen.getByRole('columnheader', { name: 'Store Name' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Filter these results')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy();
  });

  it('exposes status text without relying on colour alone', () => {
    render(<StatusBadge value="critical" />);
    expect(screen.getByText('critical')).toBeTruthy();
  });
});
