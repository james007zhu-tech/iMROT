/**
 * 页面门 (需求清单 v4 V4-P0-01). The middleware asks here before a page of the app is rendered: may this person open
 * this address? A refusal is answered by the middleware itself (403 + the 无权限 page) — the page's code never runs, so
 * nothing it would have fetched can travel in the HTML or the RSC payload. Only the app itself may ask (loopback + key).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionEmployeeCode } from "@/server/auth";
import { hiddenFor, menuKeyOf, ownersOf } from "@/server/perm";
import { can, hasRole, pathAllows } from "@/lib/caps";
import { assetScope, customerScope, mayOpenOrder } from "@/server/scope";
import { gateKey } from "@/lib/gate-key";
import { DOC_PLACES } from "@/lib/doc-center";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (req.headers.get("x-dcit-gate") !== gateKey()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "/";
  const code = await sessionEmployeeCode(); // the middleware forwards the browser's cookies
  if (!code) return NextResponse.json({ ok: true, anonymous: true }); // the page itself sends them to /login
  const me = await prisma.employee.findUnique({ where: { code }, select: { id: true, code: true, role: true, extraRoles: true, approver: true, active: true } });
  if (!me?.active) return NextResponse.json({ ok: true, anonymous: true });
  if (hasRole(me, "MD")) return NextResponse.json({ ok: true });
  const hidden = await hiddenFor(me);
  // /documents/new?type=IB only forwards to the form of that document: it is judged as that form
  const fwd = path.startsWith("/documents/new") ? DOC_PLACES[url.searchParams.get("path")?.match(/[?&]type=([A-Z]+)/)?.[1] ?? ""]?.newHref : undefined;
  const refused = hidden.has(menuKeyOf(path) ?? "") || !pathAllows(me, path.split("?")[0]) || (!!fwd && (hidden.has(menuKeyOf(fwd) ?? "") || !pathAllows(me, fwd.split("?")[0])));
  if (refused) return NextResponse.json({ ok: false, roles: ownersOf(fwd && pathAllows(me, path.split("?")[0]) ? fwd : path) }); // refused as the form it forwards to: name that form's roles (N-27)
  // 数据范围 and 他人档案 are refused here too, before the page runs — a refusal made inside a page that has begun to
  // stream answers 200 (派修单 v3 第 7 条: every refusal is 403).
  const p = path.split("?")[0], seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  try {
    if (seg[0] === "people" && seg[1] && /^E[A-Z]{2}\d+$/i.test(seg[1]) && !(can.staff(me) || me.code === seg[1])) return NextResponse.json({ ok: false, roles: "MD / HR" });
    if (seg[0] === "service-orders" && seg[1] && seg[1] !== "new") { const o = await prisma.serviceOrder.findUnique({ where: { no: seg[1] }, select: { id: true } }); if (o && !(await mayOpenOrder(me as never, o.id))) return NextResponse.json({ ok: false, scope: true }); }
    if (seg[0] === "customers" && seg[1] && seg[1] !== "new" && !(await prisma.customer.count({ where: { AND: [{ code: seg[1] }, await customerScope(me as never)] } })) && (await prisma.customer.count({ where: { code: seg[1] } }))) return NextResponse.json({ ok: false, scope: true });
    if (seg[0] === "assets" && seg[1] && seg[1] !== "new" && !(await prisma.asset.count({ where: { AND: [{ code: seg[1] }, await assetScope(me as never)] } })) && (await prisma.asset.count({ where: { code: seg[1] } }))) return NextResponse.json({ ok: false, scope: true });
  } catch (e) { console.error("[gate] scope check:", (e as Error).message); }
  return NextResponse.json({ ok: true });
}
