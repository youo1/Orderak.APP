import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';
import { cn } from '@/shared/lib/utils';

export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>>(({ className, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, ...props }, ref) => (
  <SliderPrimitive.Root ref={ref} className={cn('relative flex w-full touch-none select-none items-center', className)} {...props}>
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-[var(--line)]">
      <SliderPrimitive.Range className="absolute h-full bg-[var(--primary)]" />
    </SliderPrimitive.Track>
    {/* Radix puts `aria-label` on the thumb, which is the focusable `role="slider"`,
        but a single-value slider has no default name. Carry the caller's label
        through to it rather than leaving the control unnamed. */}
    {/* `size-6` is the 24 CSS-pixel minimum WCAG 2.5.8 asks of a pointer
        target; the 20px (`size-5`) thumb this replaced was undersized. The
        thumb grows 4px overall and the track is unchanged. */}
    <SliderPrimitive.Thumb aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} className="block size-6 rounded-full border-2 border-[var(--primary)] bg-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;
