import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { askConfirm, ConfirmHost } from '@/shared/ui/confirm';

/**
 * The confirmation every destructive action in the panel goes through.
 *
 * `window.confirm` could not be tested at all — no test can answer a browser
 * dialog — so before this the answer to "is it safe?" for thirteen irreversible
 * actions was "somebody read the call site". These are the two answers that
 * matter: the action runs on confirm, and it does not run on cancel.
 */
describe('askConfirm', () => {
  it('runs the action, once, only when the dialog is confirmed', () => {
    const action = vi.fn();
    render(<ConfirmHost />);

    act(() => {
      askConfirm('Publish this immutable plan revision?', action);
    });

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Publish this immutable plan revision?')).toBeTruthy();
    expect(action).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not run the action when it is cancelled', () => {
    const action = vi.fn();
    render(<ConfirmHost />);

    act(() => {
      askConfirm('Revoke this administrator session?', action);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('carries the label the call site asked for', () => {
    render(<ConfirmHost />);

    act(() => {
      askConfirm('Ban this seller?', vi.fn(), 'Ban seller');
    });

    expect(screen.getByRole('button', { name: 'Ban seller' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });
});
