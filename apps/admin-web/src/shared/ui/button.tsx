import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[var(--primary)] text-white hover:bg-[var(--primary-strong)]',
        outline: 'border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--primary-soft)]',
        destructive: 'bg-[var(--danger)] text-white',
        ghost: 'text-[var(--ink)] hover:bg-[var(--primary-soft)]',
      },
      size: { default: 'h-10', sm: 'h-9 px-3', lg: 'h-12 px-6' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
