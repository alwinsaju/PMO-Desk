// The Content-Security-Policy, kept in a plain module so next.config.mjs can import it
// and a test can check it. The app is served on loopback only. Inline script/style are
// needed by Next's hydration data and the app's own inline styles; the Browser app embeds
// arbitrary sites, so frame-src is deliberately open. The Tasks engine listens on
// 127.0.0.1 only and is called straight from the page on a port picked at launch.
// Do not add an IPv6 literal such as http://[::1]:*: CSP host-sources do not accept
// brackets, so it is dropped with a console warning on every page load.
export const LOOPBACK_HTTP = "http://127.0.0.1:* http://localhost:*";

export function buildContentSecurityPolicy({ dev }) {
  return [
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
}
