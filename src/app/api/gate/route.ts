/**
 * 页面门 (需求清单 v4 V4-P0-01). The middleware asks here before a page of the app is rendered: may this person open
 * this address? A refusal is answered by the middleware itself (403 + the 无权限 page) — the page's code never runs, so
 * nothing it would have fetched can travel in the HTML or the RSC payload. Only the app itself may ask (loopback + key).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionEmployeeCode } from "@/server/auth";
import { hiddenFor, menuKeyOf, ownersOf } from "@/server/perm";
import { hasRole, pathAllows } from "@/lib/caps";
import { gateKey } from "@/lib/gate-key";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (req.headers.get("x-dcit-gate") !== gateKey()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "/";
  const code = await sessionEmployeeCode(); // the middleware forwards the browser's cookies
  if (!code) return NextResponse.json({ ok: true, anonymous: true }); // the page itself sends them to /login
  const me = await prisma.employee.findUnique({ where: { code }, select: { role: true, extraRoles: true, approver: true, active: true } });
  if (!me?.active) return NextResponse.json({ ok: true, anonymous: true });
  if (hasRole(me, "MD")) return NextResponse.json({ ok: true });
  const hidden = await hiddenFor(me);
  const refused = hidden.has(menuKeyOf(path) ?? "") || !pathAllows(me, path.split("?")[0]);
  return NextResponse.json(refused ? { ok: false, roles: ownersOf(path) } : { ok: true });
}
