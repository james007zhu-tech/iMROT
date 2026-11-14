/**
 * Server start hook (Next.js). Runs the overtime month-end close (加班费月结) once shortly after start and then hourly:
 * on or after the 1st (Bangkok time) last month is closed for every legal entity — idempotent, so restarts and several
 * instances are harmless. Set OT_AUTO_CLOSE=off to disable (the MD can still close by hand).
 */
export async function register() {
  // DCiT works on Thailand time: whatever the host says, the server formats and reads dates as Bangkok does
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.TZ) process.env.TZ = "Asia/Bangkok";
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.OT_AUTO_CLOSE === "off") return;
  const { autoCloseOvertime } = await import("./server/overtime");
  const run = () => autoCloseOvertime().then((c) => { if (c.length) console.log(`[overtime] closed ${c.join(", ")}`); }).catch((e) => console.error("[overtime] auto close failed", e));
  setTimeout(run, 30_000);
  setInterval(run, 60 * 60 * 1000);
}
