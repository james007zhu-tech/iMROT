"use client";
import { useTranslations } from "next-intl";
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  return (
    <div className="mx-auto max-w-lg space-y-3 rounded-lg border border-rose-200 bg-white p-6">
      <h2 className="font-bold text-rose-700">{t("somethingWrong")}</h2>
      <pre className="whitespace-pre-wrap text-xs text-slate-600">{error.message}</pre>
      <button onClick={reset} className="rounded bg-navy px-3 py-1.5 text-sm text-white">{t("retry")}</button>
    </div>
  );
}
