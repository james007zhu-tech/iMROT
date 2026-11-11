import { getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { DICT_KEYS, dictItems, saveDictItem } from "@/server/dict";
import { DOC_PREFIXES, MASTER_PREFIXES } from "@/lib/numbering";
import { Flash } from "@/components/Flash";
import { Card, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const BACK = "/admin/dictionary";

/**
 * 数据字典: the lists people pick from. The MD and the administrator rename, reorder, switch off and add entries;
 * codes never change because records point at them. Below: the fixed codes of the system, for reference.
 */
export default async function Dictionary({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [t, n, me] = await Promise.all([getTranslations("ops"), getTranslations("nav"), currentEmployee()]);
  const edit = ["MD", "ADMIN"].includes(me.role);
  const groups = await Promise.all(DICT_KEYS.map(async (g) => ({ key: g, items: await dictItems(g, true) })));
  async function save(group: string, f: FormData) {
    "use server";
    await guarded(async () => {
      const actor = await currentEmployee();
      return saveDictItem(actor.code, { group, code: String(f.get("code") ?? ""), labelTh: String(f.get("labelTh") ?? ""), labelZh: String(f.get("labelZh") ?? ""), labelEn: String(f.get("labelEn") ?? ""), sort: f.get("sort") ? Number(f.get("sort")) : undefined, active: f.get("active") === "on" });
    }, BACK);
  }
  const head = <div className="hidden grid-cols-[7rem_1fr_1fr_1fr_4.5rem_4rem_5rem] gap-2 px-1 text-xs font-semibold text-navy/70 md:grid"><span>{t("dictCode")}</span><span>ไทย</span><span>中文</span><span>English</span><span>{t("dictSort")}</span><span>{t("dictActive")}</span><span /></div>;
  return (
    <div className="space-y-4">
      <PageHeader title={n("dictionary")} />
      <Flash ok={ok} error={error} />
      {groups.map((g) => (
        <Card key={g.key} title={t(`dict_${g.key}`)}>
          <div className="space-y-1.5">
            {head}
            {g.items.map((i) => (
              <form key={i.id} action={save.bind(null, g.key)} className={`grid grid-cols-2 items-center gap-2 rounded-lg border px-2 py-1.5 md:grid-cols-[7rem_1fr_1fr_1fr_4.5rem_4rem_5rem] md:border-0 md:px-1 md:py-0 ${i.active ? "bg-white" : "bg-tint"}`}>
                <input type="hidden" name="code" value={i.code} /><span className="font-mono text-xs text-navy">{i.code}</span>
                <input name="labelTh" defaultValue={i.labelTh} disabled={!edit} aria-label={`${i.code} ไทย`} className={inputCls} />
                <input name="labelZh" defaultValue={i.labelZh} disabled={!edit} aria-label={`${i.code} 中文`} className={inputCls} />
                <input name="labelEn" defaultValue={i.labelEn} disabled={!edit} aria-label={`${i.code} English`} className={inputCls} />
                <input name="sort" type="number" defaultValue={i.sort} disabled={!edit} aria-label={`${i.code} ${t("dictSort")}`} className={inputCls} />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={i.active} disabled={!edit} className="h-4 w-4" /><span className="md:hidden">{t("dictActive")}</span></label>
                {edit && <button className={`${btnGhost} !min-h-9 !px-3`}>{t("save")}</button>}
              </form>
            ))}
            {edit && <form action={save.bind(null, g.key)} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-dashed px-2 py-2 md:grid-cols-[7rem_1fr_1fr_1fr_4.5rem_4rem_5rem]">
              <input name="code" required placeholder={t("dictNewCode")} aria-label={t("dictCode")} className={`${inputCls} font-mono uppercase`} />
              <input name="labelTh" placeholder="ไทย" aria-label="ไทย" className={inputCls} /><input name="labelZh" placeholder="中文" aria-label="中文" className={inputCls} /><input name="labelEn" required placeholder="English" aria-label="English" className={inputCls} />
              <input name="sort" type="number" placeholder="900" aria-label={t("dictSort")} className={inputCls} /><input type="hidden" name="active" value="on" /><span className="hidden md:block" />
              <button className={`${btnPrimary} !min-h-9 !px-3`}>＋ {t("dictAdd")}</button>
            </form>}
          </div>
        </Card>
      ))}
      <Card title={t("dictFixed")}>
        <p className="mb-2 text-xs text-navy/70">{t("dictFixedHint")}</p>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {Object.entries(MASTER_PREFIXES).map(([k, v]) => <span key={k} className="rounded-full border border-navy/30 bg-white px-2.5 py-0.5"><b className="font-mono">{k}TH</b> {v.name}</span>)}
          {Object.entries(DOC_PREFIXES).map(([k, v]) => <span key={k} className="rounded-full border border-navy/30 bg-white px-2.5 py-0.5"><b className="font-mono">{k}TH</b> {v.name}</span>)}
        </div>
      </Card>
    </div>
  );
}
