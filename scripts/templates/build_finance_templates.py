#!/usr/bin/env python3
"""
Build the four finance Word templates from the approved print mockups (docs/mockups/print-templates-v0.3.html):
  20_Tax_Invoice.docx   TITH  — original + copy (two pages, same placeholders)
  21_Invoice.docx       IVTH
  22_Receipt.docx       RCTH  — original + copy
  23_Statement.docx     BLTH
Base: 19_Delivery_Note.docx (header with logo and company names, footer, page setup, styles). The body is rebuilt here.
Rules applied (AGENTS #16, #17): Helvetica / Sarabun / Noto Sans SC; no " · " joins in body text — one item per line;
two-line bilingual table headers (EN above TH) in every column; signature blocks float at the page foot; every
signature slot accepts an e-signature. Line rows carry [[L_*]] placeholders and are repeated per line by src/lib/docx/fill.ts.
    python3 scripts/templates/build_finance_templates.py
"""
import copy, sys
from pathlib import Path
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = Path(__file__).resolve().parents[2]
TPL = ROOT / "templates" / "word"
BASE = TPL / "19_Delivery_Note.docx"
NAVY, TINT, LINE, GREY = "0B2D53", "EEF4FB", "D9D9D9", "556070"
PAGE_W = 9866  # dxa between the margins

# ── low-level helpers ────────────────────────────────────────────────────────────────────────────────────────

def fonts(rpr):
    f = rpr.find(qn("w:rFonts"))
    if f is None:
        f = OxmlElement("w:rFonts"); rpr.insert(0, f)
    f.set(qn("w:ascii"), "Helvetica"); f.set(qn("w:hAnsi"), "Helvetica"); f.set(qn("w:cs"), "Sarabun"); f.set(qn("w:eastAsia"), "Noto Sans SC")

def run(p, text, size=9, bold=False, color=None, italic=False, align=None):
    r = p.add_run(text)
    r.bold = bold; r.italic = italic
    r.font.size = Pt(size)
    rpr = r._r.get_or_add_rPr(); fonts(rpr)
    sz = rpr.find(qn("w:szCs"))
    if sz is None:
        sz = OxmlElement("w:szCs"); rpr.append(sz)
    sz.set(qn("w:val"), str(int(size * 2)))
    if color: r.font.color.rgb = RGBColor.from_string(color)
    if align is not None: p.alignment = align
    return r

def spacing(p, before=0, after=0, line=None):
    pf = p.paragraph_format; pf.space_before = Pt(before); pf.space_after = Pt(after)
    if line: pf.line_spacing = line

def para(container, text="", size=9, bold=False, color=None, align=None, before=0, after=2, italic=False):
    p = container.add_paragraph()
    spacing(p, before, after)
    if text: run(p, text, size, bold, color, italic, align)
    elif align is not None: p.alignment = align
    return p

def lines(container, items, size=9, color=None, bold_first=False, align=None, after=2):
    """One item per line (rule: never join with ' · ')."""
    p = container.add_paragraph(); spacing(p, 0, after)
    if align is not None: p.alignment = align
    for i, t in enumerate(items):
        if i: p.add_run().add_break()
        run(p, t, size, bold=(bold_first and i == 0), color=color)
    return p

def shade(cell, fill):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), fill); tcpr.append(shd)

def borders(cell, color=LINE, sides=("top", "left", "bottom", "right"), sz="4", val="single"):
    tcpr = cell._tc.get_or_add_tcPr()
    b = tcpr.find(qn("w:tcBorders"))
    if b is None:
        b = OxmlElement("w:tcBorders"); tcpr.append(b)
    for s in ("top", "left", "bottom", "right"):
        e = b.find(qn(f"w:{s}"))
        if e is None:
            e = OxmlElement(f"w:{s}"); b.append(e)
        if s in sides: e.set(qn("w:val"), val); e.set(qn("w:sz"), sz); e.set(qn("w:color"), color)
        else: e.set(qn("w:val"), "nil")

