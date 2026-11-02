# DCiT OS — iMROT「i」

设备全生命周期服务系统。一条硬规则：**任何记录都带设备编号**；设备页面是整个系统的首页，其他模块的列表页只是从不同角度筛选设备。

模块：**ALM** 设备（居中）· **CRM** 客户 · **SLM** 服务 · **SCM** 供应链 · **FIN** 财务 · **T&O** 税务及运营 · **OPD** 组织人才发展 · **Admin** 系统管理。
设计文档：Claude Docs《iMROT「i」信息系统设计：以变频器设备档案为核心》。

## 技术栈

Next.js 15 (App Router, TypeScript) · Prisma 6 + PostgreSQL · next-intl (th / zh / en，右上角随时切换) · Zod · Vitest。
报告由 `templates/word/*.docx`（DCiT 文件模板体系 V1.0）填充占位符 `[[FIELD]]` 生成，再转 PDF。

## 起步

```bash
cp .env.example .env            # 填 DATABASE_URL
npm install
npm run db:push                 # 或 db:migrate
npm run db:seed                 # 泰国法人 + ETH2611001 + SIEMENS/S120 示例型号
npm run fx:fetch                # 拉一次中国银行汇率
npm run dev
```

## 编号规则（已定 2026-11-02）

| 层 | 规则 | 例 |
| --- | --- | --- |
| 资产 / 客户 / 员工 | `A|C|E` + 国家 + YYMM + 流水（A 4 位，C/E 3 位），按月重置 | ATH26100001 · CTH2611001 · ETH2611001 |
| 单据 | 2 字母 + 国家 + YYMMDD + 2 位流水，按日重置；IB/OB 3 位 | QTTH26110201 · OBTH261102001 |

国家码来自录入人的员工编号（ETH→TH，EVN→VN）。客户自己的单号原样存 `customerRef`，不改写。作废号保留。
实现：`src/lib/numbering.ts`（纯函数，有测试）+ `src/lib/numbering-db.ts`（事务内分配）。

## 数据模型要点（`prisma/schema.prisma`）

- 五级主数据：Brand → Series → Model → Asset（ATH）→ serialNumber。ATH 绑定物理机，序列号终身不变；流转只改客户/工厂/位置并写事件。
- 电机、PLC、控制柜都是独立 Asset，用 `AssetRelation`（DRIVES / INSTALLED_IN / CONTROLLED_BY / COUPLED_TO）关联。
- `AssetEvent` 只追加：所有模块写设备的唯一方式。设备状态机在 `src/server/alm.ts`，只有 ACCEPTANCE 能回到 IN_SERVICE。
- 一次服务 = 一张 `ServiceOrder`（QTTH），报修即生成草稿；INTH / RPTH / PMTH / TITH / IVTH 挂在其下。合同内服务也开 QTTH。
- 多法人 `LegalEntity`，记账币 CNY，`FxRate` 每日从中国银行抓取（`src/lib/fx/boc.ts`）。
- `Document` 登记每一个签发过的单号。

## 目录

```
prisma/            schema + seed
src/lib/           numbering, fx, db
src/server/        业务层：alm.ts（设备）slm.ts（服务）
src/app/api/       REST：/assets /assets/:code /assets/:code/events /service-orders /service-orders/:no /fx
src/jobs/          定时任务：中国银行汇率
templates/word/    DCiT 报告模板 04–13
docs/brand/        公司主数据、Logo
docs/briefs/       给 Codex / Gemini 的分工任务书
```

## 分工（见 docs/briefs/）

- Claude：数据模型、编号、业务层、API、报告生成、集成测试。
- Codex：Admin + CRM + OPD 页面（法人、用户、客户、工厂、联系人、员工）。
- Gemini：ALM 设备页面与客户门户（移动端优先）。

分支：`main` 受保护；各自 `feat/<module>-<topic>`，PR 合并，PR 必须通过 `npm run typecheck && npm test`。

## 版本

- 0.1 数据模型、编号规则、BoC 汇率、ALM/SLM 业务层与 API 骨架。
- 0.2 SLM 执行层：INTH 检测、报价行与合计（VAT、CNY 折算）、RPTH/PMTH 维修维护（含设备状态推进）、验收（12/13）、OBTH 出库写换件事件、TITH/IVTH/收款/BLTH；纯逻辑测试：money、lifecycle。
