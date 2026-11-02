import { describe, expect, it } from "vitest";
import { parseBocHtml, toCny, toFxRate } from "./boc";

const sample = `
<table><tr><th>货币名称</th><th>现汇买入价</th><th>现钞买入价</th><th>现汇卖出价</th><th>现钞卖出价</th><th>中行折算价</th><th>发布日期</th><th>发布时间</th></tr>
<tr><td>泰国铢</td><td>20.42</td><td>19.78</td><td>20.59</td><td>21.22</td><td>20.51</td><td>2026-11-02</td><td>16:30:12</td></tr>
<tr><td>美元</td><td>712.34</td><td>706.52</td><td>715.36</td><td>715.36</td><td>713.90</td><td>2026-11-02</td><td>16:30:12</td></tr>
<tr><td>某未知币</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td><td>2026-11-02</td><td>16:30:12</td></tr>
</table>`;

describe("BoC rates", () => {
  it("parses known currencies and skips unknown names", () => {
    const rows = parseBocHtml(sample);
    expect(rows.map((r) => r.currency)).toEqual(["THB", "USD"]);
    expect(rows[0].middle).toBe(20.51);
    expect(rows[0].publishedAt).toBe("2026-11-02 16:30:12");
  });
  it("stores per-unit rate from the per-100 middle price", () => {
    const fx = toFxRate(parseBocHtml(sample)[0], new Date(2026, 10, 2));
    expect(fx.rateToCny).toBeCloseTo(0.2051, 6);
    expect(fx.currency).toBe("THB");
  });
  it("converts to CNY at 2 dp", () => {
    expect(toCny(10000, 0.2051)).toBe(2051);
    expect(toCny(1234.56, 0.2051)).toBe(253.21);
  });
});
