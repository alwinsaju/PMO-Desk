import { NextResponse } from "next/server";
import { z } from "zod";
import { answerPmoIntent } from "@/lib/ai-runtime/pmoAnswers";
import { livePmoDeps } from "@/lib/ai-runtime/pmoAnswers.live";
import { PMO_TOPICS } from "@/lib/ai-runtime/pmoIntent";
import { KNOWN_TASK_IDS } from "@/lib/tasks-engine/catalog";
import { readBodyCapped } from "@/lib/pmo/server/bodyCap";
import type { AiCommandResult } from "../command/types";

// Reads live local files; never cacheable.
export const dynamic = "force-dynamic";

const BODY_BYTES = 16 * 1024;

const intentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("whos_off"), when: z.string().max(120) }),
  z.object({ kind: z.literal("pmo_status"), topic: z.enum(PMO_TOPICS) }),
  z.object({ kind: z.literal("person_back"), name: z.string().min(1).max(120) }),
  z.object({
    kind: z.literal("person_shift"),
    name: z.string().min(1).max(120),
    when: z.string().max(120),
  }),
  z.object({ kind: z.literal("changes"), since: z.string().max(120) }),
  z.object({
    kind: z.literal("prepare_task"),
    taskId: z.enum(KNOWN_TASK_IDS as [string, ...string[]]),
  }),
]);

/**
 * POST /api/ai/pmo { kind: "whos_off" | "pmo_status" | "prepare_task", ... } ->
 * AiCommandResult. The command bar's no-model path for PMO questions it recognised
 * itself (src/lib/ai-runtime/pmoIntent.ts): the answer is worked out from the Staff
 * roster and the PMO to-dos by code, so it is instant and exact. A recognised
 * request to prepare a task comes back as an action for the bar to carry out.
 */
export async function POST(request: Request) {
  const read = await readBodyCapped(request, BODY_BYTES);
  const parsed = "body" in read ? intentSchema.safeParse(read.body) : null;
  if (!parsed?.success) {
    return NextResponse.json(
      {
        type: "error",
        kind: "malformed",
        message: "Malformed request.",
      } satisfies AiCommandResult,
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(
      (await answerPmoIntent(parsed.data, livePmoDeps)) satisfies AiCommandResult,
    );
  } catch (error) {
    console.error("[ai/pmo] failed:", error);
    return NextResponse.json({
      type: "error",
      kind: "unreachable",
      message: "Couldn't read the staff and to-do data just now.",
    } satisfies AiCommandResult);
  }
}