def margins(cell, top=60, bottom=60, left=85, right=85):
    tcpr = cell._tc.get_or_add_tcPr()
    m = OxmlElement("w:tcMar")
    for k, v in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        e = OxmlElement(f"w:{k}"); e.set(qn("w:w"), str(v)); e.set(qn("w:type"), "dxa"); m.append(e)
    tcpr.append(m)

def set_widths(table, widths):
    table.autofit = False
    tblpr = table._tbl.tblPr
    lay = OxmlElement("w:tblLayout"); lay.set(qn("w:type"), "fixed"); tblpr.append(lay)
    tw = tblpr.find(qn("w:tblW")); tw.set(qn("w:type"), "dxa"); tw.set(qn("w:w"), str(sum(widths)))
    grid = table._tbl.tblGrid
    for gc in list(grid): grid.remove(gc)
    for w in widths:
        gc = OxmlElement("w:gridCol"); gc.set(qn("w:w"), str(w)); grid.append(gc)
    for row in table.rows:
        for i, c in enumerate(row.cells):
            tcw = c._tc.get_or_add_tcPr().find(qn("w:tcW"))
            if tcw is None:
                tcw = OxmlElement("w:tcW"); c._tc.get_or_add_tcPr().insert(0, tcw)
            tcw.set(qn("w:type"), "dxa"); tcw.set(qn("w:w"), str(widths[i]))

def no_borders(table):
    tblpr = table._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for s in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{s}"); e.set(qn("w:val"), "nil"); b.append(e)
    tblpr.append(b)

def cell_text(cell, items, size=9, bold=False, color=None, align=None, first_bold=False):
    cell.paragraphs[0].text = ""
    p = cell.paragraphs[0]; spacing(p, 0, 0)
    if align is not None: p.alignment = align
    for i, t in enumerate(items if isinstance(items, (list, tuple)) else [items]):
        if i: p.add_run().add_break()
        run(p, t, size, bold or (first_bold and i == 0), color)

def header_row(row, labels, aligns=None):
    """Two-line bilingual header: EN above TH, navy ground, white text."""
    for i, (en, th) in enumerate(labels):
        c = row.cells[i]; shade(c, NAVY); borders(c); margins(c)
        c.paragraphs[0].text = ""; p = c.paragraphs[0]; spacing(p, 0, 0)
        if aligns and aligns[i] is not None: p.alignment = aligns[i]
        run(p, en, 8, True, "FFFFFF"); p.add_run().add_break(); run(p, th, 8, False, "FFFFFF")
    row._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
    cs = OxmlElement("w:cantSplit"); row._tr.get_or_add_trPr().append(cs)

def body_cell(cell, text, align=None, size=9, color=None, bold=False, fill=None):
    borders(cell); margins(cell)
    if fill: shade(cell, fill)
    cell_text(cell, text, size, bold, color, align)

def kv_table(doc, pairs, widths=(2000, 7866), size=9):
    """Label / value rows: label in tint, EN above TH; value may be a [[FIELD]] or list of lines."""
    t = doc.add_table(rows=len(pairs), cols=2); set_widths(t, list(widths))
    for i, (label, value) in enumerate(pairs):
        lc, vc = t.rows[i].cells
        borders(lc); margins(lc); shade(lc, TINT)
        cell_text(lc, label, 8, False, NAVY, first_bold=True)
        body_cell(vc, value, size=size)
    return t

def merge_row(table, r, c0, c1):
    a = table.cell(r, c0); b = table.cell(r, c1); return a.merge(b)

def page_break(doc):
    p = doc.add_paragraph(); spacing(p, 0, 0); p.add_run().add_break(WD_BREAK.PAGE)

# ── blocks ───────────────────────────────────────────────────────────────────────────────────────────────────

