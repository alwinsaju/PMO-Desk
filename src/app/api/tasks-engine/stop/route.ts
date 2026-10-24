import { NextResponse } from "next/server";
import { stopDesktopEngine } from "../shared";

export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.AI_OS_DESKTOP_MODE !== "1") {
    return NextResponse.json(
      { ok: false, reason: "Desktop lifecycle management is not active." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, stopped: await stopDesktopEngine() });
}
