// The desktop launcher (desktop/launcher.cjs) builds the UI for the installed
// app out of this folder. It sets:
//   AI_OS_DIST_DIR   build output folder (default ".next"); lets the launcher
//                    build into a staging folder and swap it in only when the
//                    build succeeded, so a failed build never costs the last
//                    good one, and `next dev` / `pnpm build` keep using .next.
//   AI_OS_FAST_BUILD "1" skips lint and the type-check pass (they take most of
//                    a build and `pnpm typecheck` / `pnpm lint` cover them).
const distDir = process.env.AI_OS_DIST_DIR?.trim();
const fast = process.env.AI_OS_FAST_BUILD === "1";
const dev = process.env.NODE_ENV !== "production";

// The app is served on loopback only. Inline script/style are needed by Next's
// hydration data and the app's own inline styles; the Browser app embeds
// arbitrary sites, so frame-src is deliberately open. The engine is called
// straight from the page on a loopback port picked at launch.
const LOOPBACK_HTTP = "http://127.0.0.1:* http://localhost:* http://[::1]:*";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${LOOPBACK_HTTP}${dev ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src * data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Origin only to other sites (some embeds, e.g. video players, refuse a missing referrer).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  ...(distDir ? { distDir } : {}),
  ...(fast
    ? { typescript: { ignoreBuildErrors: true }, eslint: { ignoreDuringBuilds: true } }
    : {}),
  // Nothing uses the image optimizer; turning it off removes its attack surface.
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
