"""
HR letters in the DCiT template system (python-docx, same base page header with logo and company names as 19_Delivery_Note).
  32_Salary_Adjustment_Notice.docx — 调薪通知单 / หนังสือแจ้งการปรับเงินเดือน, STRICTLY CONFIDENTIAL, Thai · English · Chinese.
Run: python3 scripts/templates/build_hr_letters.py
Wording ties to the Employee Handbook (2026-11-09): §01 values, §04 "only contribution counts", §05/§06 pay principles,
the "what counts as done" table, §10 5S, §20 confidentiality. Placeholders are filled by src/server/salary-letter.ts.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from build_finance_templates import (Document, BASE, TPL, NAVY, GREY, TINT, WD_ALIGN_PARAGRAPH, clear_body, title_block, rule, two_blocks,
                                     para, run, spacing, set_widths, header_row, body_cell, signature_block, set_footer)

RED = "B00020"
R = WD_ALIGN_PARAGRAPH.RIGHT

TH = [
    "เรียน คุณ [[SALUTATION]]",
    "ขอขอบคุณสำหรับความทุ่มเทและความตั้งใจในการทำงานตลอดช่วงที่ผ่านมา [[PRAISE_TH]]",
    "คู่มือพนักงานของเรากำหนดไว้ว่า เงินเดือนประจำจะปรับตามขนาดของผลงานที่สร้างอย่างต่อเนื่อง ขอบเขตความรับผิดชอบ และความเร็วในการเติบโตของแต่ละคน เราวัดกันที่ผลงาน ไม่ใช่เพียงความเหนื่อยยาก การปรับเงินเดือนครั้งนี้จึงเป็นการยืนยันว่าบริษัทเห็นผลงานและการเติบโตของคุณ",
    "ตั้งแต่วันที่ [[EFFECTIVE_TH]] เป็นต้นไป เงินเดือนพื้นฐานของคุณปรับจากเดือนละ [[OLD_BASE]] บาท เป็น [[NEW_BASE]] บาท เพิ่มขึ้น [[INCREASE]] บาท ([[INCREASE_PCT]]) เงินเดือนใหม่จะจ่ายครั้งแรกพร้อมเงินเดือนประจำเดือน[[FIRST_MONTH_TH]] และโอนเข้าบัญชีภายในวันที่ [[PAYDAY_TH]] เงื่อนไขการจ้างงานอื่นคงเดิมทั้งหมด เงินสมทบประกันสังคมและการหักตามกฎหมายอื่นคำนวณจากเงินเดือนใหม่ตามที่กฎหมายกำหนด",
    "ผลตอบแทนที่มากขึ้นมาพร้อมความรับผิดชอบที่มากขึ้น ขอให้คุณยึดค่านิยมของเรา ทำงานให้ได้ผลจริง คิดถึงผู้อื่น พูดให้น้อย ทำให้มาก ทำ 5S ในทุกที่ ดูแลเครื่องจักรทุกเครื่องให้ “เหมือนใหม่” และใช้งานได้จริงที่หน้างานลูกค้า และช่วยให้เพื่อนร่วมงานเติบโตไปด้วยกัน บริษัทพร้อมแบ่งปันผลสำเร็จกับผู้ที่ร่วมสร้างมัน",
    "หนังสือฉบับนี้เป็นความลับอย่างยิ่ง เพราะเป็นข้อมูลค่าตอบแทนส่วนบุคคลและข้อมูลลับของบริษัท โปรดเก็บรักษาไว้ และไม่นำไปพูดคุยหรือเผยแพร่ต่อผู้อื่น หากมีข้อสงสัยโปรดคุยกับผมโดยตรง ขอบคุณอีกครั้งครับ",
]
EN = [
    "Dear [[SALUTATION]],",
    "Thank you for your hard work and commitment. [[PRAISE_EN]]",
    "Our Employee Handbook says that fixed pay is adjusted according to the size of a person's lasting contribution, the scope of their responsibility and the pace of their growth — we count results, not effort alone. This adjustment says that we see your results and your growth.",
    "With effect from [[EFFECTIVE_EN]], your base salary increases from THB [[OLD_BASE]] to THB [[NEW_BASE]] a month, an increase of THB [[INCREASE]] ([[INCREASE_PCT]]). It is first paid with the [[FIRST_MONTH_EN]] salary, credited on or before [[PAYDAY_EN]]. All other terms of your employment stay the same; social security and other statutory deductions follow the new salary as the law requires.",
    "Greater reward comes with greater responsibility. Keep living our values — be effective, think of others, say less, do more. Keep 5S everywhere, bring every machine back “as good as new” and running at the customer's site, and help the people around you grow. The company shares its results with those who build them.",
    "This letter is strictly confidential: it holds your personal pay information and confidential company information. Please keep it safe and do not discuss or share it with others. If you have any question, talk to me directly. Thank you again.",
]
ZH = [
    "[[SALUTATION]]，你好：",
    "感谢你一直以来的投入和付出。[[PRAISE_ZH]]",
    "员工手册写明：固定薪资根据长期贡献的大小、责任范围和个人成长速度进行调整；我们只论功劳，不论苦劳。这次调薪，就是公司对你实际贡献和成长的肯定。",
    "自[[EFFECTIVE_ZH]]起，你的基本工资由每月 [[OLD_BASE]] 泰铢调整为 [[NEW_BASE]] 泰铢，增加 [[INCREASE]] 泰铢（[[INCREASE_PCT]]）。新工资首次随[[FIRST_MONTH_ZH]]工资发放，于[[PAYDAY_ZH]]或之前到账。其他雇佣条款不变；社会保险等法定扣缴按新工资依法计算。",
    "更高的回报对应更大的责任。希望你继续践行“有效，利他，少说，多做”，处处 5S，把每一台设备做到“整旧如新”、在客户现场正常运行，也带着身边的同事一起成长。公司愿意与奋斗者一起分享经营成果。",
    "本通知涉及个人薪酬信息和公司保密信息，严格保密，请妥善保管，不要与他人讨论或外传。如有疑问，请直接找我。再次感谢你！",
]

def lang_block(doc, label, paras, size, page_break=False, gap=3.5):
    p = para(doc, before=6, after=1)
    if page_break: p.paragraph_format.page_break_before = True
    run(p, label, 7.5, True, NAVY)
    for i, t in enumerate(paras):
        p = para(doc); spacing(p, 0, gap, 1.0)
        run(p, t, size, bold=(i == 0))

def build_salary_notice():
    doc = Document(BASE); clear_body(doc)
    title_block(doc, "หนังสือแจ้งการปรับเงินเดือน", "SALARY ADJUSTMENT", "调薪通知单", "Ref.", "[[LETTER_NO]]",
                copy_label="STRICTLY CONFIDENTIAL   ลับเฉพาะ   严格保密", thai_first=False)
    # the confidential mark in red, not the orange of the ORIGINAL/COPY label
    for r in doc.tables[0].rows[0].cells[1].paragraphs[1].runs: r.font.color.rgb = __import__("docx").shared.RGBColor.from_string(RED)
    rule(doc)
    two_blocks(doc, ("To", "เรียน / 致"), ["[[TO_NAME]]", "[[POSITION]]", "[[EMP_CODE]]"],
               [(["Date", "วันที่ / 日期"], "[[ISSUE_DATE]]"), (["Effective", "มีผลตั้งแต่ / 生效"], "[[EFFECTIVE_EN]]"),
                (["First paid", "จ่ายครั้งแรก / 首次发放"], "[[PAYDAY_EN]]")])
    para(doc, after=3)
    t = doc.add_table(rows=2, cols=4); set_widths(t, [3466, 2100, 2100, 2200])
    header_row(t.rows[0], [("Monthly base salary (THB)", "เงินเดือนพื้นฐาน / 基本工资"), ("Before", "เดิม / 调整前"), ("After", "ใหม่ / 调整后"), ("Increase", "เพิ่มขึ้น / 增加")], [None, R, R, R])
    c = t.rows[1].cells
    body_cell(c[0], ["Base salary", "เงินเดือนพื้นฐาน  基本工资"], size=8.5)
    body_cell(c[1], "[[OLD_BASE]]", R, 10)
    body_cell(c[2], "[[NEW_BASE]]", R, 11, NAVY, True, TINT)
    body_cell(c[3], ["[[INCREASE]]", "[[INCREASE_PCT]]"], R, 10, NAVY, True)
    lang_block(doc, "ภาษาไทย", TH, 8.5, gap=4)
    lang_block(doc, "English", EN, 8.3, gap=3)
    lang_block(doc, "中文", ZH, 9, page_break=True, gap=5)
    p = para(doc, before=10, after=0); run(p, "ขอแสดงความนับถือ", 9, False, GREY); p.add_run().add_break(); run(p, "Yours sincerely", 9, False, GREY); p.add_run().add_break(); run(p, "此致", 9, False, GREY)
    signature_block(doc, [("Managing Director", "กรรมการผู้จัดการ / 董事总经理", "[[SIGNATORY]]"),
                          ("Received and understood", "รับทราบ / 已收到并知悉", "[[EMP_NAME]]   Date / วันที่ ____________")])
    set_footer(doc, "OPD-SAL", "STRICTLY CONFIDENTIAL  ลับเฉพาะ  严格保密")
    doc.save(TPL / "32_Salary_Adjustment_Notice.docx")

if __name__ == "__main__":
    build_salary_notice()
    print("built 32")
