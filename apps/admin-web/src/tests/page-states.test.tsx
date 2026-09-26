import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiError } from '@/shared/api/client';
import { ErrorState } from '@/shared/ui/Page';

/**
 * A refusal and a failure are two different things to an operator.
 *
 * The panel serves 176 admin operations behind four roles, and every section
 * rendered its query error through this one component. A page the operator's role
 * did not include therefore looked exactly like a page that had failed to load —
 * including a Try again button, which cannot change a 403.
 *
 * These assertions are the difference: the refusal says so, and offers nothing to
 * press; the failure keeps the retry.
 */
describe('ErrorState', () => {
  it('says a permission refusal is a refusal, and offers no retry', () => {
    render(<ErrorState error={new ApiError(403, 'forbidden', 'Forbidden')} retry={vi.fn()} />);

    expect(screen.getByText(/don't have access to this section/i)).toBeTruthy();
    expect(screen.getByText(/Admin access/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('keeps the failure state, and its retry, for everything else', () => {
    const retry = vi.fn();
    render(<ErrorState error={new ApiError(500, 'internal_error', 'Something broke')} retry={retry} />);

    expect(screen.getByText(/could not load this section/i)).toBeTruthy();
    expect(screen.getByText('Something broke')).toBeTruthy();

    const button = screen.getByRole('button', { name: /try again/i });
    button.click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('treats a plain Error as a failure rather than a refusal', () => {
    render(<ErrorState error={new Error('Network request failed')} retry={vi.fn()} />);

    expect(screen.getByText(/could not load this section/i)).toBeTruthy();
    expect(screen.queryByText(/don't have access/i)).toBeNull();
  });
});
