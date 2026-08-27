"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/cn";

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none items-center select-none",
      "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="rounded-pill bg-neutral-150 relative h-1.5 grow data-[orientation=vertical]:w-1.5">
      <SliderPrimitive.Range className="rounded-pill bg-accent absolute h-full data-[orientation=vertical]:w-full" />
    </SliderPrimitive.Track>
    {/* One Thumb per value in `value`/`defaultValue` (Radix requires the
        caller's value array length to match the number of thumbs rendered;
        a single-value slider only needs the default one below — pass
        children to override for a range slider with 2+ thumbs). */}
    {props.children ?? (
      <SliderPrimitive.Thumb
        className={cn(
          "border-accent shadow-float-sm block h-[18px] w-[18px] rounded-full border-2 bg-white",
          "ease-standard transition-transform duration-150",
          "focus-visible:ring-accent hover:scale-110 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      />
    )}
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";
