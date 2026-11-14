import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/** 朱总 2026-11-14: the registered Thai name is ตูเฉิง. A stray tone mark (ตู้เฉิง) once sat in the master data and all 35 templates. */
const WRONG = "ตู้เฉิง";
describe("the company's Thai name", () => {
  it("is spelled ตูเฉิง in the master data", () => {
    const m = JSON.parse(readFileSync("docs/brand/company_master.json", "utf8"));
    expect(m.name_th).toContain("ตูเฉิง");
    expect(m.name_th).not.toContain(WRONG);
  });
  it("is never misspelled in a print template", () => {
    const dir = "templates/word";
    const bad = readdirSync(dir).filter((f) => f.endsWith(".docx")).filter((f) => execFileSync("unzip", ["-p", path.join(dir, f), "word/*.xml"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8").includes(WRONG));
    expect(bad).toEqual([]);
  });
});
