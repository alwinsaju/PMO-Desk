import { toast } from "@/lib/notifications/toastStore";
import { recordTitle } from "@/lib/registers/records";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import type { RegisterReply } from "./registersApi";
import type { RegisterState } from "./useRegister";

/** Deletes a record and offers Undo in a toast, instead of asking first. */
export async function removeWithUndo(
  def: RegisterDef,
  state: RegisterState,
  record: RegisterRecord,
): Promise<RegisterReply> {
  const reply = await state.remove([record.id]);
  if (!reply.ok) return reply;
  toast({
    key: `undo-${record.id}`,
    message: `Deleted “${recordTitle(def, record)}”.`,
    durationMs: 10_000,
    action: {
      label: "Undo",
      run: () =>
        void state
          .save([
            {
              id: record.id,
              values: record.values,
              todoId: record.todoId,
              createdAt: record.createdAt,
            },
          ])
          .then((back) => {
            if (!back.ok) toast({ tone: "danger", message: back.reason });
          }),
    },
  });
  return reply;
}
