"""
自动化项目 AUTOMATION_PROJECT — swimlane flowchart (business modes, 朱总 2026-11-09), same drawing style as partner_repair.py.
Produces an editable Visio file:  python3 scripts/flows/automation_project.py out.vsdx
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from vsdx import Page, write_vsdx

LANES = [
    ("CUS", "客户"),
    ("SAL", "销售·项目经理"),
    ("ENG", "工程（设计·装配·调试）"),
    ("SCM", "采购仓储"),
    ("FIN", "财务"),
]
LANE_W = 2.7
TITLE_W = 0.45
MARGIN = 0.4
HEADER_H = 0.5
ROW_H = 1.0
TOP_PAD = 0.55
ROWS = 27.2

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
page.box(MARGIN + TITLE_W / 2, PAGE_H / 2, TITLE_W, body_h, "自动化项目业务闭环", fill="#F2F2F2", line=LINE, font=15, bold=True, textdir=1, color=NAVY)
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
node("urs", "CUS", 0, "客户需求 / 询价\nURS、图纸", "terminator", h=0.55)
node("new", "SAL", 1.2, "新建业务单（自动化项目）\n项目名称、现场 / 工厂\n要求完成日期\n需求与范围、文件", w=2.2, h=0.95)
node("plan", "ENG", 2.6, "方案与 BOM\n必要时现场勘察")
node("short", "SCM", 3.7, "BOM 是否缺件？", "diamond")
node("prth", "SCM", 4.9, "PRTH 询价\n比价、成本回填", "document")
node("qtth", "SAL", 6.1, "QTTH 项目报价\n含付款里程碑（默认）\n签约 30%，发货 60%，验收 10%", "document", w=2.2, h=0.9)
node("margin", "SAL", 7.5, "毛利 ≥ 20%？", "diamond")
node("md", "ENG", 7.5, "MD 审批", "diamond", w=1.3, h=0.62)
node("acc", "CUS", 8.7, "客户接受报价？", "diamond")
node("cancel", "SAL", 8.7, "订单取消", "terminator", w=1.3)
node("po", "CUS", 9.9, "客户 PO / 合同", "document")
node("m1", "FIN", 10.9, "里程碑① 开票\nTITH + IVTH", "document")
node("pay1", "FIN", 11.9, "收预付款\nRCTH")
node("poth", "SCM", 12.9, "POTH 采购", "document")
node("ibth", "SCM", 13.9, "IBTH 到货入库", "document")
node("design", "ENG", 14.9, "设计\n电气图、程序")
node("build", "ENG", 15.9, "装配接线、编程")
node("fat", "ENG", 17.0, "FAT 出厂测试通过？", "diamond", w=1.7)
node("obth", "SCM", 18.1, "OBTH 出库", "document")
node("dnth", "SCM", 19.1, "DNTH 送货\n客户签收", "document")
node("m2", "FIN", 19.1, "里程碑② 开票\nTITH + IVTH", "document")
node("inst", "ENG", 20.2, "现场安装调试")
node("sat", "ENG", 21.3, "SAT 现场验收通过？", "diamond", w=1.7)
node("signsat", "CUS", 21.3, "客户签署验收单")
node("lock", "SAL", 22.5, "订单锁定\n成本、价格不再变")
node("m3", "FIN", 22.5, "里程碑③ 开票\nTITH + IVTH", "document")
node("pay", "FIN", 23.6, "收款\nRCTH", "document")
node("hand", "ENG", 24.6, "移交\n资料、培训")
node("done", "SAL", 25.7, "项目完成", "terminator")

# ── connectors ───────────────────────────────────────────────────────────────────────────────────────────
link("urs", BOTTOM, "new", TOP)
link("new", BOTTOM, "plan", TOP)
link("plan", BOTTOM, "short", TOP)
link("short", BOTTOM, "prth", TOP, "是", label_at=(lane_x["SCM"] + 0.1, row_y(4.3) + 0.05))
link("prth", BOTTOM, "qtth", RIGHT, via=[(lane_x["SCM"], row_y(6.1))])
link("short", LEFT, "qtth", TOP, "否", via=[(lane_x["SAL"], row_y(3.7))], label_at=(lane_left["SCM"] - 0.25, row_y(3.7) + 0.08))
link("qtth", BOTTOM, "margin", TOP)
link("margin", RIGHT, "md", LEFT, "否", label_at=(lane_left["ENG"] - 0.25, row_y(7.5) + 0.06))
link("md", RIGHT, "plan", RIGHT, "否（调整方案、改价）", via=[(lane_left["SCM"] - 0.12, row_y(7.5)), (lane_left["SCM"] - 0.12, row_y(2.6))], label_at=(lane_x["ENG"] + 0.55, row_y(7.5) + 0.5))
link("margin", BOTTOM, "acc", TOP, "是", via=[(lane_x["SAL"], row_y(8.1)), (lane_x["CUS"], row_y(8.1))], label_at=(lane_x["SAL"] + 0.1, row_y(7.92) - 0.02))
link("md", BOTTOM, "acc", TOP, "是", via=[(lane_x["ENG"], row_y(8.1)), (lane_x["CUS"], row_y(8.1))], label_at=(lane_x["ENG"] + 0.1, row_y(7.92) - 0.02))
link("acc", RIGHT, "cancel", LEFT, "否", label_at=(lane_left["SAL"] - 0.3, row_y(8.7) + 0.06))
link("acc", BOTTOM, "po", TOP, "是", label_at=(lane_x["CUS"] + 0.1, row_y(9.25)))
link("po", BOTTOM, "m1", LEFT, via=[(lane_x["CUS"], row_y(10.9))])
link("m1", BOTTOM, "pay1", TOP)
link("pay1", BOTTOM, "poth", TOP)
link("poth", BOTTOM, "ibth", TOP)
link("ibth", BOTTOM, "design", TOP)
link("design", BOTTOM, "build", TOP)
link("build", BOTTOM, "fat", TOP)
link("fat", LEFT, "build", LEFT, "否（返工）", via=[(lane_left["ENG"] + 0.15, row_y(17.0)), (lane_left["ENG"] + 0.15, row_y(15.9))], label_at=(lane_left["ENG"] + 0.55, row_y(16.45)))
link("fat", BOTTOM, "obth", TOP, "是", label_at=(lane_x["ENG"] + 0.2, row_y(17.62)))
link("obth", BOTTOM, "dnth", TOP)
link("dnth", RIGHT, "m2", LEFT)
link("dnth", BOTTOM, "inst", TOP)
link("inst", BOTTOM, "sat", TOP)
link("sat", LEFT, "signsat", RIGHT, "是", label_at=(lane_left["ENG"] - 0.2, row_y(21.3) + 0.08))
link("sat", RIGHT, "inst", RIGHT, "否（整改）", via=[(lane_x["ENG"] + 1.15, row_y(21.3)), (lane_x["ENG"] + 1.15, row_y(20.2))], label_at=(lane_x["ENG"] + 0.95, row_y(20.75)))
link("signsat", BOTTOM, "lock", LEFT, via=[(lane_x["CUS"], row_y(22.5))])
link("lock", RIGHT, "m3", LEFT)
link("m3", BOTTOM, "pay", TOP)
link("pay", BOTTOM, "hand", RIGHT, via=[(lane_x["FIN"], row_y(24.6))])
link("hand", BOTTOM, "done", RIGHT, via=[(lane_x["ENG"], row_y(25.7))])

# ── notes (empty parts of the customer lane) ─────────────────────────────────────────────────────────────
page.box(lane_x["CUS"], row_y(13.6), LANE_W - 0.25, 3.0,
         "说明\n1. 业务单号仍是 QTTH；毛利门槛 20%（系统管理里 MD 可改），低于门槛要 MD 审批。\n"
         "2. 里程碑与比例在报价时可改；每个付款里程碑完成后开一张 TITH + IVTH。\n"
         "3. FAT 出厂测试、SAT 现场验收都要留测试记录；SAT 客户签字后订单锁定。\n"
         "4. 缺件走 PRTH → POTH → IBTH，和其他模式一样。",
         fill="#FBFBFB", line=LINE, font=7, align=0, color=NAVY)
page.box(lane_x["CUS"], row_y(17.6), LANE_W - 0.25, 1.6,
         "待朱总确定\n交付的控制柜 / 系统是否建 ATH：待朱总确定。\n系统里在验收后提供“登记为设备”入口，不自动建。",
         fill=NOTE_FILL, line=ORANGE, font=7, align=0, color=NAVY)

out = sys.argv[1] if len(sys.argv) > 1 else "automation_project_flow.vsdx"
write_vsdx(out, page, title="iMROT 自动化项目业务闭环流程图", page_name="自动化项目")
print("wrote", out, f"page {PAGE_W:.1f} x {PAGE_H:.1f} in, {len(page.shapes)} shapes")
