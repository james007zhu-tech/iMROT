# DBD BDEX — connecting the official juristic-person data API

Decision 2026-11-08 (朱总): connect to DBD's own API rather than a third-party data vendor.

## What BDEX is
Business Data Exchange (BDEX, https://bdex.dbd.go.th) is the Department of Business Development's data-linkage service
for government **and private** organisations (180 connected at launch: 169 government, 11 private). It replaced the old
Webservice (retired 30 Sep 2025) and follows the TGIX exchange standard. Datasets include the juristic-person
registration record (= what our new-customer form needs: names, address, status, capital), shareholder lists,
financial statements, commercial registration, foreign-business, business collateral, Business Digital ID,
trade-association data. The public `openapi.dbd.go.th` endpoint is not a product for companies — it sits behind
Incapsula and refuses server calls — so BDEX is the only official route.

## Steps (the company applies; the system is ready to take the credentials)
1. Register DUCHENG INDUSTRIAL (THAILAND) CO., LTD. at https://bdex.dbd.go.th (company tax ID 0205568072149,
   authorised signatory 朱东升). Expect to upload the company certificate and sign the data-use terms; security
   requirements are in DBD's announcement on data disclosure and use.
2. After DBD approves: register our system (DCiT OS) and request dataset 1 "ข้อมูลทะเบียนนิติบุคคล".
3. Ask bdex@dbd.go.th for the API specification (endpoint, authentication, request by 13-digit juristic ID, test
   environment) and the fee schedule — the public manual states fees exist but not the amounts.
4. Connection test, pay the fee, go live.
5. Hand the credentials to engineering: `DBD_API_URL`, `DBD_API_KEY` (or whatever token BDEX issues) in `.env`;
   `src/server/dbd.ts` already sends the key and parses the DBD namespaced JSON (`cd:OrganizationJuristicPerson`).
   If BDEX's response differs, adjust `parseDbdResponse` — the form and the fallback link stay as they are.

## E-mail to DBD (Thai, ready to send from the company mailbox)

เรื่อง: ขอทราบขั้นตอนและค่าบริการการเชื่อมโยงข้อมูลนิติบุคคลผ่านระบบ BDEX สำหรับภาคเอกชน

เรียน เจ้าหน้าที่ระบบ Business Data Exchange (BDEX) กรมพัฒนาธุรกิจการค้า

บริษัท ตูเฉิง อินดัสเทรียล (ไทยแลนด์) จำกัด (เลขทะเบียนนิติบุคคล 0205568072149) ประกอบธุรกิจบริการซ่อมบำรุงและ
ระบบอัตโนมัติอุตสาหกรรมในจังหวัดระยอง บริษัทฯ กำลังพัฒนาระบบบริหารงานบริการภายใน และประสงค์จะเชื่อมโยงข้อมูล
ทะเบียนนิติบุคคล (ชื่อ ที่อยู่ สถานะ ทุนจดทะเบียน) จากกรมฯ ผ่านระบบ BDEX เพื่อใช้ตรวจสอบและกรอกข้อมูลลูกค้า
ด้วยเลขประจำตัวผู้เสียภาษี 13 หลัก

จึงขอความอนุเคราะห์ข้อมูลดังนี้
1. ขั้นตอนและเอกสารประกอบการลงทะเบียนสำหรับหน่วยงานภาคเอกชน
2. อัตราค่าธรรมเนียมและค่าบริการข้อมูล (ต่อรายการ / รายเดือน) สำหรับชุดข้อมูลทะเบียนนิติบุคคล
3. เอกสารข้อกำหนดทางเทคนิคของ API (รูปแบบการเรียก การยืนยันตัวตน และสภาพแวดล้อมทดสอบ)
4. ข้อกำหนดด้านความมั่นคงปลอดภัยสารสนเทศที่หน่วยงานเชื่อมโยงต้องปฏิบัติ

ผู้ประสานงาน: นายจู ตงเซิง (Zhu Dongsheng) กรรมการผู้จัดการ โทร 088 660 6999 อีเมล dongsheng.zhu@ducheng-industrial.com

ขอแสดงความนับถือ
บริษัท ตูเฉิง อินดัสเทรียล (ไทยแลนด์) จำกัด

Sources: DBD manual on business-data linkage (dbd.go.th/storage/manual/3b7ecd11-…pdf); MOC provincial notice
"กรมพัฒน์ฯ เปิดระบบเชื่อมโยงข้อมูลนิติบุคคลใหม่" (chainat.moc.go.th …/iid/41260).
