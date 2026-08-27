import type { Metadata } from "next";
import { Figtree, IBM_Plex_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/Tooltip";
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

export const metadata: Metadata = {
  title: "AI OS",
  description:
    "A browser-based AI operating system — a virtual desktop where a human and an AI agent can both drive the same windows and apps.",
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
    <html lang="en" className={`${figtree.variable} ${ibmPlexMono.variable}`}>
      <body className="antialiased">
        {/* Global provider: Radix's Tooltip.Root works without this, but a
            single app-wide Provider is the recommended setup — it lets any
            later phase share one delayDuration/skipDelayDuration config
            instead of every tooltip user having to remember to add it. */}
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
