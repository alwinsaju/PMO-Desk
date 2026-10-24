"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/cn";

/** 46x28 track, 22px thumb that springs across. Track is `chip-strong` when
 *  off, `accent` when on (so Deloitte mode flips it to green/neon). */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "rounded-pill bg-chip-strong relative h-7 w-[46px] shrink-0 outline-none",
      "transition-[background-color] duration-[350ms]",
      "data-[state=checked]:bg-accent",
      "focus-visible:ring-focus focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-40",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "block h-[22px] w-[22px] translate-x-[3px] rounded-full bg-white",
        "shadow-[0_2px_6px_rgba(0,0,0,0.28)]",
        "ease-spring transition-transform duration-[450ms]",
        "data-[state=checked]:translate-x-[21px]",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
