import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fillDocx, fillXml, listPlaceholders } from "./fill";
import { readZip } from "./zip";

describe("docx fill", () => {
  it("replaces scalars, consumes arrays in order, escapes XML, breaks lines", () => {
    const xml = `<w:t>[[A]]</w:t><w:t>[[B]]</w:t><w:t>[[B]]</w:t><w:t>[[C]]</w:t>`;
    const r = fillXml(xml, { A: "x<y", B: ["1", "2"], C: "l1\nl2" });
    expect(r.xml).toBe(`<w:t>x&lt;y</w:t><w:t>1</w:t><w:t>2</w:t><w:t>l1</w:t><w:br/><w:t xml:space="preserve">l2</w:t>`);
    expect(r.unfilled).toEqual([]);
  });
  it("reports unfilled placeholders and blanks them", () => {
    const r = fillXml(`<w:t>[[Z]]</w:t>`, {});
    expect(r.xml).toBe("<w:t></w:t>");
    expect(r.unfilled).toEqual(["Z"]);
  });
  it("round-trips the real 08 template", () => {
    const tpl = readFileSync("templates/word/08_Diagnostic_Report.docx");
    const keys = listPlaceholders(tpl);
    expect(keys).toContain("FINDINGS_CAUSE");
    const values = Object.fromEntries(keys.map((k) => [k, k]));
    const { docx, unfilled } = fillDocx(tpl, values);
    expect(unfilled).toEqual([]);
    const doc = readZip(docx).find((e) => e.name === "word/document.xml")!.data.toString();
    expect(doc).not.toContain("[[");
    expect(doc).toContain("FINDINGS_CAUSE");
  });
});
