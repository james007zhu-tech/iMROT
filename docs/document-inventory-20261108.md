# 单据清单 — 现有系统对照维修业务闭环（2026-11-08）

对照基准：朱总《iMROT 业务闭环-维修业务》流程图 v3 + 2026-11-07 口径（整机 IBTH/OBTH 各一张必有，物料 IBTH/OBTH 零到多张）+ DCiT 文件模板体系 V1.0。
代码基准：`main` @ 1dfd49d（v0.19）。

每张单核四样：页面（列表 / 表单 / 详情）、能否单独发起、打印模板、客户文件归档、关联触发。

## 一、总表

| 单据 | 数据模型 | 列表页 | 表单页 | 详情页 | 单独发起 | 打印模板 | 客户文件归档 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ATH 设备 | Asset | /assets | /assets/new | /assets/[code] + 二维码标签 | 是 | 二维码标签（无 Word） | 铭牌照片、参数备份、事件附件 | 齐 |
| CTH 客户 | Customer / Plant / Contact | /customers | /customers/new | /customers/[code] | 是 | 无（不需要） | DBD / ภ.พ.20 / 开票信息 | 齐 |
| QTTH 服务单 + 报价 | ServiceOrder + QuoteLine | /service-orders | /service-orders/new + /quote | /service-orders/[no] | 是 | 04 报价建议书、06 订单确认 | 客户 PO、报修消息、照片 | **缺毛利门槛 / MD 审批**；缺客户询价文件归档类别 |
| INTH 检测单 | Inspection | 无（挂在服务单下） | /service-orders/[no]/inspect | 服务单页内 | 否 | 08 Diagnostic Report | 检测附件 | **缺所需物料与人工清单**，因此无法"系统判断是否有库存" |
| PRTH 采购询价 | **无** | 无 | 无 | 无 | — | **无** | — | **整个模块缺失**（只有 DocType 枚举占位） |
| POTH 采购订单 | **无** | 无 | 无 | 无 | — | **无** | — | **整个模块缺失**；**没有供应商主数据** |
| IBTH 入库 | StockMovement(IN) | /parts（按料号） | /parts/movement | 无单据详情页 | 是 | **无** | 供应商送货单号（文本） | 只有物料；**无整机入库**；无打印 |
| OBTH 出库 | StockMovement(OUT) | 同上 | /parts/movement | 无 | 是 | **无** | — | 只有物料；**无整机出库**；无打印 |
| ERTH 设备接收单 | Document(ER) + 事件 | 无 | /service-orders/[no]/receive | 服务单页内 | 否 | 07 Equipment Receiving | 随附件清单 | 齐——**它就是"待维修整机入库"的现有实现，见二-1** |
| RPTH 维修单 | RepairJob | 无 | /service-orders/[no]/repair | 服务单页内 | 否 | 09 Repair / 10 Field Service | 维修附件、参数备份 | 齐 |
| PMTH 保养记录 | RepairJob(kind=MAINTENANCE) | 无 | /service-orders/[no]/maintain | 服务单页内 | 否 | 11 PM Record | 保养附件 | 齐 |
| DNTH 送货单 | DeliveryNote | 服务单页内 | /service-orders/[no]/deliver | /deliver/[dn] | 否 | 19 Delivery Note | 客户签收件 | 齐——**它就是"已维修整机出库"的现有实现**；缺"客户自己的送货单"归档类别 |
| 验收 | Acceptance（无单号） | 无 | /service-orders/[no]/accept | 服务单页内 | 否 | 12 完成确认 / 13 客户验收 | 签字图 | **缺成本价格锁定、禁止新增 PR/PO、单据完整性检查、二次确认** |
| TITH 税务发票 | TaxInvoice | /tax（视图） | /service-orders/[no]/invoice | 无 | 否 | **无 Word**（只有 Excel） | — | 缺打印；无作废界面 |
| IVTH 请款单 | Invoice | /finance（视图） | 同上 | 无 | 否 | **无 Word**（只有 Excel） | **回款凭证无处归档**（Invoice 无 attachments 字段） | 缺打印、缺归档 |
| RCTH 收据 | **无** | 无 | 无 | 无 | — | **无**（Excel 有收据格式） | — | **新增**（11-07 决定） |
| BLTH 月度账单 | MonthlyStatement | 客户页按钮 | — | 无 | 是 | **无** | — | 缺打印、缺详情页 |
| 业务闭环开关 | closure.ts | — | — | — | — | — | — | TITH/IVTH/回款/BLTH 目前被 `BUSINESS_CLOSURE=off` 挡住 |

客户文件四类的归档现状：
- 客户 PO：ServiceOrder.attachments kind=PO ✔
- 客户询价单 / 询价文件：无专门类别（现在混在 REPORT_MSG）✘
- 客户回款凭证：无处可放 ✘
- 客户自己的送货单（客户要求用他们的 DN 签收）：无 ✘

## 二、和流程图的四个结构性差异（需要朱总定）

1. **整机的出入库，现有系统用的是 ERTH（07 设备接收单）和 DNTH（19 送货单）**，不是 IBTH/OBTH。两者记录的东西一样（机器进来、机器出去、随附件、签收），而且已经有 Word 模板和签收流程。
   选项 A：保留 ERTH/DNTH 作为整机的进出单据，IBTH/OBTH 只管物料；验收完整性检查改为"ERTH、DNTH、INTH、RPTH"。
   选项 B：按流程图，整机也开 IBTH/OBTH，ERTH/DNTH 作为它们的打印形态（同一记录两个号）——多一套号，意义不大。
   我的建议是 A。
2. **采购链整段缺失**：PRTH 询价与比价、POTH 采购订单、供应商主数据、采购到货 IBTH 与 POTH 的关联。这是最大的一块新代码。
3. **报价的毛利门槛**：QuoteLine 已有 costRef（成本参考），但没有算毛利、没有 50% 门槛、没有 MD 审批状态。需要加：成本来源（库存成本 / 比价结果）、毛利率显示、低于门槛进入"待 MD 审批"状态、审批记录。
4. **验收的财务冻结**：现在验收只是记录签字和状态。流程图要求验收时锁成本、锁价格、禁新增 PR/PO、检查单据完整性、二次确认。需要在 ServiceOrder 上加 lockedAt 和校验。

## 三、流程衔接问题（代码层面已能看出的，见 flow-test 报告补充）

- INTH 完成后流程图要"系统自行判断物料是否有库存"，现在 INTH 没有物料行，报价行是人工在 /quote 页输入。
- 流程图"客户回签 → 同时生成 RPTH 并按 PRTH 生成 POTH"：现在客户确认（/confirm）只记 PO 行，不触发任何采购动作。
- 回款后"上传回款凭证到 QTTH 项下，点击项目完成"：现在 /payment 只记金额和银行流水，无凭证上传落库，"项目完成"由状态机 CLOSED 代替。
- 复测报告已列的四条：未派工单检测/报价后卡在 RECEIVED；DBD 查询 502；无 API key 时 AI 无回退；原始 Zod 错误外露。

## 四、打印模板缺口

需要新建 Word 模板（按 DCiT 模板体系的版式、泰英双语、Navy/Blue）：PRTH 采购询价、POTH 采购订单、IBTH 入库单、OBTH 出库单、TITH 税务发票、IVTH 请款单、RCTH 收据、BLTH 月度账单。其中税票、请款、收据、账单在 Excel 工作簿里已有版式，可以照搬到 Word。
