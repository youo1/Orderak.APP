import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/utils';

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="alert" className={cn('rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm', className)} {...props} />;
}
export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('mb-1 font-semibold', className)} {...props} />;
}
export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <div className={cn('text-[var(--muted)]', className)} {...props} />;
}
