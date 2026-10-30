// Run with `pnpm test`. The policy next.config.mjs sends on every page.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContentSecurityPolicy } from "./csp.mjs";

describe("buildContentSecurityPolicy", () => {
  it("has no bracketed IPv6 source (browsers reject it and warn on every load)", () => {
    for (const dev of [true, false]) {
      assert.doesNotMatch(buildContentSecurityPolicy({ dev }), /\[|\]/);
    }
  });

  it("still lets the page call the engine and the model on loopback", () => {
    const policy = buildContentSecurityPolicy({ dev: false });
    assert.match(
      policy,
      /connect-src 'self' http:\/\/127\.0\.0\.1:\* http:\/\/localhost:\*/,
    );
  });

  it("allows eval and websockets only in development", () => {
    const dev = buildContentSecurityPolicy({ dev: true });
    const prod = buildContentSecurityPolicy({ dev: false });
    assert.match(dev, /'unsafe-eval'/);
    assert.match(dev, /ws:\/\/127\.0\.0\.1:\*/);
    assert.doesNotMatch(prod, /'unsafe-eval'/);
    assert.doesNotMatch(prod, /ws:\/\//);
  });

  it("keeps the framing and plugin protections", () => {
    const policy = buildContentSecurityPolicy({ dev: false });
    for (const directive of [
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ]) {
      assert.ok(policy.includes(directive), directive);
    }
  });
});
