"use client";

import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/cn";

export interface ScrollAreaProps extends React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.Root
> {
  viewportClassName?: string;
  orientation?: "vertical" | "horizontal" | "both";
}

export const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(
  (
    { className, viewportClassName, orientation = "vertical", children, ...props },
    ref,
  ) => (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className={cn("h-full w-full", viewportClassName)}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      {(orientation === "vertical" || orientation === "both") && (
        <ScrollAreaPrimitive.Scrollbar
          orientation="vertical"
          className="flex w-2.5 touch-none p-0.5 select-none"
        >
          <ScrollAreaPrimitive.Thumb className="rounded-pill bg-ink-faint/45 hover:bg-ink-faint/70 relative flex-1 transition-colors duration-200" />
        </ScrollAreaPrimitive.Scrollbar>
      )}
      {(orientation === "horizontal" || orientation === "both") && (
        <ScrollAreaPrimitive.Scrollbar
          orientation="horizontal"
          className="flex h-2.5 touch-none p-0.5 select-none"
        >
          <ScrollAreaPrimitive.Thumb className="rounded-pill bg-ink-faint/45 hover:bg-ink-faint/70 relative flex-1 transition-colors duration-200" />
        </ScrollAreaPrimitive.Scrollbar>
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  ),
);
ScrollArea.displayName = "ScrollArea";
