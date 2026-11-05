// Run with `pnpm test`. The SSRF rules behind /api/browser/check-embeddable.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_REDIRECTS,
  allowsFraming,
  checkEmbeddable,
  inspectEmbeddable,
  isCertificateError,
  isPrivateAddress,
  parseCheckableUrl,
  refusalReason,
} from "./embeddableCheck.ts";

const reply = (status, headers = {}) => new Response(null, { status, headers });

/** Resolver / fetch doubles; `calls` records every URL fetched. */
function deps({ dns = {}, pages = {} }) {
  const calls = [];
  return {
    calls,
    resolve: async (host) => {
      if (!(host in dns)) throw new Error("ENOTFOUND");
      return dns[host];
    },
    fetchHead: async (url) => {
      calls.push(url);
      const page = pages[url];
      if (!page) throw new Error("unexpected fetch " + url);
      return page;
    },
  };
}

describe("isPrivateAddress", () => {
  it("refuses private, loopback, link-local, CGNAT and reserved IPv4", () => {
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "100.127.255.254",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  it("allows public IPv4, including the edges of the private ranges", () => {
    for (const ip of [
      "8.8.8.8",
      "100.63.255.255",
      "100.128.0.1",
      "172.15.0.1",
      "172.32.0.1",
    ]) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });

  it("refuses loopback, unique-local, link-local and IPv4-embedding IPv6", () => {
    for (const ip of [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "[::1]",
      "64:ff9b::a00:1",
      "2002:7f00:1::1",
      "ff02::1",
    ]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
    assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
  });

  it("treats anything that is not an IP address as refused", () => {
    assert.equal(isPrivateAddress("example.com"), true);
    assert.equal(isPrivateAddress(""), true);
  });
});

describe("parseCheckableUrl", () => {
  it("accepts public http(s) URLs only", () => {
    assert.ok(parseCheckableUrl("https://example.com/a"));
    assert.ok(parseCheckableUrl("http://8.8.8.8/"));
    for (const bad of [
      "ftp://example.com",
      "file:///c:/x",
      "javascript:alert(1)",
      "not a url",
      "http://localhost:3000",
      "http://app.localhost",
      "http://127.0.0.1",
      "http://2130706433/", // decimal form of 127.0.0.1
      "http://0x7f.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://169.254.169.254/latest",
      "http://100.64.0.1/",
    ]) {
      assert.equal(parseCheckableUrl(bad), null, bad);
    }
  });
});

describe("allowsFraming", () => {
  it("is blocked by any X-Frame-Options or a restrictive frame-ancestors", () => {
    assert.equal(allowsFraming(new Headers()), true);
    assert.equal(allowsFraming(new Headers({ "x-frame-options": "SAMEORIGIN" })), false);
    assert.equal(
      allowsFraming(new Headers({ "content-security-policy": "frame-ancestors 'self'" })),
      false,
    );
    assert.equal(
      allowsFraming(
        new Headers({
          "content-security-policy": "default-src 'self'; frame-ancestors *",
        }),
      ),
      true,
    );
  });
});

describe("checkEmbeddable", () => {
  const url = (s) => new URL(s);

  it("is true for a public page that allows framing", async () => {
    const d = deps({
      dns: { "example.com": ["93.184.216.34"] },
      pages: { "https://example.com/": reply(200) },
    });
    assert.equal(await checkEmbeddable(url("https://example.com/"), d), true);
  });

  it("refuses a host that resolves to a private address, without fetching it", async () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.5",
      "169.254.169.254",
      "::ffff:192.168.0.1",
      "fd00::1",
    ]) {
      const d = deps({ dns: { "rebind.example": [address] }, pages: {} });
      assert.equal(
        await checkEmbeddable(url("http://rebind.example/"), d),
        false,
        address,
      );
      assert.deepEqual(d.calls, []);
    }
  });

  it("refuses when any one of several DNS answers is private", async () => {
    const d = deps({ dns: { "mixed.example": ["8.8.8.8", "10.0.0.1"] }, pages: {} });
    assert.equal(await checkEmbeddable(url("http://mixed.example/"), d), false);
    assert.deepEqual(d.calls, []);
  });

  it("fails closed when DNS fails or returns nothing", async () => {
    assert.equal(await checkEmbeddable(url("http://gone.example/"), deps({})), false);
    const empty = deps({ dns: { "empty.example": [] } });
    assert.equal(await checkEmbeddable(url("http://empty.example/"), empty), false);
  });

  it("follows redirects and re-validates every hop", async () => {
    const ok = deps({
      dns: { "a.example": ["8.8.8.8"], "b.example": ["8.8.4.4"] },
      pages: {
        "http://a.example/": reply(302, { location: "https://b.example/home" }),
        "https://b.example/home": reply(200),
      },
    });
    assert.equal(await checkEmbeddable(url("http://a.example/"), ok), true);
    assert.deepEqual(ok.calls, ["http://a.example/", "https://b.example/home"]);

    for (const location of [
      "http://127.0.0.1:3000/api/x",
      "http://localhost/",
      "http://169.254.169.254/latest",
      "http://internal.example/", // resolves to a private address
      "file:///etc/passwd",
    ]) {
      const bad = deps({
        dns: { "a.example": ["8.8.8.8"], "internal.example": ["10.1.1.1"] },
        pages: { "http://a.example/": reply(301, { location }) },
      });
      assert.equal(await checkEmbeddable(url("http://a.example/"), bad), false, location);
      assert.deepEqual(bad.calls, ["http://a.example/"], location);
    }
  });

  it("resolves relative redirects against the current URL", async () => {
    const d = deps({
      dns: { "a.example": ["8.8.8.8"] },
      pages: {
        "https://a.example/x": reply(307, { location: "/y" }),
        "https://a.example/y": reply(200),
      },
    });
    assert.equal(await checkEmbeddable(url("https://a.example/x"), d), true);
  });

  it("gives up after the redirect limit, and on a redirect without Location", async () => {
    const loop = deps({
      dns: { "loop.example": ["8.8.8.8"] },
      pages: { "http://loop.example/": reply(302, { location: "http://loop.example/" }) },
    });
    assert.equal(await checkEmbeddable(url("http://loop.example/"), loop), false);
    assert.equal(loop.calls.length, MAX_REDIRECTS + 1);

    const bare = deps({
      dns: { "a.example": ["8.8.8.8"] },
      pages: { "http://a.example/": reply(302) },
    });
    assert.equal(await checkEmbeddable(url("http://a.example/"), bare), false);
  });

  it("treats an HTTP error status as not embeddable", async () => {
    for (const status of [400, 403, 404, 405, 500, 503]) {
      const d = deps({
        dns: { "a.example": ["8.8.8.8"] },
        pages: { "http://a.example/": reply(status) },
      });
      assert.equal(
        await checkEmbeddable(url("http://a.example/"), d),
        false,
        String(status),
      );
    }
  });

  it("honours framing headers on the final page", async () => {
    const d = deps({
      dns: { "a.example": ["8.8.8.8"] },
      pages: { "http://a.example/": reply(200, { "x-frame-options": "DENY" }) },
    });
    assert.equal(await checkEmbeddable(url("http://a.example/"), d), false);
  });
});

