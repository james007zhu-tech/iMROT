"""
合作维修（外协维修）业务闭环 — swimlane flowchart in the same style as the repair-flow v3 drawing.
Produces an editable Visio file:  python3 scripts/flows/partner_repair.py out.vsdx
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from vsdx import Page, write_vsdx

LANES = [
    ("ALM", "ALM (Assets management system)"),
    ("CRM", "CRM (Customer Management System)"),
    ("SLM", "SLM (Service Lifecycle Management)"),
    ("SCM", "SCM (Supply Chain Management)"),
    ("SRM", "SRM (Supplier Relationship Management · 合作伙伴)"),
    ("FIN", "FIN (Finance)"),
    ("TC", "T&C (Tax and compliance)"),
    ("OD", "OD (Organization Development)"),
    ("ADM", "Admin (System administration)"),
]
LANE_W = 2.35
TITLE_W = 0.45
MARGIN = 0.4
HEADER_H = 0.55
ROW_H = 1.05
TOP_PAD = 0.6
ROWS = 33.5

PAGE_W = MARGIN * 2 + TITLE_W + LANE_W * len(LANES)
PAGE_H = MARGIN * 2 + HEADER_H + TOP_PAD + ROW_H * ROWS

LINE = "#2F4F7F"
FILL = "#FFFFFF"
DOC_FILL = "#FFFFFF"

page = Page(PAGE_W, PAGE_H)
lane_x = {code: MARGIN + TITLE_W + LANE_W * i + LANE_W / 2 for i, (code, _) in enumerate(LANES)}
lane_left = {code: MARGIN + TITLE_W + LANE_W * i for i, (code, _) in enumerate(LANES)}

def row_y(r):
    return PAGE_H - MARGIN - HEADER_H - TOP_PAD - ROW_H * r

# ── frame: title bar + lanes ─────────────────────────────────────────────────────────────────────────────
body_h = PAGE_H - 2 * MARGIN
page.box(MARGIN + TITLE_W / 2, PAGE_H / 2, TITLE_W, body_h, "合作维修业务闭环（外协维修 · SRM）", fill="#F2F2F2", line=LINE, font=10, bold=True, textdir=1)
for code, title in LANES:
    cx = lane_x[code]
    page.box(cx, PAGE_H / 2, LANE_W, body_h, "", fill=FILL, line=LINE)
    page.box(cx, PAGE_H - MARGIN - HEADER_H / 2, LANE_W, HEADER_H, title, fill="#F2F2F2", line=LINE, font=7.5, bold=True)

# ── nodes ────────────────────────────────────────────────────────────────────────────────────────────────
N = {}
POS = {}
SIZE = {"rect": (1.6, 0.72), "diamond": (1.55, 0.8), "document": (1.6, 0.8), "terminator": (1.3, 0.45)}

def node(key, lane, row, text, kind="rect", dx=0.0, w=None, h=None, fill=None):
    ww, hh = SIZE[kind]
    ww = w or ww; hh = h or hh
    x, y = lane_x[lane] + dx, row_y(row)
    f = fill or (DOC_FILL if kind == "document" else FILL)
    N[key] = page.box(x, y, ww, hh, text, kind=kind, fill=f, line=LINE, font=6.5)
    POS[key] = (x, y, ww, hh)
    return key

TOP, RIGHT, BOTTOM, LEFT = 0, 1, 2, 3
def pt(key, side):
    x, y, w, h = POS[key]
    return {TOP: (x, y + h / 2), RIGHT: (x + w / 2, y), BOTTOM: (x, y - h / 2), LEFT: (x - w / 2, y)}[side]

def link(a, sa, b, sb, label="", via=None, label_at=None):
    """Orthogonal connector. via: list of absolute (x,y) corner points; when omitted a simple elbow is derived."""
    p0, p1 = pt(a, sa), pt(b, sb)
    pts = [p0]
    if via:
        pts += list(via)
    else:
        if sa in (TOP, BOTTOM) and sb in (TOP, BOTTOM):
            if abs(p0[0] - p1[0]) > 1e-6:
                ym = p0[1] - 0.5 * ROW_H * (1 if sa == BOTTOM else -1) if sb == TOP or sb == BOTTOM and p1[1] > p0[1] else (p0[1] + p1[1]) / 2
                if sa == BOTTOM and sb == TOP:
                    ym = (p0[1] + p1[1]) / 2 if p1[1] < p0[1] else p0[1] - 0.3
                pts += [(p0[0], ym), (p1[0], ym)]
        elif sa in (LEFT, RIGHT) and sb in (LEFT, RIGHT):
            if abs(p0[1] - p1[1]) > 1e-6:
                xm = (p0[0] + p1[0]) / 2
                pts += [(xm, p0[1]), (xm, p1[1])]
        elif sa in (LEFT, RIGHT):          # horizontal out, vertical in
            pts += [(p1[0], p0[1])]
        else:                              # vertical out, horizontal in
            pts += [(p0[0], p1[1])]
    pts.append(p1)
    # drop duplicate consecutive points
    clean = [pts[0]]
    for p in pts[1:]:
        if abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6:
            clean.append(p)
    page.connector(clean, N[a], sa, N[b], sb, label=label, label_at=label_at, color=LINE)

def chan(lane, k=0.5):
    """x of a vertical routing channel at fraction k of the gap between a lane's node edge and the lane border."""
    return lane_left[lane] + LANE_W * k

