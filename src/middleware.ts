/**
 * Before any page of the app: hand the requested path to server components (x-dcit-path), and ask the gate whether this
 * person may open it (需求清单 v4 V4-P0-01). A refusal ends here — 403 and the 无权限 page — so the refused page's code
 * never runs and none of its data can sit in the HTML or the RSC payload. Server actions posted to a refused page are
 * refused the same way.
 */
import { NextResponse, type NextRequest } from "next/server";
import { gateKey } from "@/lib/gate-key";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname + req.nextUrl.search;
  const headers = new Headers(req.headers);
  headers.set("x-dcit-path", path);
  if (req.nextUrl.pathname === "/no-access") return NextResponse.rewrite(req.nextUrl, { status: 403, request: { headers } }); // every refusal answers 403 (派修单 v2 第 9 条)
  if (req.cookies.has("dcit_session")) {
    try {
      const r = await fetch(`http://127.0.0.1:${process.env.PORT || "3000"}/api/gate?path=${encodeURIComponent(path)}`, { headers: { cookie: req.headers.get("cookie") ?? "", "x-dcit-gate": gateKey() }, cache: "no-store" });
      const g = (await r.json()) as { ok?: boolean; roles?: string; scope?: boolean };
      if (r.ok && g.ok === false) {
        const to = req.nextUrl.clone(); to.pathname = "/no-access"; to.search = g.scope ? "?scope=1" : `?roles=${encodeURIComponent(g.roles ?? "MD")}`;
        headers.set("x-dcit-path", "/no-access");
        return NextResponse.rewrite(to, { status: 403, request: { headers } });
      }
    } catch (e) { console.error("[gate] could not be asked:", (e as Error).message); /* the template and the pages' own checks still stand */ }
  }
  return NextResponse.next({ request: { headers } });
}
export const config = { matcher: ["/((?!_next/|api/|brand/|uploads/|favicon|portal|faults|login|forgot|reset).*)"] };
