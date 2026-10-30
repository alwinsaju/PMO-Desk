import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearDraft,
  DRAFT_MAX_AGE_MS,
  loadDraft,
  parseDraft,
  saveDraft,
} from "./draftAutosave.ts";

const fakeStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

const draft = (over = {}) => ({
  id: "tpl_1",
  name: "Chaser",
  kind: "email",
  description: "",
  subject: "Following up: {{title}}",
  to: "",
  cc: "",
  body: "Hi {{greeting}}",
  usedBy: ["app:pmo-todo:chaser"],
  ...over,
});

describe("draft autosave", () => {
  it("keeps a draft and gives it back while the template is unchanged", () => {
    const storage = fakeStorage();
    saveDraft(storage, "tpl_1", draft({ body: "edited" }), "2026-10-01T00:00:00Z", 1_000);
    assert.equal(
      loadDraft(storage, "tpl_1", "2026-10-01T00:00:00Z", 2_000).body,
      "edited",
    );
  });

  it("drops a draft when the saved template changed since, or it is too old", () => {
    const storage = fakeStorage();
    saveDraft(storage, "tpl_1", draft(), "v1", 1_000);
    assert.equal(loadDraft(storage, "tpl_1", "v2", 2_000), null);
    assert.equal(storage.map.size, 0);
    saveDraft(storage, "tpl_1", draft(), "v1", 1_000);
    assert.equal(loadDraft(storage, "tpl_1", "v1", 1_000 + DRAFT_MAX_AGE_MS + 1), null);
    assert.equal(storage.map.size, 0);
  });

  it("clears on request and keeps drafts of different templates apart", () => {
    const storage = fakeStorage();
    saveDraft(storage, "tpl_1", draft(), "v1", 1);
    saveDraft(storage, "tpl_2", draft({ id: "tpl_2" }), "v1", 1);
    clearDraft(storage, "tpl_1");
    assert.equal(loadDraft(storage, "tpl_1", "v1", 2), null);
    assert.equal(loadDraft(storage, "tpl_2", "v1", 2).id, "tpl_2");
  });

  it("ignores damaged or foreign data instead of throwing", () => {
    const storage = fakeStorage();
    storage.setItem("ai-os:template-draft:tpl_1", "{not json");
    assert.equal(loadDraft(storage, "tpl_1", "v1", 1), null);
    storage.setItem(
      "ai-os:template-draft:tpl_1",
      JSON.stringify({ base: "v1", savedAt: 1, draft: draft({ id: "tpl_other" }) }),
    );
    assert.equal(
      loadDraft(storage, "tpl_1", "v1", 2),
      null,
      "a draft of another template",
    );
    assert.equal(loadDraft(null, "tpl_1", "v1", 1), null);
    assert.doesNotThrow(() => saveDraft(null, "tpl_1", draft(), "v1", 1));
    assert.doesNotThrow(() =>
      saveDraft(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        "tpl_1",
        draft(),
        "v1",
        1,
      ),
    );
  });

  it("rejects a draft whose fields are the wrong type or too long", () => {
    assert.ok(parseDraft(draft()));
    assert.equal(parseDraft(draft({ kind: "sms" })), null);
    assert.equal(parseDraft(draft({ body: 5 })), null);
    assert.equal(parseDraft(draft({ name: "x".repeat(81) })), null);
    assert.equal(parseDraft(draft({ usedBy: [1] })), null);
    assert.equal(parseDraft(null), null);
  });
});
