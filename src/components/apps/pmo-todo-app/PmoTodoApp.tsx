"use client";

import { useState } from "react";
import { ScrollArea, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { FilteredList } from "./FilteredList";
import { IngestStatusBar } from "./IngestStatusBar";
import { NewTodoDialog } from "./NewTodoDialog";
import { PasteIntakeDialog } from "./PasteIntakeDialog";
import { ProposalDialog } from "./ProposalDialog";
import { ReviewQueue } from "./ReviewQueue";
import { SettingsDialog } from "./SettingsDialog";
import { TodoDetailDialog } from "./TodoDetailDialog";
import { TodoList } from "./TodoList";
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
  const reviewCount = state.queue.filter(
    (p) => p.status === "ready" && p.isActionable !== false,
  ).length;
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
            <ReviewQueue state={state} onOpen={setProposalId} onSettled={refetch} />
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