def title_block(doc, title_th, title_en, title_zh, doc_label, doc_no_field, copy_label=None, extra=None, thai_first=False):
    """Left: issuer block; right: document title, ORIGINAL/COPY, number."""
    t = doc.add_table(rows=1, cols=2); set_widths(t, [5600, 4266]); no_borders(t)
    left, right = t.rows[0].cells
    for c in (left, right): margins(c, 0, 0, 0, 0)
    left.paragraphs[0].text = ""; p = left.paragraphs[0]; spacing(p, 0, 0)
    # the page header already carries the logo and both company names; the body block adds what a tax document must show
    issuer = ["สำนักงานใหญ่  Head Office", "437/3 หมู่ที่ 8 ตำบลพนานิคม อำเภอนิคมพัฒนา จังหวัดระยอง 21180", "437/3 Moo 8, Phana Nikhom, Nikhom Phatthana, Rayong 21180", "เลขประจำตัวผู้เสียภาษี  Tax ID  0205568072149", "โทร  Tel  +66 (0) 88 660 6999"] if thai_first else \
             ["Head Office 00000", "437/3 Moo 8, Phana Nikhom, Nikhom Phatthana, Rayong 21180", "Tax ID 0205568072149", "+66 (0) 88 660 6999", "dongsheng.zhu@ducheng-industrial.com"]
    for i, s in enumerate(issuer):
        if i: p.add_run().add_break()
        run(p, s, 8 if i == 0 else 7.5, bold=(i == 0), color=NAVY if i == 0 else GREY)
    right.paragraphs[0].text = ""; p = right.paragraphs[0]; spacing(p, 0, 2); p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run(p, title_th if thai_first else title_en, 16, True, NAVY); p.add_run().add_break()
    run(p, title_en if thai_first else title_th, 11, False, NAVY); p.add_run().add_break()
    run(p, title_zh, 9, False, GREY)
    if copy_label:
        p = right.add_paragraph(); spacing(p, 2, 2); p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        run(p, copy_label, 9, True, "9A4A00")
    p = right.add_paragraph(); spacing(p, 4, 0); p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    if extra:
        for s in extra: run(p, s, 8.5, False, GREY); p.add_run().add_break()
    run(p, doc_label, 8.5, False, GREY); run(p, "  "); run(p, doc_no_field, 12, True, NAVY)
    return t

def rule(doc):
    p = doc.add_paragraph(); spacing(p, 2, 4)
    ppr = p._p.get_or_add_pPr(); b = OxmlElement("w:pBdr"); e = OxmlElement("w:bottom")
    e.set(qn("w:val"), "single"); e.set(qn("w:sz"), "8"); e.set(qn("w:color"), NAVY); b.append(e); ppr.append(b)

def two_blocks(doc, left_title, left_lines, right_pairs):
    """Party block (left) and details key/value block (right), side by side."""
    t = doc.add_table(rows=1, cols=2); set_widths(t, [5200, 4666]); no_borders(t)
    lc, rc = t.rows[0].cells
    margins(lc, 0, 0, 0, 160); margins(rc, 0, 0, 0, 0)
    lc.paragraphs[0].text = ""; p = lc.paragraphs[0]; spacing(p, 0, 2)
    run(p, left_title[0], 8, True, NAVY); run(p, "  "); run(p, left_title[1], 8, False, GREY)
    p = lc.add_paragraph(); spacing(p, 0, 0)
    for i, s in enumerate(left_lines):
        if i: p.add_run().add_break()
        run(p, s, 9.5 if i == 0 else 8.5, bold=(i == 0))
    inner = rc.add_table(rows=len(right_pairs), cols=2); set_widths(inner, [1900, 2766])
    for i, (label, value) in enumerate(right_pairs):
        a, b = inner.rows[i].cells
        borders(a); margins(a, 40, 40); shade(a, TINT); cell_text(a, label, 7.5, False, NAVY, first_bold=True)
        borders(b); margins(b, 40, 40); cell_text(b, value, 8.5)
    rc.paragraphs[0]._p.getparent().remove(rc.paragraphs[0]._p)
    return t

