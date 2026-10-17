// Two cell-rendering defects that both showed the operator something untrue.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';
import { format } from '@/shared/api/client';

describe('StatusBadge', () => {
  it('does not paint a negative status green because it contains a positive word', () => {
    // The tone came from /active|published|…/i.test(text), and "inactive"
    // contains "active". So every inactive, unavailable and unpublished row in
    // the console was painted with the success colour — the one thing a status
    // colour exists to prevent.
    const { container } = render(<StatusBadge value="inactive" />);
    const badge = container.querySelector('.status')!;
    expect(badge.className).toContain('negative');
    expect(badge.className).not.toContain('positive');
  });

  it('still paints the positive statuses positive', () => {
    for (const value of ['active', 'published', 'completed', 'succeeded']) {
      const { container } = render(<StatusBadge value={value} />);
      expect(container.querySelector('.status')!.className, value).toContain('positive');
    }
  });

  it('falls back to neutral rather than guessing', () => {
    const { container } = render(<StatusBadge value="something_nobody_mapped" />);
    expect(container.querySelector('.status')!.className).toContain('neutral');
    // The underscore still becomes a space for reading.
    expect(screen.getByText('something nobody mapped')).toBeTruthy();
  });
});

describe('format.date', () => {
  it('renders a dash instead of throwing inside a cell', () => {
    // Intl.DateTimeFormat.format throws RangeError on an Invalid Date, and this
    // runs in a cell renderer — so one row with an unparseable timestamp took
    // down the whole table, as a blank page rather than a blank cell.
    expect(format.date('not a date at all')).toBe('—');
    expect(format.date('')).toBe('—');
    expect(format.date(null)).toBe('—');
  });

  it('still formats the shape the API actually sends', () => {
    // SQLite datetime(), which carries no zone and is read as UTC.
    expect(format.date('2026-09-12 10:30:00')).not.toBe('—');
    expect(format.date('2026-09-12T10:30:00Z')).not.toBe('—');
  });
});

// B5: DataTable must tell an empty resource apart from a filter with no
// matches, instead of the single "No matching records" string both cases
// showed before. These checks are deliberately loose about exact copy and
// quote style (the design text nests quotes awkwardly) and only lock the
// parts the acceptance criteria name explicitly: which empty-state variant
// renders, that Clear filter exists only for "no match" and actually clears
// the query, and the "<n> of <total> records" filtered count format.
describe('DataTable empty states', () => {
  it('shows a "none yet" empty state with no rows at all, and no clear-filter action', () => {
    render(<DataTable rows={[]} preferred={['store_name']} />);
    expect(screen.getByText(/no records yet/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /clear filter/i })).toBeNull();
  });

  it('shows a "no match" empty state with a working Clear filter when a filter hides every row', () => {
    const rows = [
      { id: 1, store_name: 'North Market' },
      { id: 2, store_name: 'South Market' },
      { id: 3, store_name: 'East Market' },
    ];
    render(<DataTable rows={rows} preferred={['store_name']} />);

    const input = screen.getByPlaceholderText('Filter these results');
    fireEvent.change(input, { target: { value: 'zzz-no-such-store' } });

    // The empty state names the query that matched nothing...
    expect(screen.getByText(/zzz-no-such-store/)).toBeTruthy();
    // ...and the record count reads "<filtered> of <total> records", not just "0 records".
    expect(screen.getByText(/0 of 3 records/i)).toBeTruthy();

    const clear = screen.getByRole('button', { name: /clear filter/i });
    fireEvent.click(clear);

    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByText('North Market')).toBeTruthy();
    expect(screen.getByText('South Market')).toBeTruthy();
    expect(screen.getByText('East Market')).toBeTruthy();
    expect(screen.getByText(/page 1 of/i)).toBeTruthy();
  });

  it('keeps the plain "<n> records" count when nothing is filtered', () => {
    const rows = [
      { id: 1, store_name: 'North Market' },
      { id: 2, store_name: 'South Market' },
    ];
    render(<DataTable rows={rows} preferred={['store_name']} />);
    expect(screen.getByText('2 records')).toBeTruthy();
    expect(screen.queryByText(/of 2 records/i)).toBeNull();
  });
});
