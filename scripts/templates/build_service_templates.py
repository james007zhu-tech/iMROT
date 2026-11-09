#!/usr/bin/env python3
"""
Rebuild the customer-facing service templates in the approved print system (docs/mockups/print-templates-v0.3.html,
same blocks as the finance templates 20–27):
  04_Repair_Service_Proposal.docx  QTTH  报价建议书   — quotation: equipment, reported problem and findings, priced lines
  06_Order_Confirmation.docx       QTTH  订单确认     — the customer's PO confirmed at the quoted prices
  12_Service_Completion.docx       QTTH  服务完成确认 — DCiT confirms the work is done and tested
  13_Customer_Acceptance.docx      QTTH  客户验收单   — the customer's acceptance decision
Rules (AGENTS #17, #18, #21): Helvetica / Sarabun / Noto Sans SC; one item per line, never " · "; two-line headers
(EN above TH) in every column; signature block floats at the page foot, first slot = the person who filled the record,
name prefilled; every slot accepts an e-signature; only fields the web form holds. Line rows use [[L_*]] placeholders.
    python3 scripts/templates/build_service_templates.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_finance_templates import (  # noqa: E402  (shared print-system blocks)
    BASE, GREY, NAVY, TINT, TPL, C, R, Document, body_cell, borders, cell_text, clear_body, kv_table, lines, lines_table, margins,
    no_borders, para, rule, run, set_footer, set_widths, shade, signature_block, spacing, title_block, totals_block, two_blocks,
)
from docx.oxml import OxmlElement  # noqa: E402


def section(doc, en, th):
    p = doc.add_paragraph(); spacing(p, 6, 3); p.paragraph_format.keep_with_next = True  # a heading never ends a page
    run(p, en, 9, True, NAVY); run(p, "  "); run(p, th, 8.5, False, GREY)
    return p

def together(t):
    """Keep a small table on one page: no row splits, every row but the last keeps with the next."""
    for i, row in enumerate(t.rows):
        row._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))
        if i < len(t.rows) - 1:
            for c in row.cells:
                for p in c.paragraphs: p.paragraph_format.keep_with_next = True
    return t

def footer(doc, code):
    set_footer(doc, code)  # version comes from build_finance_templates.VERSION

def customer_blocks(doc, right_pairs):
    two_blocks(doc, ("Customer", "ลูกค้า"), ["[[CUSTOMER_NAME]]", "[[CUSTOMER_DETAILS]]"], right_pairs)

def equipment_table(doc):
    section(doc, "Equipment", "อุปกรณ์")
    lines_table(doc, [("Asset no.", "รหัสเครื่อง"), ("Brand and model", "ยี่ห้อและรุ่น"), ("Serial no.", "หมายเลขเครื่อง"), ("Location", "ตำแหน่งติดตั้ง")], [1500, 4066, 2100, 2200],
                ["[[L_EQ_ASSET]]", "[[L_EQ_MODEL]]", "[[L_EQ_SERIAL]]", "[[L_EQ_LOCATION]]"], [None, None, None, None])

def priced_lines(doc, left_blocks, ref=(("Asset", "เครื่อง"), "[[L_ASSET]]", 1450)):
    """Priced lines, then totals at the right with the amount in words and the given label/value blocks at the left.
    ref = the third column: the machine for service work, the SKU for trade."""
    (head, ph, w) = ref
    lines_table(doc, [("#", "ลำดับ"), ("Description", "รายการ"), head, ("Qty", "จำนวน"), ("Unit", "หน่วย"), ("Unit price", "ราคา/หน่วย"), ("Amount", "จำนวนเงิน")],
                [600, 5116 - w, w, 650, 700, 1300, 1500], ["[[L_NO]]", "[[L_DESC]]", ph, "[[L_QTY]]", "[[L_UNIT]]", "[[L_PRICE]]", "[[L_AMOUNT]]"], [C, None, None, R, C, R, R])
    para(doc, after=3)
    totals_block(doc, [(["Subtotal", "รวมก่อน VAT"], "[[SUBTOTAL]]", False), (["VAT [[VAT_LABEL]]", "ภาษีมูลค่าเพิ่ม"], "[[VAT_AMOUNT]]", False), (["Total", "รวมทั้งสิ้น"], "[[CURRENCY]] [[TOTAL]]", True)],
                 left_lines=[[("([[TOTAL_WORDS_TH]])", 9, True, NAVY), ("[[TOTAL_WORDS_EN]]", 8, False, GREY)]] + [[(f"{en}  {th}", 8, True, NAVY), (value, 8, False, None)] for en, th, value in left_blocks])

def grid2(doc, rows, widths=(1800, 3133, 1800, 3133)):
    """Two label/value pairs per row (label in tint, EN above TH) — half the height of a full-width list."""
    t = doc.add_table(rows=len(rows), cols=4); set_widths(t, list(widths))
    for i, (l1, v1, l2, v2) in enumerate(rows):
        cells = t.rows[i].cells
        for j, (label, value) in enumerate(((l1, v1), (l2, v2))):
            lc, vc = cells[2 * j], cells[2 * j + 1]
            borders(lc); margins(lc); shade(lc, TINT); cell_text(lc, label, 8, False, NAVY, first_bold=True)
            body_cell(vc, value, size=8.5)
    return t

def deliverables_table(doc):
    section(doc, "Deliverables and results", "ผลส่งมอบและผลการทดสอบ")
    lines_table(doc, [("#", "ลำดับ"), ("Deliverable", "ผลส่งมอบ"), ("Acceptance criterion", "เกณฑ์การตรวจรับ"), ("Result", "ผล")], [600, 3400, 3166, 2700],
                ["[[L_DV_NO]]", "[[L_DV_ITEM]]", "[[L_DV_CRITERION]]", "[[L_DV_RESULT]]"], [C, None, None, None])

# ── 04 Service proposal / quotation ─────────────────────────────────────────────────────────────────────────

def build_proposal():
    doc = Document(BASE); clear_body(doc)
    title_block(doc, "ใบเสนอราคาบริการ", "SERVICE PROPOSAL", "报价建议书", "เลขที่  No.", "[[DOC_NO]]")
    rule(doc)
    customer_blocks(doc, [(["Date", "วันที่"], "[[ISSUE_DATE]]"), (["Requested on", "วันที่แจ้ง"], "[[REQUESTED_ON]]"), (["Service", "ประเภทงาน"], "[[SERVICE_KIND]]"), (["Our contact", "ผู้ติดต่อ"], "[[OUR_CONTACT]]")])
    equipment_table(doc)
    section(doc, "Reported problem and findings", "อาการที่แจ้งและผลการตรวจสอบ")
    together(grid2(doc, [(["Reported problem", "อาการที่แจ้ง"], "[[SYMPTOM]]", ["Findings", "ผลการตรวจสอบ"], "[[FINDINGS]]"),
                (["Production impact", "ผลกระทบต่อการผลิต"], "[[IMPACT]]", ["Recommendation", "ข้อแนะนำ"], "[[RECOMMENDATION]]")]))
    section(doc, "Scope and price", "ขอบเขตงานและราคา")
    priced_lines(doc, [])
    section(doc, "Terms", "เงื่อนไข")
    together(kv_table(doc, [(["Payment terms", "เงื่อนไขการชำระเงิน"], "[[PAYMENT_TERMS]]"), (["Warranty", "การรับประกัน"], "[[WARRANTY]]"), (["To proceed", "การยืนยัน"], "[[TO_PROCEED]]"), (["You will receive", "เอกสารที่ท่านจะได้รับ"], "[[DELIVERABLE_DOCS]]")], (2200, 7666)))
    signature_block(doc, [("Prepared by", "ผู้จัดทำ", "[[PREPARED_BY]]"), ("Authorised by", "ผู้มีอำนาจลงนาม", "[[AUTHORISED_BY]]"), ("Accepted by customer", "ลูกค้าตกลงตามข้อเสนอ", "[[CUSTOMER_SIGNATORY]]")])
    footer(doc, "SAL-RSP")
    doc.save(TPL / "04_Repair_Service_Proposal.docx")

# ── 06 Order confirmation ───────────────────────────────────────────────────────────────────────────────────

def build_order_confirmation():
    doc = Document(BASE); clear_body(doc)
    title_block(doc, "ใบยืนยันคำสั่งซื้อ", "ORDER CONFIRMATION", "订单确认", "เลขที่  No.", "[[DOC_NO]]")
    rule(doc)
    customer_blocks(doc, [(["Confirmed on", "วันที่ยืนยัน"], "[[CONFIRMED_ON]]"), (["Customer PO", "ใบสั่งซื้อลูกค้า"], "[[CUSTOMER_PO]]"), (["Our quotation", "ใบเสนอราคา"], "[[QUOTE_REF]]"), (["Payment terms", "เงื่อนไขการชำระเงิน"], "[[PAYMENT_TERMS]]")])
    equipment_table(doc)
    section(doc, "Confirmed scope and price", "ขอบเขตงานและราคาที่ยืนยัน")
    priced_lines(doc, [("Deliver to", "สถานที่ส่งมอบ", "[[DELIVER_TO]]"), ("Warranty", "การรับประกัน", "[[WARRANTY]]")])
    para(doc, before=4, after=0)
    lines(doc, ["We confirm your order for the work above at the prices shown. Any change to the scope or price is agreed in writing before the work continues.",
                "บริษัทยืนยันการรับคำสั่งซื้อสำหรับงานข้างต้นตามราคาที่ระบุ การเปลี่ยนแปลงขอบเขตงานหรือราคาจะตกลงเป็นลายลักษณ์อักษรก่อนดำเนินงานต่อ"], 7.5, GREY, after=0)
    signature_block(doc, [("Confirmed by", "ผู้ยืนยันคำสั่งซื้อ", "[[CONFIRMED_BY]]"), ("Authorised by", "ผู้มีอำนาจลงนาม", "[[AUTHORISED_BY]]"), ("Customer acknowledgement", "ลูกค้ารับทราบ", "[[CUSTOMER_SIGNATORY]]")])
    footer(doc, "SAL-OC")
    doc.save(TPL / "06_Order_Confirmation.docx")

# ── 12 Service completion ───────────────────────────────────────────────────────────────────────────────────

def completion_refs():
    return [(["Completed on", "วันที่แล้วเสร็จ"], "[[COMPLETED_ON]]"), (["Customer PO", "ใบสั่งซื้อลูกค้า"], "[[CUSTOMER_PO]]"), (["Service reports", "รายงานบริการ"], "[[REPORTS]]"), (["Delivery note", "ใบส่งของ"], "[[DELIVERY_NOTES]]")]

def build_completion():
    doc = Document(BASE); clear_body(doc)
    title_block(doc, "ใบยืนยันงานบริการแล้วเสร็จ", "SERVICE COMPLETION", "服务完成确认", "เลขที่  No.", "[[DOC_NO]]")
    rule(doc)
    customer_blocks(doc, completion_refs())
    equipment_table(doc)
    deliverables_table(doc)
    para(doc, after=3)
    together(kv_table(doc, [(["Outstanding items", "งานคงค้าง"], "[[PUNCH_LIST]]"), (["Warranty", "การรับประกัน"], "[[WARRANTY]]")], (2200, 7666)))
    para(doc, before=4, after=0)
    lines(doc, ["DCiT confirms the work above is complete and has been tested as recorded in the service reports listed. The customer's acceptance is recorded on the Customer Acceptance Record.",
                "บริษัทยืนยันว่างานข้างต้นแล้วเสร็จและผ่านการทดสอบตามรายงานบริการที่ระบุ การตรวจรับของลูกค้าบันทึกในบันทึกการตรวจรับงาน"], 7.5, GREY, after=0)
    signature_block(doc, [("Completed by", "ผู้ดำเนินงาน", "[[COMPLETED_BY]]"), ("Customer representative", "ผู้แทนลูกค้า", "[[CUSTOMER_SIGNATORY]]")])
    footer(doc, "OPS-SCC")
    doc.save(TPL / "12_Service_Completion.docx")

# ── 13 Customer acceptance ──────────────────────────────────────────────────────────────────────────────────

def build_acceptance():
    doc = Document(BASE); clear_body(doc)
    title_block(doc, "บันทึกการตรวจรับงาน", "CUSTOMER ACCEPTANCE", "客户验收单", "เลขที่  No.", "[[DOC_NO]]")
    rule(doc)
    customer_blocks(doc, [(["Accepted on", "วันที่ตรวจรับ"], "[[ACCEPTED_ON]]"), (["Customer PO", "ใบสั่งซื้อลูกค้า"], "[[CUSTOMER_PO]]"), (["Service reports", "รายงานบริการ"], "[[REPORTS]]"), (["Delivery note", "ใบส่งของ"], "[[DELIVERY_NOTES]]")])
    equipment_table(doc)
    deliverables_table(doc)
    section(doc, "Acceptance decision", "ผลการตรวจรับ")
    together(kv_table(doc, [(["Decision", "ผล"], ["[[CHK_ACCEPTED]]  Accepted  ตรวจรับ", "[[CHK_CONDITIONAL]]  Accepted with conditions  ตรวจรับโดยมีเงื่อนไข", "[[CHK_REJECTED]]  Not accepted  ไม่ผ่านการตรวจรับ"]),
                   (["Outstanding items", "งานคงค้าง"], "[[PUNCH_LIST]]"), (["Warranty", "การรับประกัน"], "[[WARRANTY]]")], (2200, 7666)))
    signature_block(doc, [("Recorded by", "ผู้บันทึก", "[[RECORDED_BY]]"), ("Accepted by customer", "ผู้ตรวจรับ (ลูกค้า)", "[[CUSTOMER_SIGNATORY]]")])
    footer(doc, "OPS-ACC")
    doc.save(TPL / "13_Customer_Acceptance.docx")

# ── 30 / 31 Trade quotation and order confirmation (贸易, 2026-11-09: SKUs only, no machine) ────────────────

SKU_COL = (("SKU", "รหัสสินค้า"), "[[L_SKU]]", 2000)

def build_trade_quotation():
    doc = Document(BASE); clear_body(doc)
    title_block(doc, "ใบเสนอราคา", "QUOTATION", "报价单", "เลขที่  No.", "[[DOC_NO]]")
    rule(doc)
    customer_blocks(doc, [(["Date", "วันที่"], "[[ISSUE_DATE]]"), (["Your reference", "อ้างอิงลูกค้า"], "[[CUSTOMER_REF]]"), (["Our contact", "ผู้ติดต่อ"], "[[OUR_CONTACT]]")])
    section(doc, "Items and price", "รายการและราคา")
    priced_lines(doc, [], SKU_COL)
    section(doc, "Terms", "เงื่อนไข")
    together(kv_table(doc, [(["Payment terms", "เงื่อนไขการชำระเงิน"], "[[PAYMENT_TERMS]]"), (["To proceed", "การยืนยัน"], "[[TO_PROCEED]]"), (["You will receive", "เอกสารที่ท่านจะได้รับ"], "[[DELIVERABLE_DOCS]]")], (2200, 7666)))
    signature_block(doc, [("Prepared by", "ผู้จัดทำ", "[[PREPARED_BY]]"), ("Authorised by", "ผู้มีอำนาจลงนาม", "[[AUTHORISED_BY]]"), ("Accepted by customer", "ลูกค้าตกลงตามข้อเสนอ", "[[CUSTOMER_SIGNATORY]]")])
    footer(doc, "SAL-QT")
    doc.save(TPL / "30_Sales_Quotation.docx")

def build_trade_order_confirmation():
    doc = Document(BASE); clear_body(doc)
    title_block(doc, "ใบยืนยันคำสั่งซื้อ", "ORDER CONFIRMATION", "订单确认", "เลขที่  No.", "[[DOC_NO]]")
    rule(doc)
    customer_blocks(doc, [(["Confirmed on", "วันที่ยืนยัน"], "[[CONFIRMED_ON]]"), (["Customer PO", "ใบสั่งซื้อลูกค้า"], "[[CUSTOMER_PO]]"), (["Our quotation", "ใบเสนอราคา"], "[[QUOTE_REF]]"), (["Payment terms", "เงื่อนไขการชำระเงิน"], "[[PAYMENT_TERMS]]")])
    section(doc, "Confirmed items and price", "รายการและราคาที่ยืนยัน")
    priced_lines(doc, [("Deliver to", "สถานที่ส่งมอบ", "[[DELIVER_TO]]")], SKU_COL)
    para(doc, before=4, after=0)
    lines(doc, ["We confirm your order for the items above at the prices shown. Any change to the items or prices is agreed in writing before delivery.",
                "บริษัทยืนยันการรับคำสั่งซื้อสำหรับรายการข้างต้นตามราคาที่ระบุ การเปลี่ยนแปลงรายการหรือราคาจะตกลงเป็นลายลักษณ์อักษรก่อนส่งมอบ"], 7.5, GREY, after=0)
    signature_block(doc, [("Confirmed by", "ผู้ยืนยันคำสั่งซื้อ", "[[CONFIRMED_BY]]"), ("Authorised by", "ผู้มีอำนาจลงนาม", "[[AUTHORISED_BY]]"), ("Customer acknowledgement", "ลูกค้ารับทราบ", "[[CUSTOMER_SIGNATORY]]")])
    footer(doc, "SAL-SOC")
    doc.save(TPL / "31_Sales_Order_Confirmation.docx")

if __name__ == "__main__":
    build_proposal(); build_order_confirmation(); build_completion(); build_acceptance()
    build_trade_quotation(); build_trade_order_confirmation()
    print("built 04, 06, 12, 13, 30, 31")
