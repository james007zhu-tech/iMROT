/**
 * Sign-in throttle. The system is reachable from the internet, so guessing passwords must be slow: after 6 wrong
 * tries for one account from one address, 30 for one account, or 20 from one address, within 15 minutes, sign-in is refused until the window passes.
 * Kept in memory — one server process — which is enough to stop guessing; a restart clears it.
 */
import { headers } from "next/headers";

const WINDOW = 15 * 60_000, PER_ACCOUNT_HERE = 6, PER_ACCOUNT = 30, PER_ADDRESS = 20;
const fails = new Map<string, number[]>();

const recent = (key: string, now: number) => { const v = (fails.get(key) ?? []).filter((t) => now - t < WINDOW); if (v.length) fails.set(key, v); else fails.delete(key); return v; };

export async function clientAddress(): Promise<string> {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}
/** Whether the page was reached over HTTPS (behind the tunnel the app itself sees plain HTTP). */
export async function overHttps(): Promise<boolean> {
  const h = await headers();
  return h.get("x-forwarded-proto")?.split(",")[0].trim() === "https" || !!h.get("cf-visitor")?.includes("https");
}

/**
 * Six wrong tries for one account from one address lock that account for that address only — somebody else's wrong
 * tries (a test tool using the same account, 2026-11-15) no longer lock its owner out on another device. Thirty for
 * one account from anywhere, or twenty from one address, still stop a guesser.
 */
export function blocked(account: string, address: string, now = Date.now()): boolean {
  const a = account.toLowerCase();
  return recent(`ai:${a}|${address}`, now).length >= PER_ACCOUNT_HERE || recent(`a:${a}`, now).length >= PER_ACCOUNT || recent(`i:${address}`, now).length >= PER_ADDRESS;
}
export function noteFailure(account: string, address: string, now = Date.now()) {
  const a = account.toLowerCase();
  for (const key of [`ai:${a}|${address}`, `a:${a}`, `i:${address}`]) fails.set(key, [...recent(key, now), now]);
  if (fails.size > 5000) for (const k of fails.keys()) recent(k, now); // forget what has aged out
}
/** Tries left for this account from this address before the lock (shown after a wrong password). */
export function triesLeft(account: string, address: string, now = Date.now()): number {
  return Math.max(0, PER_ACCOUNT_HERE - recent(`ai:${account.toLowerCase()}|${address}`, now).length);
}
export function noteSuccess(account: string) { const a = account.toLowerCase(); for (const k of [...fails.keys()]) if (k === `a:${a}` || k.startsWith(`ai:${a}|`)) fails.delete(k); }
