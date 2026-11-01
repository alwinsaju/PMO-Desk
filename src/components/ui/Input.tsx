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
          "rounded-control border-line-strong bg-field text-ink h-9 w-full border px-3.5 text-sm",
          "placeholder:text-ink-muted",
          "transition-[border-color,box-shadow] duration-[250ms]",
          "focus-visible:border-focus focus-visible:shadow-field-focus focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-[var(--opacity-disabled)]",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
