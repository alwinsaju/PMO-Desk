import type { Metadata } from "next";
import { Figtree, IBM_Plex_Mono, Open_Sans } from "next/font/google";
import Script from "next/script";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { GlobalSpotlight } from "@/components/ui/GlobalSpotlight";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { getFxInitScript } from "@/lib/displayFx";
import { getThemeInitScript } from "@/lib/theme";
import "./globals.css";

// Figtree is used as a true variable font (no `weight` list) so every
// Tailwind font-weight utility — font-medium, font-semibold, etc. — has a
// real matching weight to render instead of the browser faking it.
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

// IBM Plex Mono ships as static weights on Google Fonts (no variable axis),
// so the weights actually used need to be listed explicitly. Reserved for
// technical/file-path text in later phases (e.g. the files app).
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

// Open Sans is the Deloitte-mode typeface (`data-brand="deloitte"` swaps
// `--font-sans` to it in tokens.css). Variable font, so weight 300 (the
// brand's light display weight) through 700 all have real masters. It is only
// ever *referenced* under the brand attribute, so default-mode users pay for
// the preload hint but never render a glyph in it.
const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-open-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI OS",
  description:
    "A browser-based AI operating system — a virtual desktop where a human and an AI agent can both drive the same windows and apps.",
  applicationName: "AI OS",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AI OS",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variable classes go on <html> (i.e. :root), not <body>.
    // tokens.css's `--font-sans` resolves `var(--font-figtree)` on :root —
    // if `--font-figtree` were only defined lower down on <body>, that
    // resolution would fail there (a custom property's value is resolved
    // against its OWN element's scope, then that resolved value — invalid,
    // in that case — is what gets inherited downward) and every element
    // would silently fall back to Tailwind's default font stack.
    //
    // suppressHydrationWarning is scoped to this one element's own
    // attributes (it does not suppress hydration warnings for anything
    // below it) and is needed because of the theme-init script below: it
    // sets data-theme="dark" and/or data-brand="deloitte" directly on this
    // DOM node before React hydrates, which otherwise makes React log a
    // hydration mismatch for attributes that are supposed to differ on
    // purpose. See src/lib/theme.ts.
    <html
      lang="en"
      className={`${figtree.variable} ${ibmPlexMono.variable} ${openSans.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        {/* Sets data-theme="dark" and data-brand="deloitte" on <html> (see
            tokens.css) before hydration if the user previously chose them
            (src/lib/theme.ts), so a returning dark-mode / Deloitte-mode user
            never sees a flash of the default look first. `beforeInteractive` is what guarantees
            this runs ahead of hydration regardless of where in the tree
            it's placed; next/script requires an `id` for inline scripts
            using that strategy. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {getThemeInitScript() + getFxInitScript()}
        </Script>
        <ServiceWorkerRegistration />
        {/* One document-level listener that feeds the cursor position to any
            element carrying the `spot` class (see globals.css). */}
        <GlobalSpotlight />
        {/* Global provider: Radix's Tooltip.Root works without this, but a
            single app-wide Provider is the recommended setup — it lets any
            later phase share one delayDuration/skipDelayDuration config
            instead of every tooltip user having to remember to add it. */}
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