def totals_block(doc, rows, note_lines=None, left_lines=None):
    """Totals at the right; optional notes/bank lines at the left."""
    t = doc.add_table(rows=1, cols=2); set_widths(t, [5600, 4266]); no_borders(t)
    lc, rc = t.rows[0].cells; margins(lc, 0, 0, 0, 200); margins(rc, 0, 0, 0, 0)
    lc.paragraphs[0].text = ""
    if left_lines:
        for block in left_lines:
            p = lc.add_paragraph(); spacing(p, 0, 4)
            for i, (txt, sz, bold, col) in enumerate(block):
                if i: p.add_run().add_break()
                run(p, txt, sz, bold, col)
    inner = rc.add_table(rows=len(rows), cols=2); set_widths(inner, [2200, 2066])
    for i, (label, value, strong) in enumerate(rows):
        a, b = inner.rows[i].cells
        borders(a); margins(a, 40, 40); shade(a, TINT if not strong else NAVY)
        cell_text(a, label, 8, strong, "FFFFFF" if strong else NAVY, first_bold=True)
        borders(b); margins(b, 40, 40)
        if strong: shade(b, TINT)
        cell_text(b, value, 9.5 if strong else 9, strong, NAVY if strong else None, WD_ALIGN_PARAGRAPH.RIGHT)
    rc.paragraphs[0]._p.getparent().remove(rc.paragraphs[0]._p)
    if note_lines:
        for block in note_lines:
            p = doc.add_paragraph(); spacing(p, 4, 0)
            for i, (txt, sz, bold, col) in enumerate(block):
                if i: p.add_run().add_break()
                run(p, txt, sz, bold, col)
    return t

SIG_CAPTION = "signature or e-signature + stamp / ลงนาม·ลายเซ็นอิเล็กทรอนิกส์·ตราประทับ"

