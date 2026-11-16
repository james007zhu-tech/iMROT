"use client";
/**
 * 保存失败不得丢单 (需求清单 v3 P0-05). A save that did not arrive used to end on "出错了 / Failed to fetch", and
 * "重试" came back with an empty form. Now the reason is said in the person's language, what was typed is already kept
 * (components/DraftKeeper), and one button goes back to the form with everything in it. The save itself is not sent
 * again behind the person's back — a save whose answer was lost may have arrived, and sending it twice makes two orders;
 * the person looks, and presses save once more.
 */
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

const kindOf = (m: string) =>
  /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(m) ? "net"
  : /failed to find server action|older or newer deployment/i.test(m) ? "release"
  : /unexpected response was received from the server/i.test(m) ? "server"
  : "other";

export default function AppError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  const kind = kindOf(error.message ?? "");
  const [offline, setOffline] = useState(false);
  const back = () => { try { sessionStorage.setItem("dcit-draft-restore", "1"); } catch { /* ignore */ } location.reload(); };
  useEffect(() => {
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    const on = () => back(); // the network is back: return to the form, filled in, ready to be saved again
    const off = () => setOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return (
    <div className="mx-auto max-w-lg space-y-3 rounded-lg border border-alert bg-white p-6">
      <h2 className="font-bold text-alert-ink">{t("saveFailedTitle")}</h2>
      <p className="text-sm text-navy">{t(`saveFailed_${kind}`)}</p>
      <p className="text-sm text-navy">{t("saveFailedKept")}</p>
      {offline && <p className="text-sm font-semibold text-alert-ink">{t("saveFailedOffline")}</p>}
      <button onClick={back} className="min-h-11 rounded-lg bg-navy px-4 text-sm font-semibold text-white">{t("saveFailedBack")}</button>
      {kind === "other" && <pre className="whitespace-pre-wrap text-xs text-navy/60">{error.message}{error.digest ? ` · ${error.digest}` : ""}</pre>}
    </div>
  );
}
