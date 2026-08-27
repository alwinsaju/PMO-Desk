"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/cn";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "rounded-pill relative h-6 w-10 shrink-0 bg-neutral-200 outline-none",
      "ease-standard transition-colors duration-150",
      "data-[state=checked]:bg-accent",
      "focus-visible:ring-accent focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-40",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "shadow-float-sm block h-[18px] w-[18px] translate-x-[3px] rounded-full bg-white",
        "ease-standard transition-transform duration-150",
        "data-[state=checked]:translate-x-[19px]",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
