import { localIso } from "@/lib/dates";
/** "中国银行价 2026-11-17" / "财务手工价 2026-11-17" — what every document says about the rate it was booked at. */
export function fxMark(u: (k: string) => string, source?: string | null, date?: Date | null, by?: string | null) {
  return `${u(source === "MANUAL" ? "fxManual" : "fxBoc")}${date ? ` ${localIso(date)!.slice(0, 10)}` : ""}${source === "MANUAL" && by ? ` · ${by}` : ""}`; // 手动 + 操作人 + 时间
}
