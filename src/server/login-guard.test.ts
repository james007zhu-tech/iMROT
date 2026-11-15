import { describe, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
import { blocked, noteFailure, noteSuccess } from "./login-guard";

describe("sign-in throttle", () => {
  it("six wrong tries lock the account for the address they came from only, and it comes back after fifteen minutes", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 6; i++) noteFailure("MD@x.com", "10.0.0.5", t0 + i);
    expect(blocked("md@X.com", "10.0.0.5", t0 + 10)).toBe(true);
    expect(blocked("md@x.com", "10.0.0.99", t0 + 10)).toBe(false); // the owner on another device is not locked out
    expect(blocked("md@x.com", "10.0.0.5", t0 + 16 * 60_000)).toBe(false);
  });
  it("thirty wrong tries for one account from many addresses lock it everywhere", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 30; i++) noteFailure("boss@x.com", `11.0.0.${i}`, t0 + i);
    expect(blocked("boss@x.com", "11.0.9.9", t0 + 40)).toBe(true);
  });
  it("refuses an address that tries many accounts", () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 20; i++) noteFailure(`u${i}@x.com`, "9.9.9.9", t0 + i);
    expect(blocked("someone-else@x.com", "9.9.9.9", t0 + 30)).toBe(true);
    expect(blocked("someone-else@x.com", "8.8.8.8", t0 + 30)).toBe(false);
  });
  it("a correct sign-in clears the account's count", () => {
    const t0 = 9_000_000;
    for (let i = 0; i < 5; i++) noteFailure("ok@x.com", `7.0.0.${i}`, t0 + i);
    noteSuccess("ok@x.com");
    noteFailure("ok@x.com", "7.0.0.9", t0 + 9);
    expect(blocked("ok@x.com", "7.0.0.50", t0 + 10)).toBe(false);
  });
});
