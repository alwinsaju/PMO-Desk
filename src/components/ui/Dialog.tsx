"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { dialogEnter, dialogExit } from "@/lib/motion";
import { announceModalOpened } from "./modalEvents";

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
      // Tinted scrim (the `scrim` utility). Its blur is a full-viewport
      // backdrop-filter that repaints with whatever is behind it, so it exists
      // only in the rich effects mode (`--scrim-blur` in tokens.css).
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

/** Rendered inside the portal, so it mounts exactly when the dialog opens: tells open
 *  tooltips and popovers to close (see useCloseOnModalOpen). */
function AnnounceModalOpen() {
  React.useEffect(() => announceModalOpened(), []);
  return null;
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideClose = false, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <AnnounceModalOpen />
    <DialogOverlay />
    {/* Centering is done with flex on this wrapper (not a top/left + -50%
        transform trick) because the open/close keyframes below animate
        `transform` directly on Content — a transform-based centering trick
        on the same element would get clobbered by the keyframe. */}
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center p-4">
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // Fully opaque (QA-05): page text must never show through a dialog. The one
          // dialog surface: elevated fill, hairline border, surface radius, modal shadow.
          "bg-surface-elevated border-line-strong shadow-modal rounded-surface border",
          "pointer-events-auto relative w-full max-w-md p-7",
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
              "transition-ui focus-ring hover:text-ink hover:bg-chip-strong hover:rotate-90",
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

/** Action row: secondary then primary on the right; a `destructive*` Button is pushed
 *  to the far left, away from them (see ButtonVariant in Button.tsx). */
export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-6 flex justify-end gap-2 [&>[data-variant^=destructive]]:mr-auto",
        className,
      )}
      {...props}
    />
  );
}
