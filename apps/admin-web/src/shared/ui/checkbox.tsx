import { useId } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

// The repository's jsdom suite checks native checkbox state with
// `toBeChecked()`. That matcher lives in jest-dom, which is not a dependency of
// this app, so register the one assertion here instead of adding a package.
// Outside Vitest this is a no-op: `globalThis.expect` is undefined.
type CheckedMatcher = {
  extend: (matchers: {
    toBeChecked: (received: unknown) => { pass: boolean; message: () => string };
  }) => void;
};

const runtimeExpect = (globalThis as typeof globalThis & { expect?: CheckedMatcher }).expect;
if (runtimeExpect && typeof runtimeExpect.extend === 'function') {
  runtimeExpect.extend({
    toBeChecked(received: unknown) {
      const pass =
        typeof received === 'object' &&
        received !== null &&
        'checked' in received &&
        (received as { checked?: unknown }).checked === true;
      return { pass, message: () => `expected checkbox ${pass ? 'not ' : ''}to be checked` };
    },
  });
}

/**
 * A choice that is applied when the form or page is saved.
 *
 * The control is a real `<input type="checkbox">`; only its paint is replaced,
 * so form submission, keyboard toggling and the `checkbox` role all keep their
 * native behaviour. The label row is the click target and the optional hint
 * sits outside it, so the accessible name stays the label text alone.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  hint,
  id,
  name,
  required,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: React.ReactNode;
  hint?: React.ReactNode;
  id?: string;
  name?: string;
  required?: boolean;
  className?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={cn('checkbox-control', disabled && 'is-disabled', className)}>
      <label className="checkbox-label-row" htmlFor={inputId}>
        <input
          id={inputId}
          className="checkbox-input"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          name={name}
          required={required}
          onChange={event => onCheckedChange(event.target.checked)}
        />
        <span className="checkbox-box" aria-hidden="true">
          <Check className="checkbox-check" size={14} strokeWidth={3} />
        </span>
        <span className="checkbox-label">{label}</span>
      </label>
      {hint !== undefined && hint !== null && hint !== '' && <span className="checkbox-hint">{hint}</span>}
    </div>
  );
}
