"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "rounded-pill inline-flex items-center gap-0.5 bg-neutral-100 p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "rounded-pill text-ink-muted px-3.5 py-1.5 text-[13px] font-medium outline-none",
      "ease-standard transition-colors duration-150",
      "hover:text-ink",
      "data-[state=active]:bg-surface-elevated data-[state=active]:text-ink data-[state=active]:shadow-float-sm",
      "focus-visible:ring-accent focus-visible:ring-2",
      "disabled:pointer-events-none disabled:opacity-40",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "focus-visible:ring-accent outline-none focus-visible:ring-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
