import * as React from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * A form field: the label, the control, and the hint under it.
 *
 * WHY THE KIT NEEDED THIS
 *   Forty-six call sites hand-rolled the same three lines —
 *   `<label className="field"><span>Name</span><input …/></label>` — against a
 *   `.field` rule in `index.css`. RD-16's whole point is that the kit holds the
 *   primitives, so the panel can stop keeping two implementations of every one of
 *   them in step by hand. Twelve of the thirteen files it names had no kit
 *   equivalent to move onto, so the migration needed this first rather than
 *   leaving a third shape behind.
 *
 * WHY IT WRAPS CHILDREN INSTEAD OF RENDERING THE CONTROL
 *   The call sites use `<input>`, `<select>` and `<textarea>`, and two of those
 *   have no kit component that is a drop-in: the kit's `Select` is Radix's, with a
 *   different API and a custom popup. Taking the control as a child lets a site
 *   adopt the kit's `Input` where it can and keep its own element where it cannot,
 *   in one change each, instead of forcing a rewrite of every form at once.
 *
 * The label is `text-xs` (12px) at `font-medium` (500) — the two values the
 * `label-medium` role declares, and the floor the design system sets for Latin
 * text a user has to read.
 */
export function Field({
	label,
	hint,
	className,
	children,
}: {
	label?: React.ReactNode;
	hint?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<label className={cn('grid gap-1.5', className)}>
			{label !== undefined && label !== null && label !== '' && (
				<span className="text-xs font-medium capitalize text-[var(--muted)]">{label}</span>
			)}
			{children}
			{hint !== undefined && hint !== null && hint !== '' && (
				<span className="text-xs text-[var(--muted)]">{hint}</span>
			)}
		</label>
	);
}
