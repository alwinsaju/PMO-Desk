"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { overlayEnter, overlayExit } from "@/lib/motion";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "bg-ink/40 fixed inset-0 z-[var(--z-overlay)] backdrop-blur-[2px]",
      overlayEnter,
      overlayExit,
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

export interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Hide the default top-right close button (e.g. for a custom footer action). */
  hideClose?: boolean;
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideClose = false, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    {/* Centering is done with flex on this wrapper (not a top/left + -50%
        transform trick) because the open/close keyframes below animate
        `transform` directly on Content — a transform-based centering trick
        on the same element would get clobbered by the keyframe. */}
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center p-4">
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "bg-surface-elevated shadow-float-lg relative w-full max-w-md rounded-2xl p-6",
          "focus:outline-none",
          overlayEnter,
          overlayExit,
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            className={cn(
              "text-ink-faint absolute top-4 right-4 flex h-7 w-7 items-center justify-center rounded-full",
              "ease-standard hover:text-ink transition-colors duration-150 hover:bg-neutral-100",
              "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            <XIcon size={14} weight="bold" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </div>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-ink pr-6 text-base font-semibold tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-ink-muted mt-1.5 text-sm", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}
