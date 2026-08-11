import { cn } from '@/shared/lib/utils';

export function Separator({ className, orientation = 'horizontal' }: { className?: string; orientation?: 'horizontal' | 'vertical' }) {
  return <div aria-hidden className={cn('shrink-0 bg-[var(--line)]', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)} />;
}
