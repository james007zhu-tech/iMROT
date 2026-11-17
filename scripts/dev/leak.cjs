// 泄露测试 (需求清单 v4 V4-P0-01/02): raw GETs — HTML and RSC — per role; what a refused page still carries.
const { createHmac } = require("node:crypto"); const fs = require("node:fs");
const base = "http://localhost:3100"; const sec = JSON.parse(fs.readFileSync(__dirname + "/secrets.json", "utf8"));
const bank = sec.bank.filter((b) => /^\d{12,}|^BKCH/.test(b) && b !== "0205568072149");
const tok = (code) => { const p = `${code}|${Date.now() + 5000}`; return `${p}.${createHmac("sha256", process.env.SESSION_SECRET).update(p).digest("hex")}`; };
const ROLES = [["ENG", "ETH9900002"], ["ENG+approver", "ETH9900001"], ["HR", "ETH9900005"], ["PUR", "ETH9900004"], ["SALES", "ETH9900003"], ["FIN", "ETH9900006"]];
const PATHS = ["/home", "/admin", "/finance", "/tax?doc=iv", "/tax?doc=ti", "/tax?doc=rc", "/finance/payables", "/purchasing/orders", "/suppliers", "/parts", "/parts/movement", "/service-orders/new", "/customers", "/assets", "/dashboard", "/documents?type=IB", "/documents?type=OB", "/documents?type=PV", "/documents?type=DN", "/finance/cash-plan", "/finance/reports", "/admin/permissions", "/people", "/service-orders", "/documents/new?type=IB"];
const count = (t) => ({ docs: (t.match(/(IVTH|TITH|RCTH|POTH)\d{8}/g) ?? []).length, bank: bank.filter((b) => t.includes(b)).length, cust: new Set(sec.customers.filter((c) => t.includes(c))).size, sup: new Set(sec.suppliers.filter((c) => t.includes(c))).size });
(async () => {
  for (const [role, code] of ROLES) {
    const cookie = `dcit_session=${tok(code)}; locale=zh`; const rows = []; let baseline = null;
    for (const p of PATHS) {
      const out = [];
      for (const rsc of [false, true]) {
        const r = await fetch(base + p, { headers: { cookie, ...(rsc ? { RSC: "1" } : {}) }, redirect: "manual" });
        const t = await r.text(); const c = count(t); if (p === "/home" && !rsc) baseline = c;
        const refused = r.status === 403;
        out.push(`${r.status} d${c.docs - baseline.docs} b${c.bank} c${c.cust - baseline.cust} s${c.sup - baseline.sup}`);
        if (refused && (c.docs > baseline.docs || c.bank || c.cust > baseline.cust || c.sup > baseline.sup)) out.push("!!LEAK");
      }
      rows.push(`${p.padEnd(26)} ${out.join(" | ")}`);
    }
    console.log(`\n### ${role}\n` + rows.join("\n"));
  }
})();
