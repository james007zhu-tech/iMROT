/**
 * 调薪通知单 (salary adjustment notice) — date and amount wording for the trilingual letter (2026-11-09).
 * Payday follows the Employee Handbook §06: pay by calendar month, credited on or before the 5th of the next month;
 * a weekend or bank holiday moves it to the previous bank working day.
 */

/** Fixed-date Thai bank holidays (MM-DD). Lunar holidays (Makha / Visakha / Asarnha Bucha) move every year — not listed. */
const TH_FIXED_HOLIDAYS = new Set(["01-01", "04-06", "04-13", "04-14", "04-15", "05-01", "05-04", "06-03", "07-28", "08-12", "10-13", "10-23", "12-05", "12-10", "12-31"]);

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** Last bank working day on or before the 5th of the month after `month` (a UTC midnight date). */
export function payday(month: Date): Date {
  let d = utc(month.getUTCFullYear(), month.getUTCMonth() + 1, 5);
  for (let i = 0; i < 10; i++) {
    const dow = d.getUTCDay(), md = d.toISOString().slice(5, 10);
    if (dow !== 0 && dow !== 6 && !TH_FIXED_HOLIDAYS.has(md)) return d;
    d = new Date(d.getTime() - 86_400_000);
  }
  return d;
}

export const fmtDate = {
  en: (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d),
  th: (d: Date) => new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d),
  zh: (d: Date) => `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`,
};
export const fmtMonth = {
  en: (d: Date) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d),
  th: (d: Date) => new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { month: "long", year: "numeric", timeZone: "UTC" }).format(d),
  zh: (d: Date) => `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月`,
};

export const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface LetterDetails {
  salutation?: string; /// how the letter greets the person — "Mr. Nattawut", or a nickname ("Fluke")
  employeeNo?: string; /// the employee number printed on the letter when it differs from the ETH code (e.g. the HR number "ETH26002")
  position?: string; /// job title on the letter (defaults to the employee file)
  praiseTh?: string; praiseEn?: string; praiseZh?: string; /// the personal thanks — what this person did
}

/** The change itself: old → new base, amount and percentage. `old` undefined = first salary record (no letter). */
export function salaryChange(oldBase: number | undefined, newBase: number) {
  if (oldBase === undefined || oldBase <= 0) return undefined;
  const diff = Math.round((newBase - oldBase) * 100) / 100;
  return { oldBase, newBase, diff, pct: `${diff >= 0 ? "+" : ""}${((diff / oldBase) * 100).toFixed(1)}%` };
}

/**
 * One greeting, three languages: "Mr. Nattawut" → Dear Mr. Nattawut · เรียน คุณ Nattawut · Nattawut 先生.
 * Thai uses คุณ for everyone (no English title); Chinese puts 先生 / 女士 after the name; without a title the text is used as given.
 */
export function salutationFor(s: string): { en: string; th: string; zh: string } {
  const t = s.trim().replace(/\s+/g, " ");
  const m = /^(mr|mrs|ms|miss|dr)\.?\s+(.+)$/i.exec(t);
  if (!m) return { en: t, th: `คุณ ${t}`, zh: t };
  const title = m[1].toLowerCase(), given = m[2];
  const en = `${title === "miss" ? "Miss" : title[0].toUpperCase() + title.slice(1)}.`.replace("Miss.", "Miss") + ` ${given}`;
  const zh = title === "mr" ? `${given} 先生` : title === "dr" ? `${given} 博士` : `${given} 女士`;
  return { en, th: `คุณ ${given}`, zh };
}
