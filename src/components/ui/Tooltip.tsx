"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";
import { overlayEnter, overlayExit } from "@/lib/motion";
import { useCloseOnModalOpen } from "./useCloseOnModalOpen";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipTrigger = TooltipPrimitive.Trigger;

/** Radix Tooltip root that also closes when a modal dialog opens (QA-15), so a
 *  tooltip left open by the click that opened the dialog never stays on top of it. */
export function TooltipRoot({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: TooltipPrimitive.TooltipProps) {
  const [innerOpen, setInnerOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const change = (next: boolean) => {
    if (!isControlled) setInnerOpen(next);
    onOpenChange?.(next);
  };
  useCloseOnModalOpen(() => change(false));
  return (
    <TooltipPrimitive.Root
      {...props}
      open={isControlled ? open : innerOpen}
      onOpenChange={change}
    />
  );
}

export type TooltipContentProps = React.ComponentPropsWithoutRef<
  typeof TooltipPrimitive.Content
>;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, sideOffset = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "bg-ink shadow-float-sm text-ink-inverse z-[var(--z-overlay)] rounded-md px-2.5 py-1.5 text-[12px] font-medium",
        "origin-[var(--radix-tooltip-content-transform-origin)]",
        overlayEnter,
        overlayExit,
        className,
      )}
      {...props}
    >
      {props.children}
      <TooltipPrimitive.Arrow className="fill-ink" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";

/** Convenience wrapper for the common case: hover a trigger, see a label.
 *  For anything more custom, compose TooltipRoot/TooltipTrigger/TooltipContent
 *  directly. Remember to render one `<TooltipProvider>` near the app root
 *  (Desktop.tsx) — Radix Tooltip requires it. */
export function Tooltip({
  children,
  label,
  ...contentProps
}: {
  children: React.ReactNode;
  label: React.ReactNode;
} & Omit<TooltipContentProps, "children">) {
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent {...contentProps}>{label}</TooltipContent>
    </TooltipRoot>
  );
}
