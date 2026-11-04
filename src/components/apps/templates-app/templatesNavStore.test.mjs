import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useTemplatesNav } from "./templatesNavStore.ts";

describe("templates navigation request", () => {
  it("holds the requested template until it is cleared", () => {
    useTemplatesNav.getState().requestOpen("t1");
    const first = useTemplatesNav.getState().openRequest;
    assert.equal(first.templateId, "t1");
    useTemplatesNav.getState().clearOpenRequest(first.id);
    assert.equal(useTemplatesNav.getState().openRequest, null);
  });

  it("gives each request its own id, and a stale clear does not drop a newer one", () => {
    useTemplatesNav.getState().requestOpen("a");
    const a = useTemplatesNav.getState().openRequest;
    useTemplatesNav.getState().requestOpen("b");
    const b = useTemplatesNav.getState().openRequest;
    assert.notEqual(a.id, b.id);
    useTemplatesNav.getState().clearOpenRequest(a.id);
    assert.equal(useTemplatesNav.getState().openRequest.templateId, "b");
    useTemplatesNav.getState().clearOpenRequest(b.id);
  });
});
