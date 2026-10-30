// Plumbing for the /api/platform routes: the same-origin check (reads too, since they
// return the user's data), the { ok, reason } envelope and file downloads.
import { NextResponse } from "next/server";
import { guardApiRequest } from "../security/apiGuard.ts";
import { ZipError } from "./zip.ts";

export async function gated(
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const verdict = guardApiRequest(request, { checkReads: true });
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 403 });
  }
  try {
    return await run();
  } catch (error) {
    if (error instanceof ZipError) {
      return NextResponse.json({ ok: false, reason: error.message }, { status: 400 });
    }
    console.error("[platform] request failed:", error);
    return NextResponse.json(
      { ok: false, reason: "Something went wrong on this computer. Try again." },
      { status: 500 },
    );
  }
}

export function download(
  data: Uint8Array | string,
  filename: string,
  type: string,
): Response {
  const body = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** yyyy-mm-dd-hhmm for file names. */
export function stampForName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}
