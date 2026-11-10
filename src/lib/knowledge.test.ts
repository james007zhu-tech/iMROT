import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WIDE_COLUMNS, copiedFrom, isBlocking, splitList, wordingIssues, codeFits, kindFrom, manualLabel, manualParts, mustStopFrom, patternError, pdfPage, pickLang, publicBlocker, publicOnly, publicSearchText, rankHits, slugify, splitName, statusAfterEdit } from "./knowledge";

describe("设备知识库 (2026-11-10)", () => {
  it("reads Grok's ACS880 export", () => {
    expect(splitName("接地漏电（Earth leakage）")).toEqual({ zh: "接地漏电", en: "Earth leakage" });
    expect(splitName("过电流")).toEqual({ zh: "过电流" });
    expect(pdfPage("ACS880 … Rev V；_manuals/acs880_V.pdf PDF519（印刷页同PDF）")).toBe(519);
    expect(manualParts("ACS880 primary control program Firmware manual 3AUA0000085967 Rev V (2020-08-21)")).toEqual({ title: "ACS880 primary control program Firmware manual 3AUA0000085967 Rev V", docId: "3AUA0000085967", revision: "V", date: "2020-08-21" });
    expect(kindFrom("warning", "事件警告")).toBe("EVENT");
    expect(kindFrom("warning", "警告")).toBe("WARNING");
    expect(kindFrom("fault", "故障")).toBe("FAULT");
  });
  it("待核实 and anything unclear never reads as 'need not stop'", () => {
    expect(mustStopFrom("待核实")).toBe("UNVERIFIED");
    expect(mustStopFrom("")).toBe("UNVERIFIED");
    expect(mustStopFrom("maybe")).toBe("UNVERIFIED");
    expect(mustStopFrom("是")).toBe("YES");
    expect(mustStopFrom("否")).toBe("NO");
  });
  it("series code patterns", () => {
    expect(codeFits("^[0-9A-F]{4}$", "a2b3")).toBe(true);
    expect(codeFits("^[0-9A-F]{4}$", "F0001")).toBe(false);
    expect(codeFits(null, "anything")).toBe(true);
    expect(patternError("^[FA]\\d{5}$")).toBeNull();
    expect(patternError("^[FA")).toBe("INVALID_CODE_PATTERN");
    expect(slugify("SINAMICS S120")).toBe("sinamics-s120");
  });
  it("review: only approved codes with a title go public; editing public words re-opens review", () => {
    expect(publicBlocker({ status: "REVIEW", publicText: { zh: { title: "过电流" } } })).toBe("PUBLIC_NEEDS_APPROVED");
    expect(publicBlocker({ status: "APPROVED", publicText: { zh: { meaning: "x" } } })).toBe("PUBLIC_NEEDS_TITLE");
    expect(publicBlocker({ status: "APPROVED", publicText: { en: { title: "Overcurrent" } } })).toBeNull();
    expect(statusAfterEdit("APPROVED", true)).toBe("REVIEW");
    expect(statusAfterEdit("APPROVED", false)).toBe("APPROVED");
  });
  it("one language per page, with the fallback order en → th → zh", () => {
    const t = { zh: { title: "接地漏电", remedy: "自动清除" }, en: { title: "Earth leakage" } };
    expect(pickLang(t, "zh")).toEqual({ lang: "zh", others: ["en"], title: "接地漏电", remedy: "自动清除" });
    expect(pickLang(t, "th")).toEqual({ lang: "en", others: ["zh"], title: "Earth leakage" }); // no Chinese remedy under an English title
    expect(pickLang({ zh: { meaning: "no title" } }, "zh")).toBeNull();
  });
  it("only public keys leave, and public search sees only public words", () => {
    const leaked = { en: { title: "Overcurrent", internalNotes: "cost 1200", manual: "ABB text" } } as never;
    expect(publicOnly(leaked)).toEqual({ en: { title: "Overcurrent" } });
    const s = publicSearchText("2310", "ABB", "ACS880", { en: { title: "Overcurrent", checks: ["Measure insulation"] } });
    expect(s).toContain("overcurrent");
    expect(s).toContain("measure insulation");
  });
  it("search ranks the exact code, then codes ending with it, then words", () => {
    const rows = [{ codeKey: "f30001", searchText: "overcurrent" }, { codeKey: "30001", searchText: "x" }, { codeKey: "2310", searchText: "see 30001" }];
    expect(rankHits(rows, "30001").map((r) => r.codeKey)).toEqual(["30001", "f30001", "2310"]);
    expect(rankHits(rows, "  ")).toEqual([]);
  });
  it("the manual is named once, revision only when the title lacks it", () => {
    expect(manualLabel({ title: "ACS880 Firmware manual 3AUA0000085967 Rev V", revision: "V", date: "2020-08-21" })).toBe("ACS880 Firmware manual 3AUA0000085967 Rev V · 2020-08-21");
    expect(manualLabel({ title: "S120 List Manual", revision: "07/2016" }, false)).toBe("S120 List Manual · Rev 07/2016");
    expect(manualLabel(null)).toBe("");
  });
  it("the wide template's header is the importer's column list", () => {
    const head = readFileSync(new URL("../../docs/knowledge/fault-code-wide-template.csv", import.meta.url), "utf8").replace(/^\uFEFF/, "").split("\n")[0];
    expect(head.split(",")).toEqual([...WIDE_COLUMNS]);
    expect(splitList(" 2330 | 2340 |")).toEqual(["2330", "2340"]);
  });
  it("wording rules: copied manual text, wrong script, page refs, vendor contact, missing safety", () => {
    const manual = { en: { actions: "Check motor load. Check acceleration times in parameter group 23 Speed reference ramp." } };
    const good = { zh: { title: "过电流", checks: ["断电并等待放电后，测量电机绝缘"], safety: "开盖前等待 5 分钟" }, en: { title: "Overcurrent", checks: ["With power off, measure the motor insulation"] }, th: { title: "กระแสเกิน", checks: ["ตัดไฟแล้ววัดฉนวนมอเตอร์"] } };
    expect(wordingIssues({ code: "2310", kind: "FAULT", publicText: good, manualText: manual })).toEqual([]);
    const copied = { ...good, en: { title: "Overcurrent", checks: ["Check acceleration times in parameter group 23 Speed reference ramp"] } };
    expect(wordingIssues({ code: "2310", kind: "FAULT", publicText: copied, manualText: manual })).toContain("COPIED_FROM_MANUAL:en.checks");
    expect(copiedFrom("加速时间太短，或负载在运行中突然卡住", "电机过载", "zh")).toBe(false);
    const bad = { zh: { title: "2310 过电流 กระแส", remedy: "总述见PDF497", prepare: "①完整代码" }, en: { title: "Overcurrent", checks: ["Contact your local ABB representative"] } };
    const issues = wordingIssues({ code: "2310", kind: "FAULT", publicText: bad });
    for (const i of ["WRONG_LANG:zh.title", "TITLE_HAS_CODE:zh", "PAGE_REF:zh.remedy", "CIRCLED_NUMBERS:zh.prepare", "CONTACT_VENDOR:en.checks", "MISSING_LANG:th", "LIST_MISMATCH:checks"]) expect(issues).toContain(i);
    expect(issues.filter(isBlocking)).toEqual(["WRONG_LANG:zh.title"]);
    expect(wordingIssues({ code: "1", kind: "FAULT", publicText: { en: { title: "X", checks: ["Measure the insulation"] } } })).toContain("SAFETY_MISSING");
    expect(wordingIssues({ code: "1", kind: "FAULT", publicText: {} })).toContain("NO_TITLE");
  });
});
