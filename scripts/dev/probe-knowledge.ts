/**
 * 设备知识库 end to end against a real database (朱总 2026-11-10; architecture doc "设备知识库架构方案", mockup
 * docs/mockups/equipment-knowledge-v0.1.html): import a Grok-shaped export (synthetic — the real ACS880 file is ABB
 * text and stays out of this public repo) → preview → commit as 待审核 → nothing public before approval → approve →
 * make public → publish → the public table holds our words and the manual reference only (no manual text, no
 * internal notes, no checksum) → search by full code and by its tail → re-import never overwrites approved codes →
 * editing public words re-opens review while the last approved version stays online → retire takes it down.
 *   npx tsx scripts/dev/probe-knowledge.ts
 */
import { prisma } from "../../src/lib/db";
import { importFaultCodes, publicCode, publicCodes, publicSearch, publishKnowledge, reviewCodes, saveFaultCode } from "../../src/server/knowledge";
import type { PublicText } from "../../src/lib/knowledge";

const MD = "ETH2611001";
const stamp = Date.now().toString(36).toUpperCase();
const BRAND = `PRB${stamp}`, SERIES = `KX${stamp}`;
const SECRET = `MANUAL-TEXT-${stamp}`, NOTE = `INTERNAL-${stamp}`, SHA = "f".repeat(64);
let fails = 0;
const check = (ok: unknown, what: string) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) fails++; };

const grok = JSON.stringify({
  meta: { brand: BRAND, series: SERIES, manual: `${SERIES} Firmware manual 3AUA0000000001 Rev B (2024-01-31)`, official_url: "https://example.com/manual.pdf", manual_sha256: SHA },
  codes: [
    { code: "2310", name_zh: "过电流（Overcurrent）", type: "fault", category_zh: "故障", meaning_en: SECRET, first_checks_en: SECRET, meaning_th: SECRET, must_stop: "待核实", reset_zh: "原因消除后复位", ask_first_zh: "完整代码是什么？", source: "manual.pdf PDF519", note_zh: NOTE, common_parts_zh: NOTE, status: "已核实" },
    { code: "A2B3", name_zh: "接地漏电（Earth leakage）", type: "warning", category_zh: "警告", meaning_en: SECRET, must_stop: "待核实", source: "manual.pdf PDF501" },
    { code: "B5A0", name_zh: "停止事件（Stop event）", type: "warning", category_zh: "事件警告", meaning_en: SECRET, must_stop: "否", source: "manual.pdf PDF600" },
  ],
});

