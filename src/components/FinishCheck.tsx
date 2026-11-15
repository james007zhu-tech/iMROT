"use client";
import { useEffect, useState } from "react";

/**
 * 没有测试结果不能点「完成 → 待验收」(测试报告 P0-08). Watches the repair form and says what is still missing; the
 * finish button is greyed until one run test (上电 / 空载 / 带载) has a result and passed, and none failed.
 * The service checks the same rule again.
 */
export function FinishCheck({ formId, run, labels }: { formId: string; run: { key: string; name: string }[]; labels: { missing: string; failed: string; ready: string; needOne: string } }) {
  const [state, setState] = useState<{ gap: "FAILED" | "NEEDS_TEST" | null; lacking: string[] }>({ gap: "NEEDS_TEST", lacking: [] });
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const val = (n: string) => ((form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? "").trim();
    const check = () => {
      const all = Array.from(form.querySelectorAll<HTMLSelectElement>('select[name^="p_"]'));
      const failed = all.some((s) => s.value === "no");
      const done = run.filter((r) => val(`r_${r.key}`) && val(`p_${r.key}`) === "yes");
      const gap = failed ? "FAILED" : done.length ? null : "NEEDS_TEST";
      setState({ gap, lacking: gap === "NEEDS_TEST" ? run.filter((r) => !val(`r_${r.key}`)).map((r) => r.name) : [] });
      document.querySelectorAll<HTMLButtonElement>(`button[form="${formId}"]:not([name])`).forEach((b) => { b.disabled = !!gap; b.style.opacity = gap ? "0.45" : ""; b.style.cursor = gap ? "not-allowed" : ""; });
    };
    check();
    form.addEventListener("input", check); form.addEventListener("change", check);
    return () => { form.removeEventListener("input", check); form.removeEventListener("change", check); };
  }, [formId, run]);
  if (!state.gap) return <p className="rounded-lg border border-navy/20 bg-white px-3 py-2 text-[13px] text-navy">✓ {labels.ready}</p>;
  return <p className="rounded-lg border border-[#E6A23C] bg-[#FFF4E5] px-3 py-2 text-[13px] text-[#7A4A00]">{state.gap === "FAILED" ? labels.failed : `${labels.missing}${labels.needOne}${state.lacking.length ? `（${state.lacking.join(" / ")}）` : ""}`}</p>;
}
