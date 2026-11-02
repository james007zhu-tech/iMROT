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
- 0.3 应用外壳：next-intl 三语（cookie，右上角切换）、模块导航、品牌字体与配色；ALM 页面：设备列表（搜索/状态筛选）、设备详情（首页：基本信息 → 时间线 → 关联单据 → 换件 → 参数备份 → 同型号知识）、建档表单；会话与登录基础（员工 / 门户联系人，scrypt）。
- 0.4 SLM 页面：服务单列表、内部报修、服务单详情（九步进度条；按状态显示下一步面板：派工 → INTH 检测 → 报价行 → 客户确认 → RPTH/PMTH 执行与测试 → 验收 12/13 → TITH+IVTH → 收款含预扣税）；登录页。
- 0.5 客户门户（手机优先）：联系人登录、我的设备与工单、报修（铭牌二维码直达 `?asset=ATH…`）、九步进度、报价确认、验收签字、报告下载；二维码铭牌打印页 `/assets/:code/label?n=12`。
- 0.6 报告生成：无依赖的 docx 填充器（`src/lib/docx`，占位符顺序消费、XML 转义、换行）；`src/server/reports.ts` 把 INTH→08、RPTH→09/10、PMTH→11、验收→12/13 的字段从事件数据映射到模板；`/api/documents/:no/render?format=pdf` 生成 docx，并在安装了 LibreOffice 的主机上转 PDF（已用 08 模板实测：填充 → docx → PDF 正常）。
- 0.7 CRM（客户/工厂/联系人，CTH 自动分配，门户账号）、OPD（员工，ETH 自动分配）、Admin（法人、中国银行汇率、流水计数）、SCM 备件页（共享备件视图：哪些客户的设备在用）、FIN/T&O 发票视图；LLM 辅助 API（铭牌识图建档、现场记录整理、相似案例、报告翻译，只起草不落库）；`npm run smoke` 端到端跑完十步并校验编号、状态、事件、报告；Dockerfile + docker-compose（含 LibreOffice 与每日汇率任务）。

> GitHub 上 `main` 的七次提交即 v0.1–v0.7（提交信息以版本号开头）；tag 推送被代理拦截，未能打 tag。

## 下一步（Phase 1 上线前）

1. `npm install && npm run typecheck && npm test` — 本仓库在无 npm 网络的环境中编写，Next/Prisma 层尚未编译运行，首次跑通时请把报错贴回给 Claude。
2. `docker compose up -d db && npm run db:push && npm run db:seed && npm run fx:fetch && npm run smoke`。
3. 给 ETH2611001 设密码（people 页或 seed），登录后走一遍 /assets/new → /service-orders/new → 详情页十步。
- 0.8 自测：`npm run smoke:mem` 用内存版 Prisma 替身（`scripts/dev/fake-prisma.ts`，按 schema.prisma 解析关系）+ zod 替身，在无数据库、无 node_modules 的环境下跑完整个十步流程并生成 08/10/13 报告（docx + PDF）。已通过：15 条事件、编号、状态机、金额、报告无空占位符。
- 0.9 看板与 AI 助手：指标目录（`src/lib/metrics.ts`，15 个指标，AI 只能从目录选，不写 SQL）、无依赖 SVG 图表、看板页（默认看板 + 自建看板）、"描述即生成"看板构建器（有 API key 用模型选，没有则关键词回退）；全站浮动 AI 助手（文字 / 语音听写 / 拍铭牌；带工具：查设备、查服务单、相似案例、整理检测记录、建看板、读指标；草稿一键填入当前表单；门户内只看本客户数据）。smoke 增加指标、看板、动作解析校验。
- 0.10 型号库页面（品牌→系列→型号；故障代码、维护标准分系列/型号两级；BOM）、ERTH 设备接收单（07）、报价建议书 04 与订单确认 06 从 QTTH 生成、报告三语（`?lang=th|zh|en`，LLM 翻译文字字段，编号与数字不动）、BLTH 月度账单按钮、Admin 法人可编辑/新增（VN、CN）、全站搜索框、服务端动作统一错误横幅（不再白屏）、错误边界。smoke 新增 ERTH、04/06/07、BLTH。
- 0.11 设备页动作面板（流转、关联传动链、手工事件、报修、二维码标签入口）、派工可选工程师、AI 助手感知当前页表单字段（口述 → 直接填表）、seed 给 ETH2611001 设初始密码、`/api/health`、部署文档 `docs/DEPLOY.md`（Docker + Caddy 一把梭切域名）。
- 0.12 文件上传（铭牌照片、参数备份、事件附件，`/api/uploads`）、案例归档面板（第 10 步：根因/教训写回设备事件，可一键写入系列故障代码或维护标准）、备件页出入库表单（IBTH/OBTH）、员工编辑/停用/重设密码、验收点击路径 `docs/TEST-CHECKLIST.md`、无依赖类型检查 `tsconfig.check.json`。
- 0.13 AGENTS.md（给所有 AI 与人的开发守则）、Codex/Gemini 任务书改为"先跑通再打磨"、门户相机扫码（BarcodeDetector）、PWA manifest 与图标。
