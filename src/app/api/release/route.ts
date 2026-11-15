import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
/** Whether a release is about to restart the system (the operator leaves a flag file a few minutes before). No secrets. */
export async function GET() {
  return NextResponse.json({ soon: existsSync(join(process.cwd(), ".dev-ops", "maintenance")) }, { headers: { "cache-control": "no-store" } });
}
