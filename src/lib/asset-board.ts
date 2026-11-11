/** 设备档案看板: age bands by installation date. Pure, so the page and the tests agree on the edges. */
export const AGE_BANDS = ["lt3", "3to5", "5to10", "gt10", "unknown"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

const YEAR = 365.25 * 24 * 3600 * 1000;
export function ageBand(installedAt: Date | null | undefined, now = new Date()): AgeBand {
  if (!installedAt) return "unknown";
  const y = (now.getTime() - installedAt.getTime()) / YEAR;
  return y < 3 ? "lt3" : y < 5 ? "3to5" : y < 10 ? "5to10" : "gt10";
}

/** The installation-date window of a band, for the list filter. */
export function ageRange(band: string, now = new Date()): { gte?: Date; lt?: Date } | null | undefined {
  const back = (y: number) => new Date(now.getTime() - y * YEAR);
  if (band === "lt3") return { gte: back(3) };
  if (band === "3to5") return { gte: back(5), lt: back(3) };
  if (band === "5to10") return { gte: back(10), lt: back(5) };
  if (band === "gt10") return { lt: back(10) };
  if (band === "unknown") return null; // installedAt is null
  return undefined; // no filter
}
