"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";
import { tabContentEnter } from "@/lib/motion";

export const Tabs = TabsPrimitive.Root;

/** The segmented-control track (`chip` fill, 4px inset). */
export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "rounded-seg bg-chip relative inline-flex shrink-0 items-center gap-0.5 p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export interface TabsTriggerProps extends React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Trigger
> {
  /** Optional count bubble after the label (e.g. unread / queue length). It
   *  tints to the accent while its tab is active. `0` still renders. */
  count?: number | string;
}

/** One segment: 32px tall, the active one sits on a `field` plate. */
export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, children, count, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "group rounded-seg-item text-ink-muted relative inline-flex h-8 shrink-0 items-center gap-[7px] px-4 text-[13.5px] font-semibold whitespace-nowrap outline-none",
      "transition-[color,background-color,box-shadow] duration-[250ms]",
      "hover:text-ink",
      "data-[state=active]:bg-field data-[state=active]:text-ink data-[state=active]:shadow-[0_2px_8px_rgba(30,30,60,0.12)]",
      "focus-ring",
      "disabled:pointer-events-none disabled:opacity-[var(--opacity-disabled)]",
      className,
    )}
    {...props}
  >
    {children}
    {count !== undefined && (
      <span
        className={cn(
          "bg-chip-strong inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11.5px] leading-none",
          "group-data-[state=active]:bg-accent-soft group-data-[state=active]:text-accent-ink",
        )}
      >
        {count}
      </span>
    )}
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("focus-ring", tabContentEnter, className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
