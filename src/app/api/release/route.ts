import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 版本号和发版时间 (朱总 2026-11-15): the version is the moment this build was made (Bangkok time) plus the commit it
 * was built from — read once, from the build itself, so every restart with new code shows a new version.
 */
const release = (() => {
  try {
    const at = statSync(join(process.cwd(), ".next", "BUILD_ID")).mtime;
    const bkk = new Date(at.getTime() + 7 * 3600_000).toISOString();
    let sha = "";
    try {
      const head = readFileSync(join(process.cwd(), ".git", "HEAD"), "utf8").trim();
      sha = (head.startsWith("ref: ") ? readFileSync(join(process.cwd(), ".git", head.slice(5)), "utf8") : head).trim().slice(0, 7);
    } catch { /* no git folder: the time alone names the build */ }
    return { version: `${bkk.slice(2, 4)}${bkk.slice(5, 7)}${bkk.slice(8, 10)}.${bkk.slice(11, 13)}${bkk.slice(14, 16)}${sha ? `-${sha}` : ""}`, releasedAt: `${bkk.slice(0, 10)} ${bkk.slice(11, 16)}` };
  } catch { return { version: "dev", releasedAt: "" }; }
})();
/** Whether a release is about to restart the system (the operator leaves a flag file a few minutes before). No secrets. */
export async function GET() {
  return NextResponse.json({ soon: existsSync(join(process.cwd(), ".dev-ops", "maintenance")), ...release }, { headers: { "cache-control": "no-store" } });
}
