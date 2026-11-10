"""
国际贸易 INTERNATIONAL_TRADE — swimlane flowchart (business modes, 朱总 2026-11-09), same drawing style as partner_repair.py.
Produces an editable Visio file:  python3 scripts/flows/international_trade.py out.vsdx
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from vsdx import Page, write_vsdx

LANES = [
    ("CUS", "客户（海外）"),
    ("SAL", "销售·单证"),
    ("SCM", "采购仓储"),
    ("LOG", "货代·物流"),
    ("FIN", "财务"),
]
LANE_W = 2.7
TITLE_W = 0.45
MARGIN = 0.4
HEADER_H = 0.5
ROW_H = 1.0
TOP_PAD = 0.55
ROWS = 22.6

PAGE_W = MARGIN * 2 + TITLE_W + LANE_W * len(LANES)
PAGE_H = MARGIN * 2 + HEADER_H + TOP_PAD + ROW_H * ROWS

NAVY = "#0B2D53"
BLUE = "#2374D5"
LINE = NAVY
FILL = "#FFFFFF"
DOC_FILL = "#EEF4FC"      # light blue for documents (numbered records)
DEC_FILL = "#FFF4E5"      # orange tint for decisions
NOTE_FILL = "#FFF4E5"
ORANGE = "#E8890C"

page = Page(PAGE_W, PAGE_H)
lane_x = {code: MARGIN + TITLE_W + LANE_W * i + LANE_W / 2 for i, (code, _) in enumerate(LANES)}
lane_left = {code: MARGIN + TITLE_W + LANE_W * i for i, (code, _) in enumerate(LANES)}

def row_y(r):
    return PAGE_H - MARGIN - HEADER_H - TOP_PAD - ROW_H * r

body_h = PAGE_H - 2 * MARGIN
page.box(MARGIN + TITLE_W / 2, PAGE_H / 2, TITLE_W, body_h, "国际贸易业务闭环", fill="#F2F2F2", line=LINE, font=15, bold=True, textdir=1, color=NAVY)
for code, title in LANES:
    cx = lane_x[code]
    page.box(cx, PAGE_H / 2, LANE_W, body_h, "", fill=FILL, line=LINE)
    page.box(cx, PAGE_H - MARGIN - HEADER_H / 2, LANE_W, HEADER_H, title, fill=NAVY, line=LINE, font=9, bold=True, color="#FFFFFF")

N, POS = {}, {}
SIZE = {"rect": (1.9, 0.62), "diamond": (1.6, 0.74), "document": (1.9, 0.7), "terminator": (1.6, 0.46)}

def node(key, lane, row, text, kind="rect", dx=0.0, w=None, h=None):
    ww, hh = SIZE[kind]
    ww = w or ww; hh = h or hh
    x, y = lane_x[lane] + dx, row_y(row)
    fill = {"document": DOC_FILL, "diamond": DEC_FILL}.get(kind, FILL)
    line = ORANGE if kind == "diamond" else (BLUE if kind == "document" else LINE)
    N[key] = page.box(x, y, ww, hh, text, kind=kind, fill=fill, line=line, font=7, color=NAVY)
    POS[key] = (x, y, ww, hh)

TOP, RIGHT, BOTTOM, LEFT = 0, 1, 2, 3
def pt(key, side):
    x, y, w, h = POS[key]
    return {TOP: (x, y + h / 2), RIGHT: (x + w / 2, y), BOTTOM: (x, y - h / 2), LEFT: (x - w / 2, y)}[side]

def link(a, sa, b, sb, label="", via=None, label_at=None):
    p0, p1 = pt(a, sa), pt(b, sb)
    pts = [p0]
    if via:
        pts += list(via)
    elif sa == BOTTOM and sb == TOP and abs(p0[0] - p1[0]) > 1e-6:
        ym = p0[1] - 0.16
        pts += [(p0[0], ym), (p1[0], ym)]
    elif sa in (LEFT, RIGHT) and sb in (LEFT, RIGHT) and abs(p0[1] - p1[1]) > 1e-6:
        xm = (p0[0] + p1[0]) / 2
        pts += [(xm, p0[1]), (xm, p1[1])]
    elif sa in (LEFT, RIGHT) and sb in (TOP, BOTTOM):
        pts += [(p1[0], p0[1])]
    elif sa in (TOP, BOTTOM) and sb in (LEFT, RIGHT):
        pts += [(p0[0], p1[1])]
    pts.append(p1)
    clean = [pts[0]]
    for p in pts[1:]:
        if abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6:
            clean.append(p)
    page.connector(clean, N[a], sa, N[b], sb, label=label, label_at=label_at, color=LINE)

# ── nodes ────────────────────────────────────────────────────────────────────────────────────────────────
node("rfq", "CUS", 0, "客户询价 RFQ", "terminator")
node("new", "SAL", 1.2, "新建业务单（国际贸易）\n客户、联系人、询价单号\n物料行：料号、HS 编码、原产地\n币种、Incoterms + 地点\n目的国 / 目的港、付款条件", w=2.2, h=1.05)
node("stock", "SCM", 2.7, "库存是否足够？", "diamond")
node("prth", "SCM", 3.9, "缺货行自动生成 PRTH\n供应商报价", "document")
node("cmp", "SCM", 5.0, "比价\n成本回填报价")
node("qtth", "SAL", 5.0, "QTTH 外币报价\n出口 VAT 0%", "document")
node("margin", "SAL", 6.2, "毛利 ≥ 10%？", "diamond")
node("md", "SCM", 6.2, "MD 审批", "diamond", w=1.3, h=0.62)
node("acc", "CUS", 7.4, "客户接受报价？", "diamond")
node("cancel", "SAL", 7.4, "订单取消", "terminator", w=1.3)
node("po", "CUS", 8.6, "客户 PO", "document")
node("cpo", "SAL", 9.6, "确认客户 PO\n开形式发票 PFTH（外币，VAT 0%）", "document", w=2.35, h=0.7)
node("poth", "SCM", 10.6, "POTH 采购下单", "document")
node("ibth", "SCM", 11.6, "IBTH 到货入库", "document")
node("obth", "SCM", 12.6, "OBTH 出库、包装\n唛头、件数、毛净重", "document")
node("ship", "SAL", 13.8, "出运单\n装箱单 DNTH（模板 34）\n报关用商业发票：同一 PFTH 号打印", "document", w=2.35, h=0.85)
node("book", "LOG", 15.0, "订舱\n出口报关（报关单号）")
node("load", "LOG", 16.0, "装船 / 起飞")
node("bl", "LOG", 17.0, "提单 B/L / 空运单 AWB", "document")
node("conf", "SAL", 18.0, "确认出运\n提单号、开航日")
node("lock", "SAL", 19.0, "订单锁定\n（代替签收验收）")
node("clear", "CUS", 18.0, "凭提单清关提货")
node("tt", "CUS", 19.9, "客户 T/T 付款")
node("pay", "FIN", 19.9, "外币收款\n核对 PFTH")
node("rc", "FIN", 20.9, "RCTH 收据", "document")
node("done", "SAL", 21.9, "项目完成\n款项到齐，装箱单、提单、报关单已上传", "terminator", w=2.35, h=0.7)

# ── connectors ───────────────────────────────────────────────────────────────────────────────────────────
link("rfq", BOTTOM, "new", TOP)
link("new", BOTTOM, "stock", TOP)
link("stock", BOTTOM, "prth", TOP, "否", label_at=(lane_x["SCM"] + 0.1, row_y(3.3) + 0.05))
link("prth", BOTTOM, "cmp", TOP)
link("cmp", LEFT, "qtth", RIGHT)
link("stock", LEFT, "qtth", TOP, "是", via=[(lane_x["SAL"], row_y(2.7))], label_at=(lane_left["SCM"] - 0.25, row_y(2.7) + 0.08))
link("qtth", BOTTOM, "margin", TOP)
link("margin", RIGHT, "md", LEFT, "否", label_at=(lane_left["SCM"] - 0.25, row_y(6.2) + 0.05))
link("md", TOP, "cmp", BOTTOM, "否（重新比价、改价）", label_at=(lane_x["SCM"] + 0.75, row_y(5.65)))
link("margin", BOTTOM, "acc", TOP, "是", via=[(lane_x["SAL"], row_y(6.8)), (lane_x["CUS"], row_y(6.8))], label_at=(lane_x["SAL"] + 0.1, row_y(6.62) - 0.02))
link("md", BOTTOM, "acc", TOP, "是", via=[(lane_x["SCM"], row_y(6.8)), (lane_x["CUS"], row_y(6.8))], label_at=(lane_x["SCM"] + 0.1, row_y(6.62) - 0.02))
link("acc", RIGHT, "cancel", LEFT, "否", label_at=(lane_left["SAL"] - 0.3, row_y(7.4) + 0.05))
link("acc", BOTTOM, "po", TOP, "是", label_at=(lane_x["CUS"] + 0.1, row_y(7.95)))
link("po", BOTTOM, "cpo", LEFT, via=[(lane_x["CUS"], row_y(9.6))])
link("cpo", BOTTOM, "poth", TOP)
link("poth", BOTTOM, "ibth", TOP)
link("ibth", BOTTOM, "obth", TOP)
link("obth", BOTTOM, "ship", TOP)
link("ship", BOTTOM, "book", TOP)
link("book", BOTTOM, "load", TOP)
link("load", BOTTOM, "bl", TOP)
link("bl", BOTTOM, "conf", RIGHT, via=[(lane_x["LOG"], row_y(18.0))])
link("conf", BOTTOM, "lock", TOP)
link("conf", LEFT, "clear", RIGHT, "提单、CI、PL", label_at=(lane_left["SAL"] + 0.08, row_y(18.0) + 0.17))
link("clear", BOTTOM, "tt", TOP)
link("tt", RIGHT, "pay", LEFT)
link("lock", RIGHT, "pay", TOP, via=[(lane_x["FIN"], row_y(19.0))])
link("pay", BOTTOM, "rc", TOP)
link("rc", BOTTOM, "done", RIGHT, via=[(lane_x["FIN"], row_y(21.9))])

# ── notes (empty upper part of the forwarder and finance lanes) ──────────────────────────────────────────
page.box(lane_x["LOG"], row_y(3.6), LANE_W - 0.25, 2.6,
         "说明\n1. 业务单号仍是 QTTH；出口发票是形式发票 PFTH（确认客户 PO 时开），装箱单用 DNTH 号；不开 IVTH。\n"
         "2. 只记物料号 SKU，不建 ATH。\n"
         "3. 毛利门槛 10%（系统管理里 MD 可改），低于门槛要 MD 审批。\n"
         "4. 出运确认（提单号、开航日）代替客户签收，锁定成本与价格。",
         fill="#FBFBFB", line=LINE, font=7, align=0, color=NAVY)
page.box(lane_x["FIN"], row_y(3.6), LANE_W - 0.25, 2.6,
         "待会计确认\n出口零税率是否另开税票、进口增值税的处理由会计确认。\n系统暂按“出口不开 TITH，报关单视同税票”处理。\n外币收款按收款日中行折算价记 CNY。",
         fill=NOTE_FILL, line=ORANGE, font=7, align=0, color=NAVY)

out = sys.argv[1] if len(sys.argv) > 1 else "international_trade_flow.vsdx"
write_vsdx(out, page, title="iMROT 国际贸易业务闭环流程图", page_name="国际贸易")
print("wrote", out, f"page {PAGE_W:.1f} x {PAGE_H:.1f} in, {len(page.shapes)} shapes")
