// Run with `pnpm test`. Thread matching (the deterministic, conservative rule
// for "this message continues that to-do") and the "looks like a reply from the
// person we are waiting on" hint. Pure; fictional data only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addressForWaitingOn,
  looksLikeReplyFrom,
  pickMatchingTodo,
  threadKeyOf,
} from "./thread.ts";

const TENANT = "00000000-0000-0000-0000-000000000000";
const OTHER_TENANT = "11111111-1111-1111-1111-111111111111";

const outlook = (patch = {}) => ({
  source: "outlook",
  sourceId: "x",
  thread: { conversationId: "AAQkConv1=" },
  context: { mailbox: "alsaju@deloitte.com" },
  link: "outlook:0000",
  ...patch,
});
const teams = (patch = {}) => ({
  source: "teams",
  sourceId: "x",
  thread: {},
  context: { tenantId: TENANT },
  link: `https://teams.microsoft.com/l/message/19:abc@thread.v2/1729581240123?tenantId=${TENANT}`,
  ...patch,
});

describe("threadKeyOf", () => {
  it("keys an Outlook message by mailbox and conversation id, case-insensitively", () => {
    const key = threadKeyOf(outlook());
    assert.equal(key, "outlook|alsaju@deloitte.com|aaqkconv1=");
    assert.equal(
      threadKeyOf(outlook({ thread: { conversationId: "  AAQKCONV1= " } })),
      key,
    );
  });

  it("has no key without a conversation id, and never for a paste", () => {
    assert.equal(threadKeyOf(outlook({ thread: {} })), null);
    assert.equal(threadKeyOf(outlook({ thread: { conversationId: "" } })), null);
    assert.equal(
      threadKeyOf({ ...outlook(), source: "manual" }),
      null,
      "a paste carries no reliable thread",
    );
  });

  it("keeps mailboxes apart: the same conversation id in another mailbox is another thread", () => {
    assert.notEqual(
      threadKeyOf(outlook()),
      threadKeyOf(outlook({ context: { mailbox: "someone.else@deloitte.com" } })),
    );
    assert.notEqual(threadKeyOf(outlook()), threadKeyOf(outlook({ context: {} })));
  });

  it("keys a Teams group chat by tenant and the chat id from its deep link", () => {
    const key = threadKeyOf(teams());
    assert.equal(key, `teams|chat|${TENANT}|19:abc@thread.v2`);
    // A different message in the same chat shares the key.
    const other = teams({
      link: `https://teams.microsoft.com/l/message/19:abc@thread.v2/999?tenantId=${TENANT}`,
    });
    assert.equal(threadKeyOf(other), key);
  });

  it("prefers an explicit conversation id for Teams, and keeps tenants apart", () => {
    const withConv = threadKeyOf(teams({ thread: { conversationId: "Conv-9" } }));
    assert.equal(withConv, `teams|conv|${TENANT}|conv-9`);
    assert.notEqual(
      withConv,
      threadKeyOf(
        teams({
          thread: { conversationId: "Conv-9" },
          context: { tenantId: OTHER_TENANT },
        }),
      ),
    );
    assert.notEqual(
      threadKeyOf(teams()),
      threadKeyOf(teams({ context: { tenantId: OTHER_TENANT }, link: teams().link })),
    );
  });

  it("keys a channel post and its replies together, but not different posts", () => {
    const channel = "19:chan@thread.tacv2";
    const post = (id, parent) =>
      teams({
        link: `https://teams.microsoft.com/l/message/${channel}/${id}?tenantId=${TENANT}${parent ? `&parentMessageId=${parent}` : ""}`,
      });
    const root = threadKeyOf(post("100"));
    assert.equal(threadKeyOf(post("101", "100")), root, "a reply carries the root id");
    assert.notEqual(threadKeyOf(post("200")), root, "another post in the channel");
    assert.equal(
      threadKeyOf(
        teams({ link: undefined, context: { tenantId: TENANT, chatId: channel } }),
      ),
      null,
      "no root message id: no key rather than a channel-wide one",
    );
  });

  it("keys a flow-built Teams item by its Conversation ID, with or without a tenant ID", () => {
    const conv = "19:7f3c1a2b4d5e4f60a1b2c3d4e5f60718@unq.gbl.spaces";
    const v2 = (patch = {}) =>
      teams({
        thread: { conversationId: conv },
        context: { chatId: conv, chatType: "group" },
        link: `https://teams.microsoft.com/l/message/${conv}/1729761600000?context=%7B%7D`,
        ...patch,
      });
    const key = threadKeyOf(v2());
    assert.equal(
      key,
      `teams|conv||${conv.toLowerCase()}`,
      "no tenant id: an empty tenant slot",
    );
    // A later message in the same chat shares it; another chat does not.
    assert.equal(threadKeyOf(v2({ sourceId: "later" })), key);
    assert.notEqual(
      threadKeyOf(v2({ thread: { conversationId: "19:other@unq.gbl.spaces" } })),
      key,
    );
    // The explicit id wins over a different chat in the deep link.
    assert.equal(
      threadKeyOf(
        v2({
          link: `https://teams.microsoft.com/l/message/19:elsewhere@thread.v2/5?tenantId=${TENANT}`,
        }),
      ),
      `teams|conv|${TENANT}|${conv.toLowerCase()}`,
    );
    // Only context.chatId (no thread.conversationId) gives the chat key.
    assert.equal(
      threadKeyOf(v2({ thread: {}, link: undefined })),
      `teams|chat||${conv.toLowerCase()}`,
    );
  });

  it("treats a channel Conversation ID like a channel: one post and its replies, not the whole channel", () => {
    const channel = "19:chan@thread.tacv2";
    const post = (patch = {}) =>
      teams({
        thread: { conversationId: channel },
        context: { tenantId: TENANT, chatId: channel },
        link: `https://teams.microsoft.com/l/message/${channel}/100?context=%7B%7D`,
        ...patch,
      });
    const root = threadKeyOf(post());
    assert.equal(root, `teams|chat|${TENANT}|${channel}|100`);
    // A reply names its parent (Reply to Message ID) rather than its own id.
    assert.equal(
      threadKeyOf(
        post({
          thread: { conversationId: channel, parentId: "100" },
          link: `https://teams.microsoft.com/l/message/${channel}/101?context=%7B%7D`,
        }),
      ),
      root,
    );
    assert.notEqual(
      threadKeyOf(
        post({
          link: `https://teams.microsoft.com/l/message/${channel}/200?context=%7B%7D`,
        }),
      ),
      root,
    );
    assert.equal(threadKeyOf(post({ link: undefined })), null, "no root: no key");
    // A top-level post sends no parent: null and "" both mean "none".
    for (const parentId of [null, ""]) {
      assert.equal(
        threadKeyOf(post({ thread: { conversationId: channel, parentId } })),
        root,
      );
    }
  });

  it("never matches an Outlook and a Teams message even with the same id", () => {
    assert.notEqual(
      threadKeyOf(outlook({ thread: { conversationId: "same" } })),
      threadKeyOf(teams({ thread: { conversationId: "same" } })),
    );
  });
});

