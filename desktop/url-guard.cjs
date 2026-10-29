// Origin checks for the Electron shell (pure; no Electron imports). A URL is "the
// app" only when its scheme, host and port equal the UI server's: prefix checks
// such as startsWith(appUrl) accept http://127.0.0.1:3100.evil.test and
// http://127.0.0.1:31001.

/** Parsed http(s) URL, or undefined for garbage and every other scheme. */
function parseWebUrl(value) {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
}

/** True when `url` has exactly the origin of `appUrl`. */
function isAppUrl(url, appUrl) {
  const candidate = parseWebUrl(url);
  const app = parseWebUrl(appUrl);
  return Boolean(candidate && app && candidate.origin === app.origin);
}

/** Schemes the OS may be asked to open on the user's behalf (mailto: is the PMO
 *  "open as unsent mail draft" link, which only opens a compose window). */
function isSafeExternalUrl(url) {
  if (parseWebUrl(url)) {
    return true;
  }
  return typeof url === "string" && /^mailto:/i.test(url.trim());
}

/**
 * What to do with a navigation or window.open from the app window:
 *   "allow"    stays inside the app origin
 *   "external" hand to the OS browser / mail program
 *   "deny"     drop
 */
function classifyNavigation(url, appUrl) {
  if (isAppUrl(url, appUrl)) {
    return "allow";
  }
  return isSafeExternalUrl(url) ? "external" : "deny";
}

/** Browser permissions the app uses: PMO reminders and "Copy" buttons. */
const ALLOWED_PERMISSIONS = new Set(["notifications", "clipboard-sanitized-write"]);

/** Grant only the known permissions, only to the app's own origin. */
function isPermissionAllowed(permission, requestingUrl, appUrl) {
  return ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingUrl, appUrl);
}

module.exports = {
  ALLOWED_PERMISSIONS,
  classifyNavigation,
  isAppUrl,
  isPermissionAllowed,
  isSafeExternalUrl,
};