# ---- 1. 询价与设备接收 ---------------------------------------------------------------------------------
node("inq", "CRM", 0, "客户询价（电机、数控、伺服等非自修设备）", "terminator", w=1.75, h=0.5)
node("hasfile", "CRM", 1, "是否有正式询价单/文件", "diamond")
node("upload", "CRM", 2, "上传询价文件到报价页面，AI 识别设备/数量/要求", "document")
node("pickup", "SCM", 2, "取回设备，入库生成 OBTH（待外协维修设备）", "document")
node("hasasset", "SCM", 3, "设备是否已建立档案", "diamond")
node("photo", "ALM", 1, "拍摄铭牌，上传到“新建设备”页面，进行 AI 识别")
node("ath", "ALM", 2, "生成设备 UAID，即 ATH 号", "document")
node("confirm", "ALM", 3, "确认设备对应的各项信息")
node("inth", "SLM", 4, "生成检测单 INTH，自动带入设备信息、询价单号", "document")
node("inspect", "SLM", 5, "工程师初检：故障现象、照片、初步判断、所需配合（工艺参数/图纸）")
node("selfrepair", "SLM", 6, "是否自修？", "diamond")
node("toself", "SLM", 7, "转自修流程（维修业务流程图）", "terminator", w=1.6)

# ---- 2. 供应商询价 → 客户报价 ----------------------------------------------------------------------------
node("pick", "SRM", 6, "按设备类别筛选合作伙伴（资质、历史评价、保修条件、距离）")
node("prth", "SCM", 7, "【问价】生成供应商询价单 PRTH：附 INTH、照片、技术要求；无价格、不含客户信息；一张发多家", "document")
node("sendto", "SRM", 8, "设备/资料送达合作伙伴检测（或合作伙伴到厂检测）")
node("quoteback", "SRM", 9, "合作伙伴回复：维修方案、报价、工期、保修期；录入 PRTH 比价页", "document")
node("compare", "SRM", 10, "比价与选定合作伙伴（价格、工期、保修、历史质量）")
node("costin", "CRM", 10, "合作伙伴报价 + 运输 + 我方检测/交付服务成本回流报价单", "document")
node("qtth", "CRM", 11, "生成报价单 QTTH（注明保修期与工期；保修期 = 合作伙伴 POTH 承诺期，背靠背）", "document")
node("margin", "CRM", 12, "毛利 ≥ 33%？（合作维修门槛；自修为 50%）", "diamond", w=1.7, h=0.85)
node("md", "SLM", 12, "MD 审批", "diamond", w=1.2, h=0.6)
node("sign", "CRM", 13, "客户回签确认报价单", "diamond")
node("returnasis", "SCM", 14, "客户不修：生成 DNTH 原样退回，关闭订单", "document")

