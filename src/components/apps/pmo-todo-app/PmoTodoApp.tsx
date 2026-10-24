"use client";

import { useEffect, useState } from "react";
import { ScrollArea, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { FilteredList } from "./FilteredList";
import { IngestStatusBar } from "./IngestStatusBar";
import { NewTodoDialog } from "./NewTodoDialog";
import { PasteIntakeDialog } from "./PasteIntakeDialog";
import { useDockBadgeStore } from "@/components/taskbar/dockBadgeStore";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";
import { ProposalDialog } from "./ProposalDialog";
import { RemindersNotice } from "./RemindersNotice";
import { useRemindersStore } from "./remindersStore";
import { ReviewQueue } from "./ReviewQueue";
import { SettingsDialog } from "./SettingsDialog";
import { TodoDetailDialog } from "./TodoDetailDialog";
import { TodoList } from "./TodoList";
import { reviewCount as countReview } from "./queueView";
import { usePmoData } from "./usePmoData";

/**
 * Root PMO To-Do window (registered as "pmo-todo", see index.ts). Messages
 * that arrive in the inbox folder are structured by the local model into
 * proposals; they wait in the Review Queue and only a human Approve turns one
 * into a to-do. Everything here talks to the app's own /api/pmo routes and
 * sends nothing anywhere.
 */
export function PmoTodoApp({ windowId }: { windowId: string }) {
  const { state, connection, refetch } = usePmoData();
  const [tab, setTab] = useState("review");
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [todoId, setTodoId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      <div
        data-window-id={windowId}
        className="flex h-full w-full items-center justify-center p-6"
      >
        <p className="text-ink-faint text-sm">
          {connection === "offline"
            ? "Can't reach the AI OS server. This will connect automatically once it's available."
            : "Loading PMO To-Do…"}
        </p>
      </div>
    );
  }

  const proposal = proposalId
    ? (state.queue.find((p) => p.id === proposalId) ?? null)
    : null;
  const todo = todoId ? (state.todos.find((t) => t.id === todoId) ?? null) : null;
  const reviewCount = countReview(state.queue);
  const openCount = state.todos.filter((t) => t.status === "open").length;

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      <IngestStatusBar
        state={state}
        offline={connection === "offline"}
        onShowFiltered={() => setTab("filtered")}
        onPaste={() => setPasting(true)}
        onSettings={() => setSettingsOpen(true)}
        onSettled={refetch}
      />
      <RemindersNotice attention={state.attention.count} />

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-3">
          <TabsList>
            <TabsTrigger value="review">
              Review Queue{state.queue.length > 0 ? ` (${reviewCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="todos">To-Do ({openCount})</TabsTrigger>
            <TabsTrigger value="filtered">
              Filtered ({state.ingest.filteredCount})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="review" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <ReviewQueue
              state={state}
              onOpen={setProposalId}
              onOpenTodo={(id) => {
                setTab("todos");
                setTodoId(id);
              }}
              onSettled={refetch}
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="todos" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <TodoList
              state={state}
              onOpen={setTodoId}
              onNew={() => setCreating(true)}
              onSettled={refetch}
            />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="filtered" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <FilteredList
              state={state}
              onSettled={refetch}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <ProposalDialog
        proposal={proposal}
        structuring={state.structuring}
        onSettled={refetch}
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
