// Two cell-rendering defects that both showed the operator something untrue.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/shared/ui/DataTable';
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