# ---- 3. 下单 → 外送 → 跟进 ------------------------------------------------------------------------------
node("poth", "SCM", 15, "【定约】生成采购订单 POTH 给选定的一家：维修范围、价格、工期、保修（与 QTTH 背靠背）、验收标准、付款条件（变更升版本，不新开）", "document", w=2.05, h=0.92)
node("sendout", "SCM", 16, "【交货/托管】外送维修单 = 出库单 OBTH（类型：外协送修），引用 POTH + ATH：铭牌/外观照片、随机附件清单、合作伙伴签收", "document", w=2.05, h=0.92)
node("track", "SRM", 17, "进度跟进（仅内部可见）：到厂确认 → 拆检确认 → 维修中 → 测试 → 完成（里程碑 + 照片）")
node("change", "SRM", 18, "是否追加费用 / 工期变更？", "diamond")
node("changedoc", "SRM", 19, "变更 POTH；同步变更 QTTH，须客户书面同意后继续", "document")
node("done", "SRM", 20, "合作伙伴完成：提交测试报告、保修单、更换件清单", "document")
node("takeback", "SCM", 21, "我方取回：入库单 IBTH（类型：外协返回），引用同一张外送 OBTH，核对附件一件不少", "document", w=2.0)
node("verify", "SLM", 22, "我方复测验收（空载/带载测试、参数核对）")
node("pass", "SLM", 23, "复测合格？", "diamond")
node("rework", "SRM", 23, "退回合作伙伴返修（POTH 保修范围内，不另计费）")
node("dnth", "SCM", 24, "生成送货单 DNTH：显示 QTTH、客户 PO、保修条款；出库 OBTH", "document")
node("deliver", "SCM", 25, "送货给客户，将 DNTH 和 IVTH 同时给客户")

# ---- 4. 客户验收 → 开票 → 收款 -----------------------------------------------------------------------------
node("ivth", "FIN", 24, "自动生成 INVOICE，IVTH", "document")
node("accept", "SLM", 26, "客户试机并验收", "diamond")
node("lock", "CRM", 27, "点击 QTTH 的“验收”按钮：成本锁定、价格锁定、不允许再增加成本/费用；检查 QTTH、POTH、外送单、INTH、DNTH 完整性", w=1.9, h=1.0)
node("tith", "TC", 28, "开具税务发票 TITH", "document")
node("sendti", "TC", 29, "寄送/交付给客户")
node("pay", "SLM", 29, "客户付款")
node("payproof", "SLM", 30, "上传回款凭证到 QTTH 项下，点击“项目完成”", "document")
node("end", "SLM", 32, "结束", "terminator")
node("almrec", "ALM", 30, "ATH 项下写入维修记录：合作伙伴、方案、更换件、保修到期日；关联 INTH/POTH/外送单")

# ---- 5. 供应商侧结算与评价 -------------------------------------------------------------------------------
node("apinv", "FIN", 27, "登记合作伙伴发票（应付），核对 POTH 与验收结果", "document")
node("appay", "FIN", 28, "付款：泰国合作伙伴月结 15 天，其他按单结；服务类扣 3% WHT；付款凭证归档")
node("rate", "SRM", 30, "合作伙伴评价：质量、工期、价格、配合度 → 更新供应商档案与推荐权重")

