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
          className="ease-standard flex w-2.5 touch-none p-0.5 transition-colors duration-150 select-none"
        >
          <ScrollAreaPrimitive.Thumb className="rounded-pill relative flex-1 bg-neutral-300 hover:bg-neutral-400" />
        </ScrollAreaPrimitive.Scrollbar>
      )}
      {(orientation === "horizontal" || orientation === "both") && (
        <ScrollAreaPrimitive.Scrollbar
          orientation="horizontal"
          className="ease-standard flex h-2.5 touch-none p-0.5 transition-colors duration-150 select-none"
        >
          <ScrollAreaPrimitive.Thumb className="rounded-pill relative flex-1 bg-neutral-300 hover:bg-neutral-400" />
        </ScrollAreaPrimitive.Scrollbar>
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  ),
);
ScrollArea.displayName = "ScrollArea";
