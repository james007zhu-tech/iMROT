/** 数据字典: pick-lists people maintain. Seeds appear the first time a group is read. */
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";

type Seed = [code: string, th: string, zh: string, en: string];
export const DICT_GROUPS: Record<string, Seed[]> = {
  expenseCategory: [
    ["TRAVEL", "ค่าเดินทาง", "差旅交通", "Travel"], ["FUEL", "ค่าน้ำมัน", "油费", "Fuel"], ["TOLL", "ทางด่วน / ที่จอดรถ", "过路与停车", "Tolls and parking"],
    ["MEAL", "ค่าอาหาร", "餐费", "Meals"], ["LODGING", "ค่าที่พัก", "住宿", "Lodging"], ["TOOLS", "เครื่องมือและวัสดุสิ้นเปลือง", "工具耗材", "Tools and consumables"],
    ["MATERIAL", "วัสดุหน้างาน", "现场材料", "Site materials"], ["COURIER", "ค่าขนส่ง / พัสดุ", "快递运费", "Courier and freight"], ["OFFICE", "สำนักงาน", "办公用品", "Office"],
    ["COMMS", "ค่าโทรศัพท์ / อินเทอร์เน็ต", "通讯", "Phone and internet"], ["ENTERTAIN", "รับรองลูกค้า", "业务招待", "Customer entertainment"], ["OTHER", "อื่น ๆ", "其他", "Other"],
  ],
  trainingKind: [
    ["INTERNAL", "อบรมภายใน", "内部培训", "Internal training"], ["ONJOB", "สอนงานหน้างาน", "现场带教", "On-the-job coaching"], ["ONLINE", "ไมโครคอร์ส iMROT-T", "iMROT-T 微课", "iMROT-T micro-course"],
    ["VENDOR", "อบรมจากผู้ผลิต", "原厂培训", "Vendor training"], ["EXTERNAL", "หลักสูตรภายนอก", "外部课程", "External course"], ["SAFETY", "ความปลอดภัย", "安全培训", "Safety"],
  ],
};
export const DICT_KEYS = Object.keys(DICT_GROUPS);

async function seed(group: string) {
  const seeds = DICT_GROUPS[group];
  if (!seeds) return;
  if (await prisma.dictItem.count({ where: { group } })) return;
  await prisma.dictItem.createMany({ data: seeds.map(([code, labelTh, labelZh, labelEn], i) => ({ group, code, labelTh, labelZh, labelEn, sort: (i + 1) * 10, system: true })), skipDuplicates: true });
}

export async function dictItems(group: string, all = false) {
  await seed(group);
  return prisma.dictItem.findMany({ where: { group, ...(all ? {} : { active: true }) }, orderBy: [{ sort: "asc" }, { code: "asc" }] });
}
export const dictLabel = (i: { labelTh: string; labelZh: string; labelEn: string }, locale: string) => (locale === "zh" ? i.labelZh : locale === "en" ? i.labelEn : i.labelTh);
export async function dictMap(group: string, locale: string) {
  return new Map((await dictItems(group, true)).map((i) => [i.code, dictLabel(i, locale)]));
}

async function mayEdit(actorCode: string) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  if (!["MD", "ADMIN"].includes(a.role)) throw new Error("ADMIN_ONLY");
  return a;
}
export async function saveDictItem(actorCode: string, input: { group: string; code: string; labelTh: string; labelZh: string; labelEn: string; sort?: number; active?: boolean }) {
  const a = await mayEdit(actorCode);
  if (!DICT_GROUPS[input.group]) throw new Error(`NO_DICT_GROUP:${input.group}`);
  const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!code) throw new Error("DICT_CODE_REQUIRED");
  const labels = { labelTh: input.labelTh.trim() || input.labelEn.trim() || code, labelZh: input.labelZh.trim() || input.labelEn.trim() || code, labelEn: input.labelEn.trim() || code };
  await prisma.dictItem.upsert({ where: { group_code: { group: input.group, code } }, create: { group: input.group, code, ...labels, sort: input.sort ?? 900, active: input.active ?? true }, update: { ...labels, ...(input.sort != null ? { sort: input.sort } : {}), ...(input.active != null ? { active: input.active } : {}) } });
  await audit(a.id, "DICT_SAVE", `${input.group}.${code}`);
  return code;
}