# ── connectors ───────────────────────────────────────────────────────────────────────────────────────────
link("inq", BOTTOM, "hasfile", TOP)
link("hasfile", BOTTOM, "upload", TOP, "是", label_at=(lane_x["CRM"] + 0.12, row_y(1.5)))
link("hasfile", RIGHT, "pickup", LEFT, "否", via=[(chan("SCM", 0.08), row_y(1)), (chan("SCM", 0.08), row_y(2))], label_at=(lane_x["CRM"] + 1.0, row_y(1) + 0.1))
link("upload", RIGHT, "pickup", LEFT, via=[(chan("SCM", 0.08), row_y(2))])
link("pickup", BOTTOM, "hasasset", TOP)
link("hasasset", RIGHT, "photo", LEFT, "否", via=[(chan("SRM", 0.08), row_y(3)), (chan("SRM", 0.08), row_y(0) + 0.5), (lane_left["ALM"] + 0.12, row_y(0) + 0.5), (lane_left["ALM"] + 0.12, row_y(1))], label_at=(chan("SRM", 0.08) + 0.15, row_y(3) + 0.1))
link("photo", BOTTOM, "ath", TOP)
link("ath", BOTTOM, "confirm", TOP)
link("confirm", BOTTOM, "inth", LEFT, via=[(lane_x["ALM"], row_y(4))])
link("hasasset", BOTTOM, "inth", TOP, "是", via=[(lane_x["SCM"], row_y(3.55)), (lane_x["SLM"], row_y(3.55))], label_at=(lane_x["SCM"] + 0.12, row_y(3.45)))
link("inth", BOTTOM, "inspect", TOP)
link("inspect", BOTTOM, "selfrepair", TOP)
link("selfrepair", BOTTOM, "toself", TOP, "是", label_at=(lane_x["SLM"] + 0.12, row_y(6.5)))
link("selfrepair", RIGHT, "pick", LEFT, "否", label_at=(lane_x["SLM"] + 1.0, row_y(6) + 0.1))
link("pick", BOTTOM, "prth", TOP, via=[(lane_x["SRM"], row_y(6.5)), (lane_x["SCM"], row_y(6.5))])
link("prth", BOTTOM, "sendto", TOP, via=[(lane_x["SCM"], row_y(7.5)), (lane_x["SRM"], row_y(7.5))])
link("sendto", BOTTOM, "quoteback", TOP)
link("quoteback", BOTTOM, "compare", TOP)
link("compare", LEFT, "costin", RIGHT, via=[(lane_left["SRM"] - 0.6, row_y(10)), (lane_left["SRM"] - 0.6, row_y(10.5)), (lane_left["SLM"] + 0.15, row_y(10.5)), (lane_left["SLM"] + 0.15, row_y(10))])
link("costin", BOTTOM, "qtth", TOP)
link("qtth", BOTTOM, "margin", TOP)
link("margin", RIGHT, "md", LEFT, "否", label_at=(lane_x["CRM"] + 1.1, row_y(12) + 0.1))
link("md", TOP, "qtth", RIGHT, "否（修改报价）", via=[(lane_x["SLM"], row_y(11))], label_at=(lane_x["SLM"] - 0.35, row_y(11) + 0.12))
link("md", BOTTOM, "sign", RIGHT, "是", via=[(lane_x["SLM"], row_y(13))], label_at=(lane_x["SLM"] + 0.12, row_y(12.6)))
link("margin", BOTTOM, "sign", TOP, "是", label_at=(lane_x["CRM"] + 0.12, row_y(12.55)))
link("sign", LEFT, "returnasis", LEFT, "否（不修/退回）", via=[(lane_left["CRM"] + 0.15, row_y(13)), (lane_left["CRM"] + 0.15, row_y(14) + 0.55), (lane_left["SCM"] + 0.15, row_y(14) + 0.55), (lane_left["SCM"] + 0.15, row_y(14))], label_at=(lane_left["CRM"] + 0.95, row_y(14) + 0.72))
link("sign", BOTTOM, "poth", TOP, "是", via=[(lane_x["CRM"], row_y(14.5)), (lane_x["SCM"], row_y(14.5))], label_at=(lane_x["CRM"] + 0.12, row_y(13.55)))
link("poth", BOTTOM, "sendout", TOP)
link("sendout", BOTTOM, "track", TOP, via=[(lane_x["SCM"], row_y(16.5)), (lane_x["SRM"], row_y(16.5))])
link("track", BOTTOM, "change", TOP)
link("change", BOTTOM, "changedoc", TOP, "是", label_at=(lane_x["SRM"] + 0.12, row_y(18.55)))
link("changedoc", LEFT, "track", LEFT, via=[(lane_left["SRM"] + 0.12, row_y(19)), (lane_left["SRM"] + 0.12, row_y(17))])
link("change", RIGHT, "done", RIGHT, "否", via=[(lane_x["SRM"] + 0.95, row_y(18)), (lane_x["SRM"] + 0.95, row_y(20))], label_at=(lane_x["SRM"] + 0.9, row_y(18) + 0.12))
link("changedoc", RIGHT, "poth", RIGHT, "变更后的 POTH/QTTH", via=[(lane_x["SRM"] + 1.12, row_y(19)), (lane_x["SRM"] + 1.12, row_y(15.5) ), (lane_left["SRM"] - 0.2, row_y(15.5)), (lane_left["SRM"] - 0.2, row_y(15))], label_at=(lane_x["SRM"] + 0.55, row_y(15.5) + 0.12))
link("done", BOTTOM, "takeback", TOP, "我方取回（合作伙伴不接触客户）", via=[(lane_x["SRM"], row_y(20.5)), (lane_x["SCM"], row_y(20.5))], label_at=(lane_x["SCM"] + 1.15, row_y(20.5) + 0.2))
link("takeback", BOTTOM, "verify", TOP, via=[(lane_x["SCM"], row_y(21.5)), (lane_x["SLM"], row_y(21.5))])
link("verify", BOTTOM, "pass", TOP)
link("pass", RIGHT, "rework", LEFT, "否", label_at=(lane_x["SLM"] + 1.0, row_y(23) + 0.1))
link("rework", RIGHT, "track", RIGHT, via=[(lane_x["SRM"] + 1.12, row_y(23)), (lane_x["SRM"] + 1.12, row_y(17))])
link("pass", BOTTOM, "dnth", TOP, "是", via=[(lane_x["SLM"], row_y(23.5)), (lane_x["SCM"], row_y(23.5))], label_at=(lane_x["SLM"] + 0.12, row_y(23.5) + 0.1))
link("dnth", RIGHT, "ivth", LEFT)
link("dnth", BOTTOM, "deliver", TOP)
link("ivth", BOTTOM, "deliver", RIGHT, via=[(lane_x["FIN"], row_y(25))])
link("deliver", BOTTOM, "accept", TOP, via=[(lane_x["SCM"], row_y(25.5)), (lane_x["SLM"], row_y(25.5))])
link("accept", BOTTOM, "lock", TOP, "是", via=[(lane_x["SLM"], row_y(26.5)), (lane_x["CRM"], row_y(26.5))], label_at=(lane_x["SLM"] + 0.12, row_y(26.5) + 0.1))
link("accept", RIGHT, "verify", RIGHT, "否（再次检查/返修）", via=[(lane_x["SLM"] + 1.0, row_y(26)), (lane_x["SLM"] + 1.0, row_y(22))], label_at=(lane_x["SLM"] + 1.0, row_y(24.6)))
link("lock", RIGHT, "tith", TOP, via=[(lane_x["TC"], row_y(27))])
link("lock", RIGHT, "apinv", LEFT)
link("tith", BOTTOM, "sendti", TOP)
link("sendti", LEFT, "pay", RIGHT)
link("pay", BOTTOM, "payproof", TOP)
link("payproof", BOTTOM, "end", TOP)
link("payproof", LEFT, "almrec", RIGHT)
link("almrec", BOTTOM, "end", LEFT, via=[(lane_x["ALM"], row_y(32))])
link("apinv", BOTTOM, "appay", TOP)
link("appay", LEFT, "rate", RIGHT, via=[(lane_left["FIN"] - 0.1, row_y(28)), (lane_left["FIN"] - 0.1, row_y(30))])
link("rate", BOTTOM, "end", RIGHT, via=[(lane_x["SRM"], row_y(32))])

