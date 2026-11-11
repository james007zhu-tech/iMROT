/** Hands the requested path to server components (x-dcit-path): the app layout uses it to enforce 权限管理. */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-dcit-path", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}
export const config = { matcher: ["/((?!_next/|api/|brand/|uploads/|favicon|portal|faults|login).*)"] };
