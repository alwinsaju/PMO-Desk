"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { dialogEnter, dialogExit } from "@/lib/motion";

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
      // Tinted + blurred scrim (the `scrim` utility). The blur is a
      // full-viewport backdrop-filter that repaints with whatever is behind
      // it, so its strength is a single knob: `--scrim-blur` in tokens.css
      // (set it to 0px on a GPU-poor machine and only the tint remains).
      "scrim fixed inset-0 z-[var(--z-overlay)]",
      "data-[state=open]:[animation:scrim-in_350ms_var(--ease-smooth)_forwards]",
      "data-[state=closed]:[animation:scrim-out_250ms_var(--ease-exit)_forwards]",
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
          "glass-pop shadow-modal rounded-surface pointer-events-auto relative w-full max-w-md p-7",
          "focus:outline-none",
          dialogEnter,
          dialogExit,
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            className={cn(
              "text-ink-muted absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full",
              "transition-ui hover:text-ink hover:bg-chip-strong hover:rotate-90",
              "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            <XIcon size={16} weight="bold" />
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
    className={cn(
      "text-ink pr-9 text-[22px] leading-tight font-bold tracking-tight",
      className,
    )}
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
