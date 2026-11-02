import { NextResponse } from "next/server";
import { sessionContactId, sessionEmployeeCode } from "@/server/auth";

/** For API routes: a 401 response when nobody is signed in, else null. Portal contacts count as signed in when `allowPortal`. */
export async function requireSession(allowPortal = false): Promise<NextResponse | null> {
  if (await sessionEmployeeCode()) return null;
  if (allowPortal && (await sessionContactId())) return null;
  return NextResponse.json({ error: "not signed in" }, { status: 401 });
}