def signature_block(doc, slots):
    """Floating table anchored to the bottom margin (rule #16). slots: [(role_en, role_th, name_field)]."""
    n = len(slots)
    t = doc.add_table(rows=1, cols=n); no_borders(t); set_widths(t, [PAGE_W // n] * n)
    tblpr = t._tbl.tblPr
    pp = OxmlElement("w:tblpPr")
    for k, v in (("vertAnchor", "margin"), ("tblpYSpec", "bottom"), ("horzAnchor", "margin"), ("tblpXSpec", "center"), ("topFromText", "284")): pp.set(qn(f"w:{k}"), v)
    tblpr.insert(0, pp)
    for i, (en, th, name) in enumerate(slots):
        c = t.rows[0].cells[i]; margins(c, 0, 0, 60, 60)
        c.paragraphs[0].text = ""; p = c.paragraphs[0]; spacing(p, 20, 0)
        # signature line
        ppr = p._p.get_or_add_pPr(); b = OxmlElement("w:pBdr"); e = OxmlElement("w:bottom"); e.set(qn("w:val"), "single"); e.set(qn("w:sz"), "4"); e.set(qn("w:color"), "808080"); b.append(e); ppr.append(b)
        run(p, SIG_CAPTION, 6, False, "9A9A9A")
        p = c.add_paragraph(); spacing(p, 3, 0)
        run(p, en, 8, True, NAVY); p.add_run().add_break(); run(p, th, 8, False, GREY)
        p = c.add_paragraph(); spacing(p, 1, 0)
        run(p, name, 8.5)
    tail = doc.add_paragraph(); spacing(tail, 0, 0)  # the anchor paragraph after a floating table (Word needs one at the end of the body too)
    return t

def set_footer(doc, code, extra=""):
    f = doc.sections[0].footer
    p = f.paragraphs[0]
    for r in list(p.runs)[1:]: r._r.getparent().remove(r._r)
    p.runs[0].text = f"DCiT  {code}  V1.0     Tax ID 0205568072149     Head Office 00000     {extra}{'     ' if extra else ''}"

def clear_body(doc):
    body = doc.element.body
    for el in list(body):
        if el.tag != qn("w:sectPr"): body.remove(el)

def lines_table(doc, headers, widths, template_row, aligns, size=9):
    t = doc.add_table(rows=2, cols=len(headers)); set_widths(t, widths)
    header_row(t.rows[0], headers, aligns)
    for i, v in enumerate(template_row):
        body_cell(t.rows[1].cells[i], v, aligns[i], size)
    cs = OxmlElement("w:cantSplit"); t.rows[1]._tr.get_or_add_trPr().append(cs)
    return t

R = WD_ALIGN_PARAGRAPH.RIGHT; C = WD_ALIGN_PARAGRAPH.CENTER

# ── 20 Tax invoice (TITH) — original + copy ──────────────────────────────────────────────────────────────────

def tax_invoice_page(doc, copy_label):
    title_block(doc, "ใบกำกับภาษี", "TAX INVOICE", "税务发票", "เลขที่  No.", "[[DOC_NO]]", copy_label, extra=["เล่มที่  Book  [[BOOK_NO]]"], thai_first=True)
    rule(doc)
    two_blocks(doc, ("ผู้ซื้อ", "Customer"), ["[[CUSTOMER_NAME_TH]]", "[[CUSTOMER_NAME_EN]]", "[[CUSTOMER_ADDRESS]]", "เลขประจำตัวผู้เสียภาษี  [[CUSTOMER_TAX_ID]]", "สาขาที่  [[CUSTOMER_BRANCH]]"],
               [(["วันที่", "Date"], "[[ISSUE_DATE]]"), (["อ้างอิง", "Reference"], "[[REFERENCE]]"), (["เงื่อนไขการชำระเงิน", "Terms"], "[[PAYMENT_TERMS]]"), (["ใบส่งของ", "Delivery note"], "[[DELIVERY_NOTE]]")])
    para(doc, after=3)
    lines_table(doc, [("No.", "ลำดับ"), ("Description", "รายการ"), ("Qty", "จำนวน"), ("Unit", "หน่วย"), ("Unit price", "ราคา/หน่วย"), ("Amount", "จำนวนเงิน")], [500, 5066, 800, 800, 1300, 1400],
                ["[[L_NO]]", "[[L_DESC]]", "[[L_QTY]]", "[[L_UNIT]]", "[[L_PRICE]]", "[[L_AMOUNT]]"], [C, None, R, C, R, R])
    para(doc, after=3)
    totals_block(doc, [(["รวมเงิน", "Subtotal"], "[[SUBTOTAL]]", False), (["ภาษีมูลค่าเพิ่ม [[VAT_LABEL]]", "VAT"], "[[VAT_AMOUNT]]", False), (["จำนวนเงินรวมทั้งสิ้น", "Total"], "[[CURRENCY]] [[TOTAL]]", True)],
                 left_lines=[[("([[TOTAL_WORDS_TH]])", 9, True, NAVY), ("[[TOTAL_WORDS_EN]]", 8, False, GREY)],
                             [("ชำระเงินโดยโอนเข้าบัญชี  Pay by transfer to", 8, True, NAVY), ("[[BANK_LINES]]", 8, False, None)],
                             [("หมายเหตุ  Notes", 8, True, NAVY), ("ภาษีหัก ณ ที่จ่าย (ถ้ามี) ให้หักจากยอดก่อน VAT และส่งหนังสือรับรองมาที่บริษัท", 7.5, False, GREY), ("Withholding tax, if any, is deducted from the amount before VAT; please send the certificate.", 7.5, False, GREY), ("[[NOTES]]", 8, False, None)]])
    signature_block(doc, [("Received by", "ผู้รับสินค้า/บริการ", "[[RECEIVED_BY]]"), ("Issued by", "ผู้ออกใบกำกับภาษี", "[[ISSUED_BY]]"), ("Authorised signature", "ผู้มีอำนาจลงนาม", "[[AUTHORISED_BY]]")])

def build_tax_invoice():
    doc = Document(BASE); clear_body(doc)
    tax_invoice_page(doc, "ต้นฉบับ  ORIGINAL")
    page_break(doc)
    tax_invoice_page(doc, "สำเนา  COPY")
    set_footer(doc, "FIN-TI", "จดทะเบียน VAT [[VAT_REG_DATE]]")
    doc.save(TPL / "20_Tax_Invoice.docx")

# ── 21 Invoice (IVTH) ────────────────────────────────────────────────────────────────────────────────────────

def build_invoice():
    doc = Document(BASE); clear_body(doc)
    title_block(doc, "ใบแจ้งหนี้", "INVOICE", "请款单", "IVTH No.", "[[DOC_NO]]")
    rule(doc)
    two_blocks(doc, ("Bill to", "เรียกเก็บจาก"), ["[[BILL_TO]]", "[[BILL_BRANCH]]", "[[BILL_ADDRESS]]", "Tax ID  [[CUSTOMER_TAX_ID]]", "Attn: [[ATTN]]"],
               [(["Invoice date", "วันที่"], "[[ISSUE_DATE]]"), (["Due date", "ครบกำหนด"], "[[DUE_DATE]]"), (["Tax invoice", "ใบกำกับภาษี"], "[[TAX_INVOICE_NO]]"), (["Reference", "อ้างอิง"], "[[REFERENCE]]")])
    para(doc, after=3)
    lines_table(doc, [("#", "ลำดับ"), ("Description", "รายการ"), ("Qty", "จำนวน"), ("Unit price", "ราคา/หน่วย"), ("Amount", "จำนวนเงิน")], [500, 5866, 1000, 1200, 1300],
                ["[[L_NO]]", "[[L_DESC]]", "[[L_QTY]]", "[[L_PRICE]]", "[[L_AMOUNT]]"], [C, None, R, R, R])
    para(doc, after=3)
    totals_block(doc, [(["Subtotal", "รวมก่อน VAT"], "[[SUBTOTAL]]", False), (["VAT [[VAT_LABEL]]", "ภาษีมูลค่าเพิ่ม"], "[[VAT_AMOUNT]]", False), (["Invoice total", "ยอดใบกำกับภาษี"], "[[INVOICE_TOTAL]]", False),
                       (["Less: settled to date", "หัก ชำระแล้ว"], "[[SETTLED_TO_DATE]]", False), (["Less: withholding tax [[WHT_LABEL]]", "หัก ภาษี ณ ที่จ่าย"], "[[WHT_AMOUNT]]", False), (["Amount payable", "ยอดที่ต้องชำระ"], "[[CURRENCY]] [[AMOUNT_PAYABLE]]", True)],
                 left_lines=[[("Bank transfer  โอนเงิน", 8, True, NAVY), ("[[BANK_LINES]]", 8, False, None)],
                             [("Please quote [[DOC_NO]] on the transfer. E-mail the payment slip and the withholding tax certificate (50 ทวิ) to [[ACCOUNTS_EMAIL]]. A receipt (RCTH) is issued for every payment received.", 7.5, False, GREY),
                              ("กรุณาระบุเลขที่ [[DOC_NO]] ในการโอนเงิน และส่งสลิปพร้อมหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) มาที่ [[ACCOUNTS_EMAIL]] บริษัทออกใบเสร็จรับเงิน (RCTH) ทุกครั้งที่ได้รับเงิน", 7.5, False, GREY)],
                             [("[[TAX_INVOICE_NOTE_TH]]", 7.5, True, "9A4A00"), ("[[TAX_INVOICE_NOTE_EN]]", 7.5, True, "9A4A00")]])
    signature_block(doc, [("Prepared by", "ผู้จัดทำ", "[[PREPARED_BY]]"), ("Authorised by", "ผู้มีอำนาจลงนาม", "[[AUTHORISED_BY]]")])
    set_footer(doc, "FIN-IV")
    doc.save(TPL / "21_Invoice.docx")

# ── 22 Receipt (RCTH) — original + copy ──────────────────────────────────────────────────────────────────────

def receipt_page(doc, copy_label):
    title_block(doc, "ใบเสร็จรับเงิน", "RECEIPT", "收据", "RCTH No.", "[[DOC_NO]]", copy_label, thai_first=True)
    rule(doc)
    two_blocks(doc, ("ได้รับเงินจาก", "Received from"), ["[[PAYER_NAME_TH]]", "[[PAYER_NAME_EN]]", "[[PAYER_BRANCH]]", "เลขประจำตัวผู้เสียภาษี  [[PAYER_TAX_ID]]"],
               [(["วันที่รับเงิน", "Received on"], "[[RECEIVED_ON]]"), (["วิธีชำระ", "Method"], ["[[METHOD]]", "[[BANK_REF]]"]), (["ชำระตามใบกำกับภาษี", "Against tax invoice"], "[[TAX_INVOICE_NO]]"), (["ใบแจ้งหนี้", "Invoice"], "[[INVOICE_NO]]")])
    para(doc, after=3)
    t = doc.add_table(rows=6, cols=2); set_widths(t, [7266, 2600])
    header_row(t.rows[0], [("Item", "รายการ"), ("Amount [[CURRENCY]]", "จำนวนเงิน")], [None, R])
    items = [(["ยอดใบกำกับภาษี [[TAX_INVOICE_NO]] (รวม VAT)", "Tax invoice total incl. VAT"], "[[TI_TOTAL]]", False),
             (["เงินสด/เงินโอนที่ได้รับครั้งนี้", "Cash received this payment"], "[[CASH_RECEIVED]]", True),
             (["ภาษีหัก ณ ที่จ่าย [[WHT_LABEL]]", "Withholding tax [[WHT_CERT]]"], "[[WHT_AMOUNT]]", False),
             (["ยอดชำระครั้งนี้", "Settled this payment"], "[[SETTLED]]", False),
             (["คงค้างหลังรับชำระ", "Outstanding after this payment"], "[[OUTSTANDING]]", False)]
    for i, (label, value, strong) in enumerate(items):
        a, b = t.rows[i + 1].cells
        body_cell(a, label, None, 9 if strong else 8.5, None, strong, TINT if strong else None); body_cell(b, value, R, 9.5 if strong else 9, None, strong, TINT if strong else None)
    para(doc, after=3)
    lines(doc, ["([[CASH_WORDS_TH]])"], 9, NAVY, bold_first=True, after=0)
    lines(doc, ["[[CASH_WORDS_EN]] — cash received"], 8, GREY, after=6)
    lines(doc, ["ใบเสร็จรับเงินนี้จะสมบูรณ์เมื่อบริษัทได้รับเงินเรียบร้อยแล้ว ไม่ใช่ใบกำกับภาษี และไม่มีการคำนวณ VAT ซ้ำ", "This receipt is valid once the funds are cleared. It is not a tax invoice and does not recompute VAT."], 7.5, GREY, after=0)
    signature_block(doc, [("Received by", "ผู้รับเงิน", "[[RECEIVED_BY]]"), ("Authorised signature", "ผู้มีอำนาจลงนาม", "[[AUTHORISED_BY]]")])

def build_receipt():
    doc = Document(BASE); clear_body(doc)
    receipt_page(doc, "ต้นฉบับ  ORIGINAL")
    page_break(doc)
    receipt_page(doc, "สำเนา  COPY")
    set_footer(doc, "FIN-RC")
    doc.save(TPL / "22_Receipt.docx")

# ── 23 Statement of account (BLTH) ───────────────────────────────────────────────────────────────────────────

def build_statement():
    doc = Document(BASE); clear_body(doc)
    title_block(doc, "ใบแจ้งยอดบัญชี", "STATEMENT OF ACCOUNT", "月度账单", "BLTH No.", "[[DOC_NO]]")
    rule(doc)
    two_blocks(doc, ("Customer", "ลูกค้า"), ["[[CUSTOMER_NAME]]", "[[CUSTOMER_CODE]]", "[[CUSTOMER_ADDRESS]]", "Tax ID  [[CUSTOMER_TAX_ID]]", "Attn: [[ATTN]]"],
               [(["Period", "งวด"], "[[PERIOD]]"), (["Statement date", "วันที่"], "[[ISSUE_DATE]]"), (["Credit terms", "เครดิต"], "[[CREDIT_TERMS]]"), (["Currency", "สกุลเงิน"], "[[CURRENCY]]")])
    para(doc, after=3)
    lines_table(doc, [("IVTH", "ใบแจ้งหนี้"), ("TITH", "ใบกำกับภาษี"), ("Date", "วันที่"), ("Due", "ครบกำหนด"), ("Reference", "อ้างอิง"), ("Amount", "จำนวนเงิน"), ("Paid / WHT", "ชำระ / หัก ณ ที่จ่าย"), ("Outstanding", "คงค้าง")],
                [1300, 1300, 1000, 1000, 1766, 1100, 1150, 1250], ["[[L_IVTH]]", "[[L_TITH]]", "[[L_DATE]]", "[[L_DUE]]", "[[L_REF]]", "[[L_AMOUNT]]", "[[L_PAID]]", "[[L_OUTSTANDING]]"], [None, None, None, None, None, R, R, R], size=8)
    para(doc, after=3)
    totals_block(doc, [(["Invoiced this period", "ออกบิลในงวด"], "[[INVOICED_PERIOD]]", False), (["Received this period", "รับชำระในงวด"], "[[RECEIVED_PERIOD]]", False), (["Total outstanding", "ยอดคงค้างรวม"], "[[CURRENCY]] [[TOTAL_OUTSTANDING]]", True)],
                 left_lines=[[("Please settle overdue items first and quote the IVTH numbers on your transfer. Tax invoices and receipts for the items above have been issued and are available on the customer portal.", 7.5, False, GREY),
                              ("กรุณาชำระรายการที่เกินกำหนดก่อน และระบุเลขที่ IVTH ในการโอนเงิน ใบกำกับภาษีและใบเสร็จของทุกรายการดูได้ในพอร์ทัลลูกค้า", 7.5, False, GREY)]])
    para(doc, after=2)
    lines(doc, ["Ageing  อายุหนี้"], 8, NAVY, bold_first=True, after=2)
    age = doc.add_table(rows=2, cols=5); set_widths(age, [1973] * 5)
    header_row(age.rows[0], [("Current", "ยังไม่ครบกำหนด"), ("1–30 days", "เกิน 1–30 วัน"), ("31–60 days", "เกิน 31–60 วัน"), ("61–90 days", "เกิน 61–90 วัน"), ("> 90 days", "เกิน 90 วัน")], [R] * 5)
    for i, f in enumerate(["[[AGE_CURRENT]]", "[[AGE_30]]", "[[AGE_60]]", "[[AGE_90]]", "[[AGE_OVER]]"]): body_cell(age.rows[1].cells[i], f, R)
    signature_block(doc, [("Prepared by", "ผู้จัดทำ", "[[PREPARED_BY]]"), ("Authorised by", "ผู้มีอำนาจลงนาม", "[[AUTHORISED_BY]]")])
    set_footer(doc, "FIN-BL")
    doc.save(TPL / "23_Statement.docx")

if __name__ == "__main__":
    build_tax_invoice(); build_invoice(); build_receipt(); build_statement()
    print("built 20–23")
