"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import type { NextOffer } from "./api";
import { FilteredList } from "./FilteredList";
import { FirstRunWizard } from "./FirstRunWizard";
import { NoticeStack, PmoToolbar } from "./IngestStatusBar";
import { NeedsAttentionStrip } from "./NeedsAttentionStrip";
import { NewTodoDialog } from "./NewTodoDialog";
import { PasteIntakeDialog } from "./PasteIntakeDialog";
import { useDockBadgeStore } from "@/components/taskbar/dockBadgeStore";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";
import { needsFirstRun } from "@/lib/pmo/firstRun";
import type { Proposal } from "@/lib/pmo/types";
import { PanelMessage, ScrollBody } from "./parts";
import { ProposalDialog } from "./ProposalDialog";
import { useRemindersStore } from "./remindersStore";
import { ReportsTab } from "./ReportsTab";
import { ReviewQueue } from "./ReviewQueue";
import { SettingsDialog } from "./SettingsDialog";
import { TodoDetailDialog } from "./TodoDetailDialog";
import { TodoList } from "./TodoList";
import { UndoRejectBar, type RejectedItem } from "./UndoRejectBar";
import { reviewCount as countReview, type TodoFilter, type TodoSort } from "./queueView";
import { initialReportView, type ReportViewState } from "./reportView";
import { usePmoData } from "./usePmoData";

/**
 * Root PMO To-Do window (registered as "pmo-todo", see index.ts). Messages
 * that arrive in the inbox folder are structured by the local model into
 * proposals; they wait in the Review Queue and only a human Approve turns one
 * into a to-do. Everything here talks to the app's own /api/pmo routes and
 * sends nothing anywhere.
 *
 * Layout: one toolbar row (tabs + status + actions), an optional notice strip,
 * then the active tab filling the rest and scrolling on its own. The root is a
 * size container (`@container`), so the toolbar adapts to the window, not the
 * screen.
 */
