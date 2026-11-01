import {
  FileIcon,
  FileTextIcon,
  FileXlsIcon,
  BracketsCurlyIcon,
} from "@phosphor-icons/react";
import type { FileKind } from "./inputChecklist";

const ICONS: Record<FileKind, typeof FileIcon> = {
  spreadsheet: FileXlsIcon,
  document: FileTextIcon,
  data: BracketsCurlyIcon,
  file: FileIcon,
};

export function FileKindIcon({ kind, size = 16 }: { kind: FileKind; size?: number }) {
  const Icon = ICONS[kind];
  return <Icon size={size} weight="bold" aria-hidden />;
}
