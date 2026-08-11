import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';

describe('accessible admin primitives', () => {
  it('renders semantic column headers, filter input and named pagination controls', () => {
    render(<DataTable rows={[{ id: 1, store_name: 'North Market', status: 'active' }]} preferred={['store_name', 'status']} />);
    expect(screen.getByRole('columnheader', { name: 'Store Name' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Filter these results')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy();
  });

  it('exposes status text without relying on color alone', () => {
    render(<StatusBadge value="critical" />);
    expect(screen.getByText('critical')).toBeTruthy();
  });
});
