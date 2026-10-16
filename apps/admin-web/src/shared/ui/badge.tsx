import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/utils';

// py-1, not py-0.5: Cairo's text box (about 1.9em) is taller than the 16px line of
// text-xs. With 2px padding it stuck out of the badge's own background, so axe could
// not tell what the text sits on and reported its contrast as unmeasurable (B4).
export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-medium text-[var(--primary)]', className)} {...props} />;
}
