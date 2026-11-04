"use client";

import { QuestionIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { cn } from "@/lib/cn";
import { helpFor } from "@/lib/platform/appHelp";
import { AppHelpContent } from "./AppHelpContent";

/** Help for the app in this window: its summary and three common tasks, from the same static
 *  text as Settings > Help. Renders nothing for an app without an entry. Rests invisible like
 *  minimize / maximize and shows while the window is hovered, focused or this button has focus. */
export function WindowHelpButton({ appId }: { appId: string }) {
  const help = helpFor(appId);
  if (!help) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          shape="round"
          aria-label={`Help for ${help.title}`}
          title="Help"
          tooltip={false}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "text-ink-muted hover:text-ink",
            "ease-spring transition-[opacity,background-color,color,transform] duration-300",
            "active:scale-95",
            "opacity-0 group-hover/win:opacity-100 group-data-[focused=true]/win:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          <QuestionIcon weight="bold" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="scroll-thin max-h-[min(28rem,70vh)] w-[min(22rem,calc(100vw-3rem))] overflow-y-auto"
      >
        <p className="text-ink mb-1.5 text-[14px] font-semibold">{help.title} help</p>
        <AppHelpContent help={help} />
      </PopoverContent>
    </Popover>
  );
}
