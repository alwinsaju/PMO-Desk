"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "rounded-control border-border bg-surface-elevated text-ink h-10 w-full border px-3.5 text-sm",
          "placeholder:text-ink-faint",
          "ease-standard transition-[border-color,box-shadow] duration-150",
          "focus-visible:border-accent focus-visible:ring-accent/30 focus-visible:ring-2 focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
