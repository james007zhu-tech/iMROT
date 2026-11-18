/**
 * 页面门 (需求清单 v4 V4-P0-01). The middleware asks here before a page of the app is rendered: may this person open
 * this address? A refusal is answered by the middleware itself (403 + the 无权限 page) — the page's code never runs, so
 * nothing it would have fetched can travel in the HTML or the RSC payload. Only the app itself may ask (loopback + key).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionEmployeeCode } from "@/server/auth";
import { gateFor } from "@/server/gate";
import { gateKey } from "@/lib/gate-key";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (req.headers.get("x-dcit-gate") !== gateKey()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "/";
  const code = await sessionEmployeeCode(); // the middleware forwards the browser's cookies
  if (!code) return NextResponse.json({ ok: true, anonymous: true }); // the page itself sends them to /login
  const me = await prisma.employee.findUnique({ where: { code }, select: { id: true, code: true, role: true, extraRoles: true, approver: true, active: true } });
  if (!me?.active) return NextResponse.json({ ok: true, anonymous: true });
  const g = await gateFor(me, path);
  return NextResponse.json(g);
}
