"use client";

import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { CaretRightIcon, CheckIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { overlayEnter, overlayExit } from "@/lib/motion";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;
export const ContextMenuSub = ContextMenuPrimitive.Sub;

const contentClassName = cn(
  "z-[var(--z-overlay)] min-w-[12rem] rounded-xl border border-border bg-surface-elevated p-1.5 shadow-float-sm",
  "origin-[var(--radix-popper-transform-origin)]",
  overlayEnter,
  overlayExit,
);

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(contentClassName, className)}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";

export const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent
      ref={ref}
      className={cn(contentClassName, className)}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuSubContent.displayName = "ContextMenuSubContent";

const itemClassName = cn(
  "flex cursor-default select-none items-center gap-2 rounded-control px-2.5 py-1.5 text-[13px] text-ink outline-none",
  "data-[highlighted]:bg-accent-subtle data-[highlighted]:text-accent-800",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
);

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(itemClassName, className)}
    {...props}
  />
));
ContextMenuItem.displayName = "ContextMenuItem";

export const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(itemClassName, "pl-2.5", className)}
    {...props}
  >
    <span className="text-accent flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <CheckIcon size={13} weight="bold" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
ContextMenuCheckboxItem.displayName = "ContextMenuCheckboxItem";

export const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(itemClassName, "pl-2.5", className)}
    {...props}
  >
    <span className="flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <span className="bg-accent block h-1.5 w-1.5 rounded-full" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = "ContextMenuRadioItem";

export const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(itemClassName, "justify-between", className)}
    {...props}
  >
    {children}
    <CaretRightIcon size={12} className="text-ink-faint" />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = "ContextMenuSubTrigger";

export const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      "text-ink-faint px-2.5 py-1.5 text-[11px] font-medium tracking-wide uppercase",
      className,
    )}
    {...props}
  />
));
ContextMenuLabel.displayName = "ContextMenuLabel";

export const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("bg-border my-1.5 h-px", className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";
