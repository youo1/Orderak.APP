import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';
import { cn } from '@/shared/lib/utils';

export const Tabs = TabsPrimitive.Root;
export const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('inline-flex min-h-10 flex-wrap items-center rounded-lg bg-[var(--primary-soft)] p-1 text-[var(--muted)]', className)} {...props} />
));
TabsList.displayName = TabsPrimitive.List.displayName;
export const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn('inline-flex min-h-8 items-center justify-center rounded-md px-3 text-xs font-medium data-[state=active]:bg-[var(--surface)] data-[state=active]:text-[var(--ink)] data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]', className)} {...props} />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;
export const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]', className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
