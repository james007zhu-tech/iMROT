import { describe, expect, it } from "vitest";
import { fmtDate, fmtMonth, payday, salaryChange } from "./salary-letter";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
describe("salary notice wording", () => {
  it("pays on the 5th of the next month, earlier over weekends and bank holidays (handbook §06)", () => {
    expect(payday(d("2026-11-01")).toISOString().slice(0, 10)).toBe("2026-12-04"); // 5 Dec = Father's Day (and a Saturday)
    expect(payday(d("2026-09-15")).toISOString().slice(0, 10)).toBe("2026-10-05"); // Monday
    expect(payday(d("2026-12-01")).toISOString().slice(0, 10)).toBe("2027-01-05"); // Tuesday
    expect(payday(d("2027-04-01")).toISOString().slice(0, 10)).toBe("2027-05-05"); // 4 May Coronation Day is the 4th — the 5th is fine
    expect(payday(d("2026-06-01")).toISOString().slice(0, 10)).toBe("2026-07-03"); // 5 Jul 2026 = Sunday → Friday 3rd
  });
  it("formats Thai dates in the Buddhist era, Chinese and English plainly", () => {
    expect(fmtDate.th(d("2026-11-01"))).toBe("1 พฤศจิกายน 2569");
    expect(fmtDate.zh(d("2026-11-01"))).toBe("2026年11月1日");
    expect(fmtDate.en(d("2026-12-04"))).toBe("4 December 2026");
    expect(fmtMonth.zh(d("2026-11-01"))).toBe("2026年11月");
  });
  it("describes the change", () => {
    expect(salaryChange(15000, 17000)).toEqual({ oldBase: 15000, newBase: 17000, diff: 2000, pct: "+13.3%" });
    expect(salaryChange(undefined, 17000)).toBeUndefined();
  });
});

describe("greeting in three languages", () => {
  it("splits the title from the name", async () => {
    const { salutationFor } = await import("./salary-letter");
    expect(salutationFor("Mr. Nattawut")).toEqual({ en: "Mr. Nattawut", th: "คุณ Nattawut", zh: "Nattawut 先生" });
    expect(salutationFor("ms somsri")).toEqual({ en: "Ms. somsri", th: "คุณ somsri", zh: "somsri 女士" });
    expect(salutationFor("Fluke")).toEqual({ en: "Fluke", th: "คุณ Fluke", zh: "Fluke" });
  });
});
