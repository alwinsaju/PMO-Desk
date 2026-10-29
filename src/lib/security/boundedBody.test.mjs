// Run with `pnpm test`. The streaming body cap shared by every /api route.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BodyTooLargeError, readBytesBounded, readTextBounded } from "./boundedBody.ts";

const post = (body, headers = {}) =>
  new Request("http://localhost/api/x", { method: "POST", body, headers });

/** A body delivered in chunks with no Content-Length, like a chunked upload. */
function chunked(chunks, onPull = () => {}) {
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      onPull(i);
      if (i < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[i++]));
      else controller.close();
    },
  });
  return new Request("http://localhost/api/x", {
    method: "POST",
    body: stream,
    duplex: "half",
  });
}

describe("readTextBounded", () => {
  it("returns the text of a body within the cap", async () => {
    assert.equal(await readTextBounded(post("héllo"), 1024), "héllo");
  });

  it("returns an empty string when there is no body", async () => {
    const get = new Request("http://localhost/api/x");
    assert.equal(await readTextBounded(get, 10), "");
  });

  it("accepts a body exactly at the cap", async () => {
    assert.equal(await readTextBounded(post("abcd"), 4), "abcd");
  });

  it("refuses a body over the cap by its real size", async () => {
    await assert.rejects(readTextBounded(post("x".repeat(11)), 10), BodyTooLargeError);
  });

  it("refuses by declared Content-Length without reading the body", async () => {
    let pulls = 0;
    const request = new Request("http://localhost/api/x", {
      method: "POST",
      headers: { "content-length": "999999" },
      body: new ReadableStream({ pull: () => void pulls++ }),
      duplex: "half",
    });
    pulls = 0;
    await assert.rejects(readTextBounded(request, 100), BodyTooLargeError);
    // A ReadableStream primes itself with one pull; nothing is consumed beyond that.
    assert.ok(pulls <= 1);
  });

  it("counts bytes, not characters", async () => {
    await assert.rejects(
      readTextBounded(post("\u20ac".repeat(4)), 10),
      BodyTooLargeError,
    );
  });

  it("stops reading a chunked body once the cap is crossed", async () => {
    let pulls = 0;
    const request = chunked(Array(1000).fill("0123456789"), () => pulls++);
    await assert.rejects(readTextBounded(request, 25), BodyTooLargeError);
    assert.ok(pulls < 20, `read ${pulls} chunks of a 1000-chunk body`);
  });

  it("reassembles a body that arrives in several chunks", async () => {
    const text = await readTextBounded(chunked(["ab", "cd", "ef"]), 100);
    assert.equal(text, "abcdef");
  });
});

describe("readBytesBounded", () => {
  it("returns the raw bytes", async () => {
    const bytes = await readBytesBounded(post(new Uint8Array([1, 2, 3])), 10);
    assert.deepEqual([...bytes], [1, 2, 3]);
  });

  it("reports the cap on the error", async () => {
    await assert.rejects(readBytesBounded(post("x".repeat(50)), 8), (error) => {
      assert.ok(error instanceof BodyTooLargeError);
      assert.equal(error.maxBytes, 8);
      return true;
    });
  });
});