export function PmoTodoApp({ windowId }: { windowId: string }) {
  const { state, connection, refetch } = usePmoData();
  const [tab, setTab] = useState("review");
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [todoId, setTodoId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // View choices live here, not in the tab content, which unmounts when you
  // switch tabs: coming back finds the same filter, sort and open sections.
  const [todoView, setTodoView] = useState<{ filter: TodoFilter; sort: TodoSort }>({
    filter: "open",
    sort: "due",
  });
  const [filteredReason, setFilteredReason] = useState<string | null>(null);
  // The weekly report's period choice and draft live here too: the tab's
  // content unmounts on a tab switch, and the person's edits must not.
  const [reportView, setReportView] = useState<ReportViewState>(() =>
    initialReportView(new Date().toISOString().slice(0, 10)),
  );
  // The first state brings "today" in the configured time zone: reseed the
  // custom range from it, once.
  const reportSeeded = useRef(false);
  const serverToday = state?.today;
  useEffect(() => {
    if (!serverToday || reportSeeded.current) return;
    reportSeeded.current = true;
    setReportView((view) => (view.draft ? view : initialReportView(serverToday)));
  }, [serverToday]);
  const [notTaskOpen, setNotTaskOpen] = useState(false);
  const [nextOffer, setNextOffer] = useState<NextOffer | null>(null);
  const [justRejected, setJustRejected] = useState<RejectedItem | null>(null);
  const rememberRejected = (p: Proposal) =>
    setJustRejected({ id: p.id, title: p.draft?.title || p.summary.subject });

  // A clicked reminder (desktop notification, web notification or the in-app
  // toast) asks for this window to open a to-do. It waits for the first state
  // so the to-do can be found; an unknown id just lands on the To-Do tab.
  const openRequest = useRemindersStore((s) => s.openRequest);
  const clearOpenRequest = useRemindersStore((s) => s.clearOpenRequest);
  const loaded = state !== null;
  useEffect(() => {
    if (!openRequest || !loaded) return;
    setTab("todos");
    if (openRequest.todoId) setTodoId(openRequest.todoId);
    clearOpenRequest(openRequest.id);
  }, [openRequest, loaded, clearOpenRequest]);

  // Edits here (done, snooze, a new due date) show on the dock badge at once,
  // without waiting for the next 60 s reminder poll.
  const attention = state?.attention.count;
  useEffect(() => {
    if (attention === undefined) return;
    useRemindersStore.getState().setAttention(attention);
    useDockBadgeStore.getState().setBadge("pmo-todo", attention);
    getDesktopBridge()?.setBadge(attention);
  }, [attention]);

  if (!state) {
    return (
      <div data-window-id={windowId} className="h-full w-full">
        <PanelMessage className="h-full">
          {connection === "offline"
            ? "Can't reach the AI OS server. This will connect automatically once it's available."
            : "Loading PMO To-Do…"}
        </PanelMessage>
      </div>
    );
  }

  if (needsFirstRun(state.config)) {
    return (
      <div data-window-id={windowId} className="h-full w-full">
        <FirstRunWizard windowId={windowId} onDone={refetch} />
      </div>
    );
  }

  const proposal = proposalId
    ? (state.queue.find((p) => p.id === proposalId) ?? null)
    : null;
  const todo = todoId ? (state.todos.find((t) => t.id === todoId) ?? null) : null;
  const reviewCount = countReview(state.queue);
  const openCount = state.todos.filter((t) => t.status === "open").length;
  const offline = connection === "offline";

  return (
    <div data-window-id={windowId} className="@container flex h-full w-full flex-col">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <PmoToolbar
          state={state}
          tabs={
            <TabsList aria-label="PMO views">
              <TabButton
                value="review"
                short="Review"
                full="Review Queue"
                count={reviewCount}
              />
              <TabButton value="todos" short="To-Do" full="To-Do" count={openCount} />
              <TabButton
                value="filtered"
                short="Filtered"
                full="Filtered"
                count={state.ingest.filteredCount}
              />
              <TabButton value="reports" short="Report" full="Reports" />
            </TabsList>
          }
          onPaste={() => setPasting(true)}
          onSettings={() => setSettingsOpen(true)}
          onSettled={refetch}
        />
        <NoticeStack
          state={state}
          offline={offline}
          onSettings={() => setSettingsOpen(true)}
        />
        <NeedsAttentionStrip state={state} />
        <UndoRejectBar
          item={justRejected}
          onClear={() => setJustRejected(null)}
          onSettled={refetch}
        />

        <Panel value="review">
          <ReviewQueue
            state={state}
            notTaskOpen={notTaskOpen}
            onNotTaskOpenChange={setNotTaskOpen}
            onOpen={setProposalId}
            onOpenTodo={(id) => {
              setTab("todos");
              setTodoId(id);
            }}
            onSettled={refetch}
            onRejected={rememberRejected}
          />
        </Panel>
        <Panel value="todos">
          <TodoList
            state={state}
            view={todoView}
            onViewChange={setTodoView}
            onOpen={setTodoId}
            onNew={() => setCreating(true)}
            onNextOffer={setNextOffer}
            onSettled={refetch}
          />
        </Panel>
        <Panel value="filtered">
          <FilteredList
            state={state}
            reason={filteredReason}
            onReasonChange={setFilteredReason}
            onSettled={refetch}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </Panel>
        <TabsContent value="reports" className="flex min-h-0 flex-1 flex-col">
          <ReportsTab state={state} view={reportView} onViewChange={setReportView} />
        </TabsContent>
      </Tabs>

      <ProposalDialog
        proposal={proposal}
        structuring={state.structuring}
        runtime={state.runtime}
        onSettled={refetch}
        onRejected={rememberRejected}
        onOpenChange={(open) => {
          if (!open) setProposalId(null);
        }}
      />
      <TodoDetailDialog
        todo={todo}
        today={state.today}
        reminders={state.config.reminders}
        nowIso={state.serverTime}
        chaser={todo ? state.chasers?.[todo.id] : undefined}
        signoffDraft={todo ? state.signoffDrafts?.[todo.id] : undefined}
        nextOffer={nextOffer}
        onNextOffer={setNextOffer}
        me={state.config.me}
        onSettled={refetch}
        onOpenChange={(open) => {
          if (!open) setTodoId(null);
        }}
      />
      <NewTodoDialog open={creating} onSettled={refetch} onOpenChange={setCreating} />
      <PasteIntakeDialog open={pasting} onSettled={refetch} onOpenChange={setPasting} />
      <SettingsDialog
        state={state}
        open={settingsOpen}
        onSettled={refetch}
        onOpenChange={setSettingsOpen}
      />
    </div>
  );
}

/** A tab trigger whose label shortens in a narrow window; the count is the
 *  Tabs primitive's bubble (it tints to the accent on the active tab). */
function TabButton({
  value,
  short,
  full,
  count,
}: {
  value: string;
  short: string;
  full: string;
  /** The bubble after the name; none for a tab that is not a list. */
  count?: number;
}) {
  return (
    <TabsTrigger
      value={value}
      count={count}
      className="shrink-0 px-3 whitespace-nowrap @md:px-4"
    >
      <span className="@xl:hidden">{short}</span>
      <span className="hidden @xl:inline">{full}</span>
    </TabsTrigger>
  );
}

/** One tab's content: fills the rest of the window and scrolls by itself. */
function Panel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsContent value={value} className="flex min-h-0 flex-1 flex-col">
      <ScrollBody memoryKey={`pmo:${value}`}>{children}</ScrollBody>
    </TabsContent>
  );
}
