"use client";
import { useEffect } from "react";
/**
 * The last net (需求清单 v3 P0-05): an error that reaches the root — no menu, no translations loaded — still says in three
 * languages that what was typed is kept, and goes back to the form (components/DraftKeeper restores it).
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const back = () => { try { sessionStorage.setItem("dcit-draft-restore", "1"); } catch { /* ignore */ } location.reload(); };
  useEffect(() => { // the network is back: return to the form by itself
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);
  return (
    <html lang="zh">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#F4F6FA", padding: 24 }}>
        <div style={{ maxWidth: 520, margin: "40px auto", background: "#fff", border: "1px solid #C0392B", borderRadius: 12, padding: 24, color: "#1B2A4A", lineHeight: 1.6 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>这一步没有成功 · ขั้นตอนนี้ยังไม่สำเร็จ · This step did not go through</h2>
          <p>网络不稳，或系统刚发了新版。你填的内容已经留在这台设备上，回到表单后都在，再点一次保存就行。</p>
          <p>เครือข่ายไม่เสถียร หรือระบบเพิ่งอัปเดต ข้อมูลที่กรอกไว้ถูกเก็บในเครื่องนี้แล้ว กลับไปที่แบบฟอร์มแล้วกดบันทึกอีกครั้ง</p>
          <p>The network is unstable, or the system was just updated. What you typed is kept on this device — go back to the form and press save again.</p>
          <button onClick={back} style={{ minHeight: 44, padding: "0 18px", borderRadius: 8, border: 0, background: "#1B2A4A", color: "#fff", fontWeight: 600, fontSize: 15 }}>回到表单 · กลับไปที่แบบฟอร์ม · Back to the form</button>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#667", marginTop: 16 }}>{error.message}{error.digest ? ` · ${error.digest}` : ""}</pre>
        </div>
      </body>
    </html>
  );
}
