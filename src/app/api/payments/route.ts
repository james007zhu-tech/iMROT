import { forgetNotices } from "@/server/notify";
import { NextResponse } from "next/server";
import { errorCode, errorStatus } from "@/lib/errors";
import { bodyAsSession, jsonForSession, requireSession } from "@/server/api-auth";
import { requestReceipt } from "@/server/collect";

export async function POST(req: Request) {
  setTimeout(forgetNotices, 1500); // the bell recounts after this change (2026-11-19)
  const denied = await requireSession(); if (denied) return denied;
  try {
    // 收款三步 (2026-11-18): the API asks; the MD approves and finance confirms with the slip on the order's payment page
    const b = await bodyAsSession(req);
    return jsonForSession(await requestReceipt({ invoiceNo: String(b.invoiceNo), actorCode: b.actorCode, account: String(b.account ?? ""), cashAmount: Number(b.paidAmount ?? 0), whtAmount: Number(b.whtAmount ?? 0), whtCertRef: b.whtCertRef, receivedOn: new Date(b.paidAt ?? Date.now()) }), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: errorStatus(e) });
  }
}
