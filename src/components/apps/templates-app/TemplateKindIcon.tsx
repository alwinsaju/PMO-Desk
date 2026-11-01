import {
  BracketsCurlyIcon,
  EnvelopeSimpleIcon,
  FileTextIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { KIND_TONE } from "@/lib/templates/listView";
import { KIND_LABEL, type TemplateKind } from "@/lib/templates/types";

const ICONS = {
  email: EnvelopeSimpleIcon,
  report: FileTextIcon,
  snippet: BracketsCurlyIcon,
} as const;

const TONE_CLASS = {
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent-ink",
  warning: "bg-amber-soft text-amber",
} as const;

/** The type's icon on a tile in the type's colour (email blue, report green, snippet amber). */
export function TemplateKindIcon({
  kind,
  className,
}: {
  kind: TemplateKind;
  className?: string;
}) {
  const Icon = ICONS[kind];
  return (
    <span
      role="img"
      aria-label={KIND_LABEL[kind]}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]",
        TONE_CLASS[KIND_TONE[kind]],
        className,
      )}
    >
      <Icon size={16} weight="duotone" aria-hidden />
    </span>
  );
}