# ── legend / notes (bottom-left of SLM lane) ──────────────────────────────────────────────────────────────
page.box(lane_x["OD"], row_y(2.4), LANE_W - 0.2, 2.9,
         "说明\n单据关系：PRTH 问价（多家，无价）→ POTH 定约（一家，有价）→ 外送单交货（实物托管，引用 POTH+ATH；= OBTH 外协送修类型，返回为 IBTH 外协返回类型，不新开编号前缀）。\n0. 基本原则：合作伙伴与客户之间不得发生任何直接接触（送货、沟通、单据）；一切往来经我方，客户信息不出现在 PRTH/POTH/外送单上。\n1. 外送单与 IBTH 配对，证明客户资产出去又回来、附件齐全；也是合作伙伴丢件/损坏时的追责依据。\n"
         "2. 合作维修毛利门槛 33%：≥33% 无需 MD 批准，低于 33% 需 MD 审批（自修门槛为 50%）。\n"
         "3. 保修背靠背：对客户承诺多少天（如 60 天）就是多少天，由我方承担；POTH 中合作伙伴保修期与之一致；保修期内返修不另计费。\n"
         "4. 合作伙伴付款：泰国（TH）合作伙伴月结 15 天，其他合作伙伴按单结算；服务类扣 3% 预提税（WHT）。\n"
         "5. SRM 进度里程碑与照片写入订单时间线，仅内部可见，不向客户开放。",
         fill="#FBFBFB", line=LINE, font=6.5, align=0)

out = sys.argv[1] if len(sys.argv) > 1 else "partner_repair_flow.vsdx"
write_vsdx(out, page, title="iMROT 合作维修业务闭环流程图", page_name="合作维修业务闭环")
print("wrote", out, f"page {PAGE_W:.1f} x {PAGE_H:.1f} in, {len(page.shapes)} shapes")
