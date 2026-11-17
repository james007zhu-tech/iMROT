// 页面冒烟 (需求清单 v4 V4-P0-10: "加自动化测试：返回 200，没有 error boundary"): GET each page as a person, expect 200 and no server-render error.
//   SESSION_SECRET=… node scripts/dev/pages.cjs <base> <employeeCode> <path> [<path> …]
const { createHmac } = require("node:crypto");
const [base, code, ...paths] = process.argv.slice(2);
const tok = () => { const p = `${code}|${Date.now() + 5000}`; return `${p}.${createHmac("sha256", process.env.SESSION_SECRET).update(p).digest("hex")}`; };
(async () => { let bad = 0;
  for (const p of paths) { const r = await fetch(base + p, { headers: { cookie: `dcit_session=${tok()}; locale=zh` }, redirect: "manual" }); const t = await r.text();
    const err = /data-dgst=|"digest":"\d+"/.test(t); if (r.status !== 200 || err) bad++; console.log(`${r.status === 200 && !err ? "✓" : "✗"} ${r.status}${err ? " SERVER-ERROR" : ""} ${p}`); }
  console.log(bad ? `\n${bad} FAILED` : "\nall passed"); process.exit(bad ? 1 : 0); })();
