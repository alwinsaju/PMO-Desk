"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface MockLinkProps {
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * A styled `<button>` standing in for an `<a>` inside a mock page — real
 * anchor semantics would be misleading here since nothing behind it is an
 * actual navigable URL. Every mock page (HomePage/WikiPage/AboutPage) uses
 * this for its internal "links", calling back up to BrowserApp.tsx's
 * `navigate` so back/forward stay in sync with clicks inside the page, not
 * just the address-bar chrome. The underline carries the "this is a link"
 * affordance (accent text alone fails contrast in Deloitte-light).
 */
export function MockLink({ onClick, children, className }: MockLinkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-accent-ink decoration-accent-ink/40 hover:decoration-accent-ink rounded-sm font-medium",
        "ease-smooth cursor-pointer underline underline-offset-[3px] transition-colors duration-200",
        className,
      )}
    >
      {children}
    </button>
  );
}
