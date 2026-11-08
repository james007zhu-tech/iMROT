import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A <form> whose action is a server function must not set encType or method: React sets them itself (multipart
 * when needed). Next dev shows a full-screen "Console Error" for it (seen on /assets/[code], 2026-11-08); the
 * production build only logs it, so the browser test never saw it. This scans the pages instead.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("forms with server-function actions", () => {
  it("never set encType or method", () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname, "..", "app"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<form\b[^>]*>/g)) {
        const tag = m[0];
        if (/\baction=\{/.test(tag) && /\b(encType|method)=/.test(tag)) bad.push(`${f}: ${tag.slice(0, 120)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
