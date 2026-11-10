/**
 * Shared plumbing for the public read-only API (/api/public/v1): no login, a per-IP limit of 60 requests a minute,
 * 10-minute caching, open CORS. Handlers only call the public queries in src/server/knowledge.ts, which read the
 * published table and nothing else.
 */
import { NextResponse } from "next/server";

const WINDOW_MS = 60_000, LIMIT = 60;
const hits = new Map<string, { n: number; since: number }>();

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** true when this request is over the limit (in-memory, per process — enough for one server). */
export function overLimit(ip: string, now = Date.now()): boolean {
  const h = hits.get(ip);
  if (!h || now - h.since > WINDOW_MS) { hits.set(ip, { n: 1, since: now }); return false; }
  h.n++;
  if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.since > WINDOW_MS) hits.delete(k);
  return h.n > LIMIT;
}

const HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Cache-Control": "public, max-age=600, s-maxage=600" };

export async function publicJson(req: Request, fn: () => Promise<unknown>): Promise<NextResponse> {
  if (overLimit(clientIp(req))) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...HEADERS, "Retry-After": "60", "Cache-Control": "no-store" } });
  try {
    const body = await fn();
    if (body === null) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: HEADERS });
    return NextResponse.json(body, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "UNAVAILABLE" }, { status: 503, headers: { ...HEADERS, "Cache-Control": "no-store" } });
  }
}

export function options() { return new NextResponse(null, { status: 204, headers: HEADERS }); }

export const langOf = (req: Request) => new URL(req.url).searchParams.get("lang") ?? "en";