describe("refusalReason", () => {
  it("is null for a checkable public address", () => {
    assert.equal(refusalReason("https://example.com/"), null);
  });

  it("names loopback, private-network and non-web addresses", () => {
    assert.match(refusalReason("http://127.0.0.1:1/"), /this computer/i);
    assert.match(refusalReason("http://localhost:3000"), /this computer/i);
    assert.match(refusalReason("http://[::1]/"), /this computer/i);
    assert.match(refusalReason("http://192.168.1.5/"), /private network/i);
    assert.match(refusalReason("http://169.254.169.254/"), /private network/i);
    assert.match(refusalReason("ftp://example.com/"), /http/i);
    assert.match(refusalReason("not a url"), /web address/i);
  });
});

describe("inspectEmbeddable", () => {
  const url = (s) => new URL(s);

  it("accepts a framable page", async () => {
    const d = deps({
      dns: { "a.example": ["8.8.8.8"] },
      pages: { "http://a.example/": reply(200) },
    });
    assert.deepEqual(await inspectEmbeddable(url("http://a.example/"), d), {
      embeddable: true,
    });
  });

  it("explains each refusal", async () => {
    const reason = async (opts, target = "http://a.example/") =>
      (await inspectEmbeddable(url(target), deps(opts))).reason;
    const dns = { "a.example": ["8.8.8.8"] };

    assert.match(await reason({ dns: { "a.example": ["127.0.0.1"] } }), /this computer/i);
    assert.match(
      await reason({ dns: { "a.example": ["10.0.0.5"] } }),
      /private network/i,
    );
    assert.match(await reason({}), /could not be found|reach/i);
    assert.match(
      await reason({ dns, pages: { "http://a.example/": reply(404) } }),
      /HTTP 404/,
    );
    assert.match(
      await reason({ dns, pages: { "http://a.example/": reply(503) } }),
      /HTTP 503/,
    );
    assert.match(
      await reason({
        dns,
        pages: { "http://a.example/": reply(200, { "x-frame-options": "DENY" }) },
      }),
      /another page/i,
    );
    assert.match(
      await reason({
        dns,
        pages: { "http://a.example/": reply(302, { location: "http://127.0.0.1/" }) },
      }),
      /this computer/i,
    );
    assert.match(
      await reason({ dns, pages: { "http://a.example/": reply(302) } }),
      /redirect/i,
    );
  });

  it("tags the failures the UI words differently", async () => {
    const code = async (opts) =>
      (await inspectEmbeddable(url("http://a.example/"), deps(opts))).code;
    const dns = { "a.example": ["8.8.8.8"] };
    assert.equal(await code({}), "not-found");
    assert.equal(
      await code({
        dns,
        pages: { "http://a.example/": reply(200, { "x-frame-options": "DENY" }) },
      }),
      "framing",
    );
    assert.equal(await code({ dns, pages: {} }), "unreachable");
    assert.equal(await code({ dns: { "a.example": ["10.0.0.5"] } }), "private");
  });

  it("tries the frame when only the certificate chain is untrusted (TLS inspection)", async () => {
    const tlsFailure = () => {
      const error = new TypeError("fetch failed");
      error.cause = Object.assign(
        new Error("self-signed certificate in certificate chain"),
        {
          code: "SELF_SIGNED_CERT_IN_CHAIN",
        },
      );
      return error;
    };
    const calls = [];
    const d = {
      resolve: async () => ["8.8.8.8"],
      fetchHead: async (u) => {
        calls.push(u);
        throw tlsFailure();
      },
    };
    assert.deepEqual(await inspectEmbeddable(url("https://a.example/"), d), {
      embeddable: true,
      unverified: true,
    });
    assert.equal(await checkEmbeddable(url("https://a.example/"), d), true);
  });

  it("still refuses private addresses when the certificate is the problem", async () => {
    const d = {
      resolve: async () => ["10.0.0.5"],
      fetchHead: async () => {
        throw Object.assign(new Error("x"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
      },
    };
    const verdict = await inspectEmbeddable(url("https://a.example/"), d);
    assert.equal(verdict.embeddable, false);
    assert.match(verdict.reason, /private network/i);
    const literal = await inspectEmbeddable(url("https://169.254.169.254/"), d);
    assert.equal(literal.embeddable, false);
  });

  it("re-checks the next hop's address before trusting a certificate error there", async () => {
    const d = {
      resolve: async (host) => (host === "a.example" ? ["8.8.8.8"] : ["127.0.0.1"]),
      fetchHead: async (u) => {
        if (u === "https://a.example/") {
          return reply(302, { location: "https://evil.example/" });
        }
        throw Object.assign(new Error("x"), { code: "CERT_HAS_EXPIRED" });
      },
    };
    const verdict = await inspectEmbeddable(url("https://a.example/"), d);
    assert.equal(verdict.embeddable, false);
  });

  it("does not treat other network failures as certificate problems", async () => {
    assert.equal(isCertificateError(new Error("ECONNREFUSED")), false);
    assert.equal(
      isCertificateError(Object.assign(new Error("x"), { code: "ECONNRESET" })),
      false,
    );
    assert.equal(isCertificateError(null), false);
    const d = {
      resolve: async () => ["8.8.8.8"],
      fetchHead: async () => {
        throw new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } });
      },
    };
    const verdict = await inspectEmbeddable(url("https://a.example/"), d);
    assert.equal(verdict.code, "unreachable");
  });

  it("gives up after too many redirects", async () => {
    const d = deps({
      dns: { "loop.example": ["8.8.8.8"] },
      pages: { "http://loop.example/": reply(302, { location: "http://loop.example/" }) },
    });
    const verdict = await inspectEmbeddable(url("http://loop.example/"), d);
    assert.equal(verdict.embeddable, false);
    assert.match(verdict.reason, /redirect/i);
  });
});
