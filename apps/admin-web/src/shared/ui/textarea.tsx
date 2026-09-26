import * as React from 'react';
import { cn } from '@/shared/lib/utils';

/** The control classes the kit's `Input` uses, so the two elements match. */
const CONTROL =
	'flex w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-50';

/**
 * A native `<textarea>`, styled as the kit's `Input` is.
 *
 * `Input` covers one line and Radix's `Select` replaces the element it styles, so
 * neither could absorb the multi-line fields: `.field textarea` was a rule in
 * `index.css` with a `min-height: 96px`, and the alternative to this component was
 * a fifth place that hand-writes a control's border and focus ring.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
	({ className, ...props }, ref) => (
		<textarea ref={ref} className={cn(CONTROL, 'min-h-24 resize-y py-2.5', className)} {...props} />
	),
);
Textarea.displayName = 'Textarea';

/**
 * A native `<select>`, styled as the kit's `Input` is.
 *
 * Deliberately not the Radix `Select` beside it. That one is a custom popup with
 * its own API, and every `.field select` call site is a plain form control with an
 * `onChange` — adopting Radix there would be a behaviour change dressed as a
 * consolidation, in the same commit as a styling change. This keeps the native
 * element and the native keyboard and accessibility behaviour, and takes only the
 * appearance from the kit.
 */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
	({ className, ...props }, ref) => (
		<select ref={ref} className={cn(CONTROL, 'h-10 appearance-none pr-8', className)} {...props} />
	),
);
NativeSelect.displayName = 'NativeSelect';
