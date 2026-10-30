import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { isFreshRunRequest, RUN_REQUEST_TTL_MS, useTasksNav } from "./tasksNavStore.ts";

beforeEach(() => useTasksNav.setState({ runRequest: null, detailRequest: null }));

describe("detail requests from the Dashboard", () => {
  it("asks for one task's details and is consumed once", () => {
    const { requestDetail, clearDetailRequest } = useTasksNav.getState();
    requestDetail("weekly-aging-report");
    const request = useTasksNav.getState().detailRequest;
    assert.equal(request.taskId, "weekly-aging-report");
    clearDetailRequest(request.id + 1);
    assert.equal(useTasksNav.getState().detailRequest.taskId, "weekly-aging-report");
    clearDetailRequest(request.id);
    assert.equal(useTasksNav.getState().detailRequest, null);
  });

  it("does not disturb a pending run request", () => {
    const { requestRun, requestDetail } = useTasksNav.getState();
    requestRun("weekly-backlog-report");
    requestDetail("weekly-aging-report");
    assert.equal(useTasksNav.getState().runRequest.taskId, "weekly-backlog-report");
  });
});

describe("run requests from the command bar", () => {
  it("each request gets its own id and the latest one wins", () => {
    const { requestRun } = useTasksNav.getState();
    requestRun("weekly-aging-report");
    const first = useTasksNav.getState().runRequest;
    requestRun("weekly-backlog-report");
    const second = useTasksNav.getState().runRequest;
    assert.equal(first.taskId, "weekly-aging-report");
    assert.equal(second.taskId, "weekly-backlog-report");
    assert.notEqual(first.id, second.id);
  });

  it("clears only the request it was asked to", () => {
    const { requestRun, clearRunRequest } = useTasksNav.getState();
    requestRun("weekly-aging-report");
    const old = useTasksNav.getState().runRequest;
    requestRun("weekly-backlog-report");
    clearRunRequest(old.id);
    assert.equal(useTasksNav.getState().runRequest.taskId, "weekly-backlog-report");
    clearRunRequest(useTasksNav.getState().runRequest.id);
    assert.equal(useTasksNav.getState().runRequest, null);
  });

  it("ignores a request that nobody picked up for a minute", () => {
    const request = { id: 1, taskId: "x", at: 1_000 };
    assert.equal(isFreshRunRequest(request, 1_000 + RUN_REQUEST_TTL_MS), true);
    assert.equal(isFreshRunRequest(request, 1_001 + RUN_REQUEST_TTL_MS), false);
  });
});
