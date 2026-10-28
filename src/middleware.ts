import { NextResponse, type NextRequest } from "next/server";
import { guardApiRequest } from "./lib/security/apiGuard";

// One guard for every /api route: loopback Host only, and no cross-origin writes.
export function middleware(request: NextRequest) {
  const verdict = guardApiRequest(request);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
