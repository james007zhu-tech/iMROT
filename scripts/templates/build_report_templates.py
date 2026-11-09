#!/usr/bin/env python3
"""
Rebuild the six service and delivery reports in the approved print system (docs/mockups/print-templates-v0.3.html; same
blocks as 04/06/12/13 and the finance templates 20–27). Footer V2.0 marks the new version (V1.0 = original package).
  07_Equipment_Receiving.docx           ERTH  设备接收单
  08_Diagnostic_Report.docx             INTH  检测报告
  09_Repair_Report.docx                 RPTH  维修报告 (workshop)
  10_Field_Service_Report.docx          RPTH  现场服务报告 (on site)
  11_Preventive_Maintenance_Record.docx PMTH  维护保养记录
  19_Delivery_Note.docx                 DNTH  送货单
Rules (AGENTS #17, #18, #21): Helvetica / Sarabun / Noto Sans SC; one item per line, never " · "; two-line headers
(EN above TH) in every column; signature block at the page foot, first slot = the person who filled the record, name
prefilled; only fields the web form holds — internal ones (INTH needs, ETH codes, costs, stock documents) never print.
Fields: src/server/reports.ts. Line rows use [[L_*]] placeholders; a table with nothing to list gets one "—" row.
    python3 scripts/templates/build_report_templates.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_finance_templates import (  # noqa: E402
    BASE, GREY, TPL, C, R, Document, clear_body, kv_table, lines, lines_table, para, rule, signature_block, title_block, two_blocks,
)
from build_service_templates import customer_blocks, equipment_table, footer, grid2, section, together  # noqa: E402

KV = (2200, 7666)

def head(doc, th, en, zh, refs):
    title_block(doc, th, en, zh, "เลขที่  No.", "[[DOC_NO]]")
    rule(doc)
    customer_blocks(doc, refs)

def tests_table(doc):
    section(doc, "Tests and measurements", "การทดสอบและการวัด")
    lines_table(doc, [("#", "ลำดับ"), ("Test", "การทดสอบ"), ("Criterion", "เกณฑ์"), ("Result", "ผล"), ("Record", "หลักฐาน")], [600, 3000, 2566, 2200, 1500],
                ["[[L_T_NO]]", "[[L_T_TEST]]", "[[L_T_CRITERION]]", "[[L_T_RESULT]]", "[[L_T_RECORD]]"], [C, None, None, None, None])

def parts_table(doc):
    section(doc, "Parts replaced", "อะไหล่ที่เปลี่ยน")
    lines_table(doc, [("#", "ลำดับ"), ("Part", "อะไหล่"), ("Qty", "จำนวน"), ("Old serial no.", "หมายเลขเดิม"), ("New serial no.", "หมายเลขใหม่")], [600, 4266, 900, 2050, 2050],
                ["[[L_P_NO]]", "[[L_P_PART]]", "[[L_P_QTY]]", "[[L_P_OLD]]", "[[L_P_NEW]]"], [C, None, R, None, None])

# ── 07 Equipment receiving ──────────────────────────────────────────────────────────────────────────────────

def build_receiving():
    doc = Document(BASE); clear_body(doc)
    head(doc, "ใบรับอุปกรณ์", "EQUIPMENT RECEIVING", "设备接收单", [(["Received on", "วันที่รับ"], "[[RECEIVED_AT]]"), (["Order", "ใบงาน"], "[[JOB_NO]]"), (["Your reference", "อ้างอิงลูกค้า"], "[[CUSTOMER_REF]]"), (["Delivered by", "ผู้ส่งมอบ"], "[[SENDER]]")])
    equipment_table(doc)
    section(doc, "Condition on receipt", "สภาพเมื่อรับ")
    together(kv_table(doc, [(["Fault reported", "อาการที่ลูกค้าแจ้ง"], "[[FAULT]]"), (["Accessories received", "อุปกรณ์ประกอบที่รับ"], "[[ACCESSORIES]]"), (["Condition and damage", "สภาพและความเสียหาย"], "[[CONDITION]]"),
                            (["Photos", "ภาพถ่าย"], "[[PHOTO_REFERENCES]]"), (["Handling restrictions", "ข้อจำกัดในการขนย้าย"], "[[HANDLING_RESTRICTIONS]]")], KV))
    para(doc, before=4, after=0)
    lines(doc, ["Received for inspection. Repair starts only after the customer has approved the quotation.", "รับไว้เพื่อตรวจสอบ งานซ่อมจะเริ่มเมื่อลูกค้าอนุมัติใบเสนอราคาแล้วเท่านั้น"], 7.5, GREY, after=0)
    signature_block(doc, [("Received by", "ผู้รับ", "[[RECEIVED_BY]]"), ("Delivered by", "ผู้ส่งมอบ", "[[SENDER_SIGN]]")])
    footer(doc, "OPS-REC")
    doc.save(TPL / "07_Equipment_Receiving.docx")

# ── 08 Diagnostic report ────────────────────────────────────────────────────────────────────────────────────

def build_diagnostic():
    doc = Document(BASE); clear_body(doc)
    head(doc, "รายงานการตรวจสอบ", "DIAGNOSTIC REPORT", "检测报告", [(["Inspected on", "วันที่ตรวจ"], "[[INSPECTED_ON]]"), (["Order", "ใบงาน"], "[[JOB_NO]]"), (["Your reference", "อ้างอิงลูกค้า"], "[[CUSTOMER_REF]]"), (["Inspected at", "สถานที่ตรวจ"], "[[LOCATION]]")])
    equipment_table(doc)
    section(doc, "Findings", "ผลการตรวจสอบ")
    together(grid2(doc, [(["Reported symptoms", "อาการที่แจ้ง"], "[[SYMPTOMS]]", ["Inspection conditions", "เงื่อนไขการตรวจ"], "[[CONDITIONS]]"),
                         (["Findings", "ผลการตรวจ"], "[[FINDINGS]]", ["Probable cause", "สาเหตุที่เป็นไปได้"], "[[PROBABLE_CAUSE]]")]))
    together(kv_table(doc, [(["Recommendation", "ข้อเสนอแนะ"], "[[RECOMMENDATION]]")], KV))
    tests_table(doc)
    para(doc, after=3)
    together(grid2(doc, [(["Instruments", "เครื่องมือวัด"], "[[INSTRUMENTS]]", ["Photos and records", "ภาพและบันทึก"], "[[ATTACHMENTS]]"),
                         (["Open issues", "ประเด็นค้าง"], "[[OPEN_ISSUES]]", ["Conclusion and limits", "สรุปและข้อจำกัด"], "[[CONCLUSION]]")]))
    signature_block(doc, [("Inspected by", "ผู้ตรวจสอบ", "[[ENGINEER]]"), ("Approved by", "ผู้อนุมัติ", "[[APPROVER]]"), ("Customer acknowledgement", "ลูกค้ารับทราบ", "[[CUSTOMER_SIGNATORY]]")])
    footer(doc, "OPS-DIA")
    doc.save(TPL / "08_Diagnostic_Report.docx")

# ── 09 Repair report (workshop) ─────────────────────────────────────────────────────────────────────────────

def build_repair():
    doc = Document(BASE); clear_body(doc)
    head(doc, "รายงานการซ่อม", "REPAIR REPORT", "维修报告", [(["Completed on", "วันที่ซ่อมเสร็จ"], "[[COMPLETED_ON]]"), (["Order", "ใบงาน"], "[[JOB_NO]]"), (["Your reference", "อ้างอิงลูกค้า"], "[[CUSTOMER_REF]]"), (["Diagnostic report", "รายงานการตรวจสอบ"], "[[INSPECTION_REF]]")])
    equipment_table(doc)
    section(doc, "Fault and repair", "ข้อขัดข้องและการซ่อม")
    together(grid2(doc, [(["Confirmed fault", "ข้อขัดข้องที่ยืนยัน"], "[[CONFIRMED_FAULT]]", ["Root cause", "สาเหตุ"], "[[ROOT_CAUSE]]")]))
    together(kv_table(doc, [(["Work performed", "งานที่ดำเนินการ"], "[[WORK_PERFORMED]]"), (["Parameter backup", "การสำรองค่าพารามิเตอร์"], "[[CONFIG_BACKUP]]")], KV))
    parts_table(doc)
    tests_table(doc)
    para(doc, after=3)
    together(grid2(doc, [(["Open issues", "ประเด็นค้าง"], "[[OPEN_ISSUES]]", ["Conclusion", "สรุป"], "[[CONCLUSION]]")]))
    signature_block(doc, [("Repaired by", "ผู้ซ่อม", "[[ENGINEER]]"), ("Approved by", "ผู้อนุมัติ", "[[APPROVER]]"), ("Customer acknowledgement", "ลูกค้ารับทราบ", "[[CUSTOMER_SIGNATORY]]")])
    footer(doc, "OPS-RPR")
    doc.save(TPL / "09_Repair_Report.docx")

# ── 10 Field service report (on site) ───────────────────────────────────────────────────────────────────────

def build_field_service():
    doc = Document(BASE); clear_body(doc)
    head(doc, "รายงานบริการนอกสถานที่", "FIELD SERVICE REPORT", "现场服务报告", [(["Service date", "วันที่ให้บริการ"], "[[SERVICE_DATE]]"), (["Order", "ใบงาน"], "[[JOB_NO]]"), (["Your reference", "อ้างอิงลูกค้า"], "[[CUSTOMER_REF]]"), (["Time on site", "เวลาปฏิบัติงาน"], "[[TIME_ON_SITE]]")])
    equipment_table(doc)
    section(doc, "Work on site", "งานที่หน้างาน")
    together(grid2(doc, [(["Issue and scope", "ปัญหาและขอบเขตงาน"], "[[ISSUE_SCOPE]]", ["Root cause", "สาเหตุ"], "[[ROOT_CAUSE]]")]))
    together(kv_table(doc, [(["Work performed", "งานที่ดำเนินการ"], "[[WORK_PERFORMED]]"), (["Restoration and handover", "การคืนระบบและส่งมอบ"], "[[HANDOVER]]")], KV))
    parts_table(doc)
    tests_table(doc)
    para(doc, after=3)
    together(kv_table(doc, [(["Open issues", "ประเด็นค้าง"], "[[OPEN_ISSUES]]")], KV))
    signature_block(doc, [("Serviced by", "ผู้ปฏิบัติงาน", "[[ENGINEER]]"), ("Customer on site", "ผู้แทนลูกค้า ณ หน้างาน", "[[CUSTOMER_SIGNATORY]]")])
    footer(doc, "OPS-FSR")
    doc.save(TPL / "10_Field_Service_Report.docx")

# ── 11 Maintenance record ───────────────────────────────────────────────────────────────────────────────────

def build_maintenance():
    doc = Document(BASE); clear_body(doc)
    head(doc, "บันทึกการบำรุงรักษา", "MAINTENANCE RECORD", "维护保养记录", [(["Visit date", "วันที่เข้าบริการ"], "[[VISIT_DATE]]"), (["Order", "ใบงาน"], "[[JOB_NO]]"), (["Maintenance level", "ระดับงาน"], "[[LEVEL]]"), (["Running hours", "ชั่วโมงการทำงาน"], "[[RUN_HOURS]]")])
    equipment_table(doc)
    section(doc, "Checklist", "รายการตรวจ")
    lines_table(doc, [("#", "ลำดับ"), ("Item", "รายการตรวจ"), ("Criterion", "เกณฑ์"), ("Measured", "ค่าที่วัด"), ("Result", "ผล")], [600, 3266, 2300, 1800, 1900],
                ["[[L_C_NO]]", "[[L_C_ITEM]]", "[[L_C_CRITERION]]", "[[L_C_MEASURED]]", "[[L_C_RESULT]]"], [C, None, None, None, None])
    para(doc, after=3)
    together(kv_table(doc, [(["Overall condition", "สภาพโดยรวม"], "[[CONDITION]]"), (["Hazards found", "ความเสี่ยงที่พบ"], "[[HAZARDS]]"), (["Fixed on this visit", "แก้ไขในครั้งนี้"], "[[HANDLED]]"),
                            (["Consumables and parts", "วัสดุสิ้นเปลืองและอะไหล่"], "[[CONSUMABLES]]"), (["Recommendation", "ข้อเสนอแนะ"], "[[RECOMMENDATION]]"), (["Next maintenance", "การบำรุงรักษาครั้งถัดไป"], "[[NEXT_DUE]]")], KV))
    signature_block(doc, [("Serviced by", "ผู้ปฏิบัติงาน", "[[ENGINEER]]"), ("Customer representative", "ผู้แทนลูกค้า", "[[CUSTOMER_SIGNATORY]]")])
    footer(doc, "OPS-PMR")
    doc.save(TPL / "11_Preventive_Maintenance_Record.docx")

# ── 19 Delivery note ────────────────────────────────────────────────────────────────────────────────────────

def build_delivery():
    doc = Document(BASE); clear_body(doc)
    title_block(doc, "ใบส่งของ", "DELIVERY NOTE", "送货单", "เลขที่  No.", "[[DOC_NO]]")
    rule(doc)
    two_blocks(doc, ("Deliver to", "ส่งที่"), ["[[CUSTOMER_NAME]]", "[[DELIVER_TO]]"],
               [(["Delivery date", "วันที่ส่ง"], "[[DELIVER_ON]]"), (["Customer PO", "ใบสั่งซื้อลูกค้า"], "[[CUSTOMER_PO]]"), (["Order", "ใบงาน"], "[[JOB_NO]]"), (["Delivered by", "ผู้ส่งของ"], "[[DRIVER]]")])
    section(doc, "Items delivered", "รายการที่ส่งมอบ")
    lines_table(doc, [("#", "ลำดับ"), ("Description", "รายการ"), ("Machine or SKU", "เครื่องหรือรหัสสินค้า"), ("Qty", "จำนวน")], [600, 5466, 2600, 1200],
                ["[[L_NO]]", "[[L_DESC]]", "[[L_REF]]", "[[L_QTY]]"], [C, None, None, R])
    section(doc, "Returned to you", "ส่งคืนลูกค้า")
    lines_table(doc, [("#", "ลำดับ"), ("Item", "รายการ"), ("From", "จากเอกสาร"), ("Qty", "จำนวน")], [600, 5466, 2600, 1200],
                ["[[L_R_NO]]", "[[L_R_ITEM]]", "[[L_R_FROM]]", "[[L_R_QTY]]"], [C, None, None, R])
    para(doc, after=3)
    together(kv_table(doc, [(["Remarks", "หมายเหตุ"], "[[REMARKS]]")], KV))
    para(doc, before=4, after=0)
    lines(doc, ["[[ACK_EN]]", "[[ACK_TH]]"], 7.5, GREY, after=0)  # receipt wording; a returned-unrepaired machine (quote declined) says so
    signature_block(doc, [("Issued by", "ผู้ออกเอกสาร", "[[ISSUED_BY]]"), ("Delivered by", "ผู้ส่งของ", "[[DRIVER_NAME]]"), ("Received by", "ผู้รับของ", "[[RECEIVED_BY]]")])
    footer(doc, "OPS-DLV")
    doc.save(TPL / "19_Delivery_Note.docx")

if __name__ == "__main__":
    build_receiving(); build_diagnostic(); build_repair(); build_field_service(); build_maintenance(); build_delivery()
    print("built 07, 08, 09, 10, 11, 19")
