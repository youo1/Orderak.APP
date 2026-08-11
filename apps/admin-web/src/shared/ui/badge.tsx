import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/utils';

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--primary-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--primary)]', className)} {...props} />;
}
