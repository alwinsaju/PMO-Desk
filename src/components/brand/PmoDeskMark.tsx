import { useId } from "react";

export type PmoDeskMarkVariant = "default" | "dark" | "mono";

/** At or below this size the full mark blurs, so a simplified drawing is used
 *  (public/brand/mark-small.svg): the tick is dropped and the shapes sit on a coarser grid. */
const SMALL_MAX = 24;

/**
 * The PMO Desk logo: a rounded tile holding a "P" made of a queue of fading pills (the
 * Review Queue) and a ring with a tick (the approval gate). Drawn inline from the approved
 * SVGs in public/brand so it follows no theme by accident: `default` is the teal tile
 * (light or dark pages), `dark` is the light tile for dark artwork, `mono` is a single
 * colour that follows `currentColor`.
 */
export function PmoDeskMark({
  size = 32,
  variant = "default",
  title = "PMO Desk",
  className,
}: {
  size?: number;
  variant?: PmoDeskMarkVariant;
  /** Accessible name; pass "" when a visible label sits next to the mark. */
  title?: string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const common = {
    viewBox: "0 0 64 64",
    width: size,
    height: size,
    className,
    ...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true }),
  } as const;

  if (variant === "mono") {
    return (
      <svg {...common}>
        <defs>
          <mask
            id={`m${uid}`}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="64"
            height="64"
          >
            <rect width="64" height="64" fill="#fff" />
            <g fill="none" stroke="#000" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="37" cy="27.5" r="11" strokeWidth="4.5" />
              <path d="M32.6 27.8l3.5 3.5 6.2-7.2" strokeWidth="3.6" />
            </g>
            <g fill="#000">
              <rect x="12.5" y="14" width="9" height="11" rx="4.5" />
              <rect x="12.5" y="27" width="9" height="11" rx="4.5" />
              <rect x="12.5" y="40" width="9" height="11" rx="4.5" />
            </g>
          </mask>
        </defs>
        <rect width="64" height="64" rx="18" fill="currentColor" mask={`url(#m${uid})`} />
      </svg>
    );
  }

  const dark = variant === "dark";
  const [from, to] = dark ? ["#a7ccc3", "#7daba1"] : ["#2f7367", "#1e4b44"];
  const ink = dark ? "#0f2723" : "#fff";

  if (size <= SMALL_MAX) {
    return (
      <svg {...common}>
        <defs>
          <linearGradient
            id={`g${uid}`}
            x1="8"
            y1="4"
            x2="56"
            y2="62"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill={`url(#g${uid})`} />
        <circle cx="40" cy="30" r="13" fill="none" stroke={ink} strokeWidth="6" />
        <g fill={ink}>
          <rect x="12" y="16" width="8" height="8" rx="4" />
          <rect x="12" y="28" width="8" height="8" rx="4" opacity=".75" />
          <rect x="12" y="40" width="8" height="8" rx="4" opacity=".5" />
        </g>
      </svg>
    );
  }

  return (
    <svg {...common}>
      <defs>
        <linearGradient
          id={`g${uid}`}
          x1="8"
          y1="4"
          x2="56"
          y2="62"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <linearGradient id={`s${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={dark ? 0.35 : 0.28} />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#g${uid})`} />
      <rect width="64" height="64" rx="18" fill={`url(#s${uid})`} />
      {!dark && (
        <rect
          x=".5"
          y=".5"
          width="63"
          height="63"
          rx="17.5"
          fill="none"
          stroke="#fff"
          strokeOpacity=".2"
        />
      )}
      <g fill="none" stroke={ink} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="37" cy="27.5" r="11" strokeWidth="4.5" />
        <path d="M32.6 27.8l3.5 3.5 6.2-7.2" strokeWidth="3.6" />
      </g>
      <g fill={ink}>
        <rect x="12.5" y="14" width="9" height="11" rx="4.5" />
        <rect x="12.5" y="27" width="9" height="11" rx="4.5" opacity=".7" />
        <rect x="12.5" y="40" width="9" height="11" rx="4.5" opacity=".42" />
      </g>
    </svg>
  );
}