async function main() {
  const file = { fileName: `${BRAND}.json`, text: grok, actorCode: MD, createMissing: true, categoryCode: "VFD" };
  const dry = await importFaultCodes({ ...file, dryRun: true });
  check(dry.preview.rows.length === 3 && dry.preview.rows.every((r) => r.action === "create"), "preview: three new codes, nothing written");
  check(dry.preview.missing.length === 1 && !(await prisma.brand.findFirst({ where: { name: BRAND } })), "preview names the missing brand/series without creating it");
  check(dry.preview.rows.filter((r) => r.issues.includes("MUST_STOP_UNVERIFIED")).length === 2, "待核实 flagged on the two unverified codes");

  await importFaultCodes({ ...file, dryRun: false });
  const series = await prisma.series.findFirstOrThrow({ where: { code: SERIES, brand: { name: BRAND } }, include: { brand: true } });
  check(series.codePattern === "^[0-9A-F]{4}$" && /A 开头：警告/.test(series.codeRule ?? "") && series.categoryCode === "VFD", "series created with pattern, rule and category from the data");
  const codes = await prisma.faultCode.findMany({ where: { seriesId: series.id }, orderBy: { code: "asc" } });
  check(codes.length === 3 && codes.every((c) => c.status === "REVIEW" && c.origin === "IMPORT" && !c.isPublic), "imported codes wait for review, internal");
  check(codes.find((c) => c.code === "B5A0")?.kind === "EVENT" && codes.find((c) => c.code === "A2B3")?.kind === "WARNING", "kinds: B… event, A… warning");
  check(codes.find((c) => c.code === "2310")?.mustStop === "UNVERIFIED" && codes.find((c) => c.code === "B5A0")?.mustStop === "NO", "must-stop: 待核实 stays unverified");
  const c2310 = codes.find((c) => c.code === "2310")!;
  check(JSON.stringify(c2310.manualText).includes(SECRET) && !JSON.stringify(c2310.publicText).includes(SECRET), "manual text kept internally, never in the public text");

  const slugB = series.brand.slug!, slugS = series.slug!;
  await publishKnowledge(MD);
  check(!(await publicCode(slugB, slugS, "2310", "zh")), "nothing public before approval");
  const notYet = await reviewCodes({ ids: [c2310.id], action: "public", actorCode: MD }).catch((e: Error) => e.message);
  check(!(await prisma.faultCode.findUniqueOrThrow({ where: { id: c2310.id } })).isPublic, `an unapproved code cannot be made public (${typeof notYet === "string" ? notYet : "skipped"})`);

  const ids = codes.filter((c) => c.code !== "B5A0").map((c) => c.id);
  await reviewCodes({ ids, action: "approve", actorCode: MD });
  await reviewCodes({ ids, action: "public", actorCode: MD });
  const run = await publishKnowledge(MD);
  check(run.added >= 2, `publish added ${run.added}`);

  const pub = await prisma.publishedFaultCode.findMany({ where: { brandSlug: slugB } });
  const blob = JSON.stringify(pub);
  check(pub.length === 2, "two codes published, the unapproved event stays home");
  check(!blob.includes(SECRET) && !blob.includes(NOTE) && !blob.includes(SHA), "published rows carry no manual text, internal notes or checksum");
  const v = await publicCode(slugB, slugS, "2310", "th");
  check(v?.title === "Overcurrent" && v.lang === "en" && v.others.includes("zh") && v.remedy === null, "Thai visitor gets English, one language per page");
  check(v?.mustStop === "UNVERIFIED" && (v?.source as { page?: number })?.page === 519, "public view: unverified must-stop, manual page 519");
  const zh = await publicCode(slugB, slugS, "2310", "zh");
  check(zh?.title === "过电流" && zh.remedy === "原因消除后复位" && zh.prepare === "完整代码是什么？", "Chinese visitor gets our words");
  check((await publicSearch("2310", { lang: "en", brand: slugB })).items[0]?.code === "2310", "search by full code");
  check((await publicSearch("310", { lang: "en", brand: slugB })).items[0]?.code === "2310", "search by the tail of a code");
  check((await publicSearch(SECRET.toLowerCase(), { lang: "en" })).items.length === 0, "manual words are not searchable publicly");
  check((await publicCodes(slugB, slugS, { kind: "WARNING", lang: "zh" })).items.map((i) => i.code).join() === "A2B3", "list filtered by kind");

  const again = await importFaultCodes({ ...file, dryRun: false });
  check(again.preview.rows.filter((r) => r.action === "skip").length === 2 && again.preview.rows.find((r) => r.code === "B5A0")?.action === "update", "re-import: approved codes skipped, the one in review updated");

  const pt = (await prisma.faultCode.findUniqueOrThrow({ where: { id: c2310.id } })).publicText as PublicText;
  await saveFaultCode(c2310.id, { seriesId: series.id, code: "2310", kind: "FAULT", mustStop: "UNVERIFIED", publicText: { ...pt, zh: { ...pt.zh, meaning: "输出电流超过跳闸限值" } } }, MD);
  const edited = await prisma.faultCode.findUniqueOrThrow({ where: { id: c2310.id } });
  check(edited.status === "REVIEW" && edited.version === 2, "editing public words of an approved code → review, version 2");
  await publishKnowledge(MD);
  const live = await publicCode(slugB, slugS, "2310", "zh");
  check(live && !live.meaning, "while in review the last approved version stays online");
  await reviewCodes({ ids: [c2310.id], action: "approve", actorCode: MD });
  const r2 = await publishKnowledge(MD);
  check(r2.updated >= 1 && (await publicCode(slugB, slugS, "2310", "zh"))?.meaning === "输出电流超过跳闸限值", "approved again → publish updates the page");

  await reviewCodes({ ids: [c2310.id], action: "retire", actorCode: MD });
  const r3 = await publishKnowledge(MD);
  check(r3.removed >= 1 && !(await publicCode(slugB, slugS, "2310", "zh")), "retired → taken down at the next publish");

  // a series hidden from the public site leaves it at the next publish — and the probe leaves nothing public behind
  await prisma.series.update({ where: { id: series.id }, data: { publicVisible: false, active: false } });
  await prisma.brand.update({ where: { id: series.brandId }, data: { active: false } });
  await publishKnowledge(MD);
  check(!(await prisma.publishedFaultCode.count({ where: { brandSlug: slugB } })), "hidden series → its codes leave the public site");

  console.log(fails ? `\n${fails} FAILED` : "\nall knowledge checks passed");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
