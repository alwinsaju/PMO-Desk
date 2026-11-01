"use client";

import { useState } from "react";
import { BracketsCurlyIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import type { PlaceholderDef } from "@/lib/templates/targets";
import { filterPlaceholders } from "./templateForm";

/** "Insert value": a searchable list of the values this template can use, with what each means and an
 *  example. Picking one puts `{{name}}` at the caret of the message. */
export function PlaceholderPalette({
  tokens,
  onPick,
}: {
  tokens: readonly PlaceholderDef[];
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const found = filterPlaceholders(tokens, query);

  const pick = (name: string) => {
    onPick(name);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" data-testid="placeholder-palette">
          <BracketsCurlyIcon size={14} weight="bold" aria-hidden />
          Insert value
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-80 max-w-[90vw] flex-col gap-2 p-3"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="relative">
          <MagnifyingGlassIcon
            size={14}
            aria-hidden
            className="text-ink-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          />
          <Input
            {...noSpellcheck}
            aria-label="Search values"
            placeholder="Search values"
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && found[0]) {
                e.preventDefault();
                pick(found[0].name);
              }
            }}
          />
        </div>
        {found.length === 0 ? (
          <p className="text-ink-muted px-1 py-3 text-center text-[12.5px]">
            No value matches “{query.trim()}”.
          </p>
        ) : (
          <ul
            aria-label="Values"
            className="scroll-thin -mx-1 flex max-h-64 flex-col overflow-y-auto px-1"
          >
            {found.map((token) => (
              <li key={token.name}>
                <button
                  type="button"
                  onClick={() => pick(token.name)}
                  className="hover:bg-chip focus-visible:ring-focus rounded-control flex w-full flex-col gap-0.5 px-2.5 py-2 text-left outline-none focus-visible:ring-2"
                >
                  <code className="text-accent-ink text-[12.5px] font-semibold">{`{{${token.name}}}`}</code>
                  <span className="text-ink-soft text-[12px]">{token.description}</span>
                  <span className="text-ink-muted truncate text-[11.5px]">
                    e.g. {token.sample.split("\n")[0]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
