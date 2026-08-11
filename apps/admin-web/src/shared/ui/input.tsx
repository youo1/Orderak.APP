import * as React from 'react';
import { cn } from '@/shared/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn('flex h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-50', className)} {...props} />
));
Input.displayName = 'Input';