describe("pickMatchingTodo", () => {
  const todo = (id, updatedAt, status = "open") => ({ id, updatedAt, status });

  it("matches on equal keys only", () => {
    const a = todo("td_a", "2026-10-20T00:00:00Z");
    assert.equal(pickMatchingTodo("k1", [{ todo: a, key: "k1" }]), a);
    assert.equal(pickMatchingTodo("k1", [{ todo: a, key: "k2" }]), null);
    assert.equal(pickMatchingTodo("k1", [{ todo: a, key: null }]), null);
    assert.equal(pickMatchingTodo(null, [{ todo: a, key: null }]), null);
  });

  it("ignores closed to-dos", () => {
    const done = todo("td_a", "2026-10-20T00:00:00Z", "done");
    assert.equal(pickMatchingTodo("k", [{ todo: done, key: "k" }]), null);
  });

  it("with several candidates takes the most recently updated, then the lowest id", () => {
    const older = todo("td_a", "2026-10-20T00:00:00Z");
    const newer = todo("td_b", "2026-10-22T00:00:00Z");
    const tie = todo("td_c", "2026-10-22T00:00:00Z");
    assert.equal(
      pickMatchingTodo(
        "k",
        [older, tie, newer].map((t) => ({ todo: t, key: "k" })),
      ),
      newer,
    );
  });
});

describe("looksLikeReplyFrom", () => {
  it("matches a person by name tokens, not by a shared first name", () => {
    assert.equal(looksLikeReplyFrom("Priya Nair", { name: "Priya Nair" }), true);
    assert.equal(
      looksLikeReplyFrom("Priya Nair (Finance)", { name: "Nair, Priya" }),
      true,
    );
    assert.equal(looksLikeReplyFrom("Priya", { name: "Priya Nair" }), true);
    assert.equal(looksLikeReplyFrom("Priya Nair", { name: "Priya Menon" }), false);
    assert.equal(looksLikeReplyFrom("Sam Example", { name: "Jordan Sample" }), false);
  });

  it("uses the address when the waiting-on names one, or the local part", () => {
    assert.equal(
      looksLikeReplyFrom("sam.example@deloitte.com", {
        address: "Sam.Example@Deloitte.com",
      }),
      true,
    );
    assert.equal(
      looksLikeReplyFrom("Sam Example", { address: "sam.example@deloitte.com" }),
      true,
    );
    assert.equal(
      looksLikeReplyFrom("sam.example@deloitte.com", { address: "other@deloitte.com" }),
      false,
    );
  });

  it("matches a team by its distinctive word and ignores filler words", () => {
    assert.equal(looksLikeReplyFrom("Finance team", { name: "Finance Ops" }), true);
    assert.equal(looksLikeReplyFrom("the team", { name: "Pat Sample" }), false);
    assert.equal(looksLikeReplyFrom("", { name: "Pat Sample" }), false);
    assert.equal(looksLikeReplyFrom(null, { name: "Pat Sample" }), false);
    assert.equal(looksLikeReplyFrom("Pat Sample", {}), false);
  });
});

describe("addressForWaitingOn", () => {
  const people = [
    { name: "Pat Sample", address: "pat.sample@deloitte.com" },
    { name: "Jordan Sample", address: "jordan.sample@deloitte.com" },
    { name: "Alwin Saju", address: "alsaju@deloitte.com" },
  ];
  it("returns the one matching address, never my own, never a guess between two", () => {
    assert.equal(
      addressForWaitingOn("Jordan Sample", people),
      "jordan.sample@deloitte.com",
    );
    assert.equal(
      addressForWaitingOn("Alwin Saju", people, ["alsaju@deloitte.com"]),
      null,
    );
    assert.equal(addressForWaitingOn("Sample", people), null, "two Samples: ambiguous");
    assert.equal(addressForWaitingOn("Nobody Here", people), null);
  });
});
