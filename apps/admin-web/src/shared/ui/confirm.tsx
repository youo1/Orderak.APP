import { useEffect, useRef, useState } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './dialog';

type PendingConfirmation = { message: string; confirmLabel: string; onConfirm: () => void };

let pending: PendingConfirmation | null = null;
const listeners = new Set<(value: PendingConfirmation | null) => void>();

function emit() {
  for (const listener of listeners) listener(pending);
}

/**
 * Ask before an irreversible action, without `window.confirm`.
 *
 * WHY NOT `window.confirm`
 *   Thirteen sites used it. It is the browser's dialog: unstyled, unthemeable, and
 *   it blocks the JavaScript thread while it is open — an audited owner action in
 *   the admin console and a browser-native prompt look the same, which is the
 *   opposite of what a control plane should say about its own dangerous buttons.
 *   It is also untestable: no test can answer it, so every destructive path in
 *   this panel was outside the reach of the suite.
 *
 * WHY A CALLBACK AND NOT A BOOLEAN
 *   `window.confirm` returns a boolean, and every call site is shaped around that
 *   — `if (confirm(x)) mutate()`. A promise would make all thirteen handlers
 *   async and re-indent them; this takes the action to run instead, so a call
 *   site becomes `askConfirm(x, () => mutate())` and nothing else moves.
 *
 * WHY A MODULE AND NOT A CONTEXT
 *   Two of the call sites are inside `row =>` callbacks passed to `DataTable`,
 *   which is not a component and cannot read a hook.
 *
 * WHY RADIX `Dialog` AND NOT THE `.modal` CLASSES
 *   This file is part of the kit, and it was the one place the kit hand-rolled the
 *   primitive it exists to provide: a `div.modal-backdrop` with a `section.modal`,
 *   its own Escape listener, and no focus trap. Radix's dialog supplies what the
 *   hand-rolled one only claimed — `aria-modal`, a real focus trap, scroll lock,
 *   and portalled rendering — and the Escape handling in this file was a
 *   workaround for exactly the layer Radix already owns.
 *
 * The dialog is drawn by `<ConfirmHost />`, mounted once in the shell. Until it
 * is mounted the action is not run and a warning is logged, which is louder than
 * running something irreversible with no confirmation at all.
 */
export function askConfirm(message: string, onConfirm: () => void, confirmLabel = 'Confirm') {
  pending = { message, confirmLabel, onConfirm };
  emit();
}

function dismiss() {
  pending = null;
  emit();
}

export function ConfirmHost() {
  const [current, setCurrent] = useState<PendingConfirmation | null>(pending);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    listeners.add(setCurrent);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);

  if (!current) return null;

  return (
    <Dialog open onOpenChange={open => { if (!open) dismiss(); }}>
      <DialogContent
        // An alertdialog, not a dialog: it interrupts to ask about something that
        // cannot be undone, and assistive technology should say so.
        role="alertdialog"
        className="w-[min(520px,calc(100vw-32px))]"
        // Radix focuses the first tabbable child on open, which is the close
        // cross. That would put the destructive action one Tab away from a
        // control the reader did not ask for, so focus is placed on the action
        // the dialog was opened to ask about — the behaviour this dialog had.
        onOpenAutoFocus={event => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <DialogHeader>
          <p className="eyebrow">CONFIRM</p>
          {/* The message is the title. Radix warns without one, and a separate
              heading repeating it would be the same sentence twice. */}
          <DialogTitle>{current.message}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={dismiss}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            variant="destructive"
            onClick={() => {
              const action = current.onConfirm;
              // Dismissed before the action runs: the action may navigate or
              // refetch, and a dialog left open across that reads as a failure.
              dismiss();
              action();
            }}
          >
            {current.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
