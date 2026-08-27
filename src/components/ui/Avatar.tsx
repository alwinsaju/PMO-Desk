"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/cn";

export type AvatarSize = "sm" | "md" | "lg";
/** "active" draws the accent ring reserved for presence indicators (see the
 *  design spec: the ONE accent color is used for, among other things,
 *  "presence-indicator active rings"). Intended for the AI Agent Layer's
 *  corner presence avatars, but usable anywhere an avatar needs to signal
 *  "currently active." */
export type AvatarPresence = "none" | "active" | "idle";

const sizeClassName: Record<AvatarSize, string> = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-[13px]",
  lg: "h-12 w-12 text-base",
};

const presenceClassName: Record<AvatarPresence, string> = {
  none: "",
  active: "ring-2 ring-accent ring-offset-2 ring-offset-surface",
  idle: "ring-2 ring-neutral-300 ring-offset-2 ring-offset-surface",
};

export interface AvatarProps extends React.ComponentPropsWithoutRef<
  typeof AvatarPrimitive.Root
> {
  src?: string;
  alt?: string;
  /** Shown while `src` is missing/broken. Usually initials. */
  fallback: React.ReactNode;
  size?: AvatarSize;
  presence?: AvatarPresence;
}

export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  (
    { className, src, alt = "", fallback, size = "md", presence = "none", ...props },
    ref,
  ) => (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        "text-ink-muted relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200 font-medium",
        sizeClassName[size],
        presenceClassName[presence],
        className,
      )}
      {...props}
    >
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center"
        delayMs={src ? 400 : 0}
      >
        {fallback}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  ),
);
Avatar.displayName = "Avatar";
