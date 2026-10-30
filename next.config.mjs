import { buildContentSecurityPolicy } from "./src/lib/security/csp.mjs";

const dev = process.env.NODE_ENV !== "production";

// The policy itself (and why it looks the way it does) lives in the security lib.
const contentSecurityPolicy = buildContentSecurityPolicy({ dev });

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Origin only to other sites (some embeds, e.g. video players, refuse a missing referrer).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  // The dev-server "N" badge floats over the desktop shell's bottom-left corner.
  devIndicators: false,
  // Nothing uses the image optimizer; turning it off removes its attack surface.
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
