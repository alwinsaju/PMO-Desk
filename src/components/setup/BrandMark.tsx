"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import type { BrandId } from "./firstTimeSteps";

/**
 * Simplified marks for the apps, models and tools the setup page talks about, drawn here
 * as small SVGs in each product's colours (no images are downloaded or shipped). They
 * are recognisable stand-ins for the setup screens, not the official logo files.
 */
export function BrandMark({
  brand,
  size = 48,
  className,
}: {
  brand: BrandId;
  size?: number;
  className?: string;
}) {
  const uid = useId().replace(/[^a-z0-9]/gi, "");
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 48 48",
    role: "img" as const,
    className: cn("shrink-0", className),
  };

  switch (brand) {
    case "ollama":
      return (
        <svg {...common} aria-label="Ollama">
          <rect
            x="11"
            y="3"
            width="8"
            height="17"
            rx="4"
            fill="#fff"
            stroke="#111"
            strokeWidth="2.4"
          />
          <rect
            x="29"
            y="3"
            width="8"
            height="17"
            rx="4"
            fill="#fff"
            stroke="#111"
            strokeWidth="2.4"
          />
          <path
            d="M10 27c0-8 6-13 14-13s14 5 14 13c0 9-6 17-14 17S10 36 10 27z"
            fill="#fff"
            stroke="#111"
            strokeWidth="2.4"
          />
          <ellipse
            cx="24"
            cy="33"
            rx="6.5"
            ry="5"
            fill="#f1ebe3"
            stroke="#111"
            strokeWidth="2"
          />
          <ellipse cx="24" cy="31.5" rx="2.2" ry="1.6" fill="#111" />
          <circle cx="17.5" cy="25" r="1.9" fill="#111" />
          <circle cx="30.5" cy="25" r="1.9" fill="#111" />
        </svg>
      );
    case "gemma":
      return (
        <svg {...common} aria-label="Gemma">
          <defs>
            <linearGradient id={`g${uid}`} x1="6" y1="6" x2="42" y2="42">
              <stop offset="0" stopColor="#4285f4" />
              <stop offset="0.55" stopColor="#9b72cb" />
              <stop offset="1" stopColor="#d96570" />
            </linearGradient>
          </defs>
          <path
            d="M24 3c1.5 12 8 19.500 21 21-13 1.500-19.500 9-21 21-1.500-12-8-19.500-21-21C16 22.500 22.500 15 24 3z"
            fill={`url(#g${uid})`}
          />
        </svg>
      );
    case "python":
      return (
        <svg {...common} aria-label="Python">
          <path
            d="M23.800 4C15 4 15.600 7.800 15.600 7.800v4h8.400v1.200H11.700S6 12.400 6 21.200s5 8.500 5 8.500h3v-4.100s-.2-5 4.900-5h8.500s4.800.1 4.800-4.600V9s.7-5-8.400-5z"
            fill="#3776ab"
          />
          <path
            d="M24.200 44c8.800 0 8.200-3.800 8.200-3.800v-4h-8.400v-1.200h12.300S42 35.600 42 26.800s-5-8.500-5-8.500h-3v4.100s.2 5-4.900 5h-8.500s-4.800-.1-4.800 4.600V39s-.7 5 8.400 5z"
            fill="#ffd43b"
          />
          <circle cx="19.500" cy="8.800" r="1.600" fill="#fff" />
          <circle cx="28.500" cy="39.200" r="1.600" fill="#fff" />
        </svg>
      );
    case "onedrive":
      return (
        <svg {...common} aria-label="OneDrive">
          <defs>
            <linearGradient id={`o${uid}`} x1="6" y1="34" x2="44" y2="14">
              <stop offset="0" stopColor="#0364b8" />
              <stop offset="1" stopColor="#28a8ea" />
            </linearGradient>
          </defs>
          <path
            d="M14 36a9 9 0 0 1-1.200-17.900A11.500 11.500 0 0 1 34 15.500 8.500 8.500 0 0 1 36 36z"
            fill={`url(#o${uid})`}
          />
          <path
            d="M24 24.500a8 8 0 0 1 11-3.200 6.500 6.500 0 0 1 8.500 5.700 6 6 0 0 1-2 9H20a6.500 6.500 0 0 1 4-11.500z"
            fill="#0f78d4"
            opacity="0.92"
          />
        </svg>
      );
    case "powerautomate":
      return (
        <svg {...common} aria-label="Power Automate">
          <defs>
            <linearGradient id={`p${uid}`} x1="6" y1="8" x2="42" y2="40">
              <stop offset="0" stopColor="#0066ff" />
              <stop offset="1" stopColor="#7a3cf0" />
            </linearGradient>
          </defs>
          <path d="M7 8h15l19 16-19 16H7l17-16z" fill={`url(#p${uid})`} />
          <path d="M7 8h15l-8 6.800z" fill="#fff" opacity="0.28" />
        </svg>
      );
    case "teams":
      return (
        <svg {...common} aria-label="Microsoft Teams">
          <circle cx="35" cy="12" r="5" fill="#7b83eb" />
          <rect x="26" y="19" width="19" height="17" rx="5" fill="#7b83eb" />
          <circle cx="22" cy="13" r="7" fill="#5059c9" />
          <rect x="5" y="19" width="30" height="24" rx="4" fill="#4f52b2" />
          <path
            d="M13 26h14M20 26v11"
            fill="none"
            stroke="#fff"
            strokeWidth="3.200"
            strokeLinecap="round"
          />
        </svg>
      );
    case "outlook":
      return (
        <svg {...common} aria-label="Outlook">
          <rect x="17" y="12" width="26" height="24" rx="3" fill="#50a0e6" />
          <path
            d="M17 15l13 9 13-9"
            fill="none"
            stroke="#fff"
            strokeWidth="2.200"
            strokeLinejoin="round"
          />
          <rect x="4" y="9" width="24" height="30" rx="4" fill="#0f6cbd" />
          <ellipse
            cx="16"
            cy="24"
            rx="5.500"
            ry="7"
            fill="none"
            stroke="#fff"
            strokeWidth="3"
          />
        </svg>
      );
    case "aios":
    default:
      return (
        <svg {...common} aria-label="AI OS">
          <defs>
            <linearGradient id={`a${uid}`} x1="4" y1="4" x2="44" y2="44">
              <stop offset="0" stopColor="var(--color-accent)" />
              <stop offset="1" stopColor="var(--color-accent-600, var(--color-accent))" />
            </linearGradient>
          </defs>
          <rect x="4" y="4" width="40" height="40" rx="12" fill={`url(#a${uid})`} />
          <path
            d="M24 12c.9 7 5 11.100 12 12-7 .9-11.100 5-12 12-.9-7-5-11.100-12-12 7-.9 11.100-5 12-12z"
            fill="var(--color-accent-contrast)"
          />
        </svg>
      );
  }
}

/** A mark on a soft round tile, the way the setup page shows each tool. */
export function BrandTile({
  brand,
  size = 56,
  className,
}: {
  brand: BrandId;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-card border-line grid shrink-0 place-items-center rounded-2xl border shadow-[0_6px_24px_rgba(20,24,40,0.10)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <BrandMark brand={brand} size={Math.round(size * 0.62)} />
    </span>
  );
}
