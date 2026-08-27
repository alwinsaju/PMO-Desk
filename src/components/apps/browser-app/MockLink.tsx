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
 * just the address-bar chrome.
 */
export function MockLink({ onClick, children, className }: MockLinkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-accent decoration-accent/40 hover:decoration-accent ease-standard cursor-pointer underline underline-offset-2 transition-colors duration-150",
        className,
      )}
    >
      {children}
    </button>
  );
}
