# DCiT OS — iMROT「i」

设备全生命周期服务系统。一条硬规则：**任何记录都带设备编号**；设备页面是整个系统的首页，其他模块的列表页只是从不同角度筛选设备。

模块：**ALM** 设备（居中）· **CRM** 客户 · **SLM** 服务 · **SCM** 供应链 · **FIN** 财务 · **T&O** 税务及运营 · **OPD** 组织人才发展 · **Admin** 系统管理。
设计文档：Claude Docs《iMROT「i」信息系统设计：以变频器设备档案为核心》。

## 技术栈

Next.js 15 (App Router, TypeScript) · Prisma 6 + PostgreSQL · next-intl (th / zh / en，右上角随时切换) · Zod · Vitest · Playwright。
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
| 单据 | 2 字母 + 国家 + YYMMDD + 2 位流水，按日重置；IB/OB 3 位 | QTTH26110201 · DNTH26110601 · OBTH261102001 |

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

> GitHub 上 `main` 的提交即各版本（提交信息以版本号开头）；tag 推送被代理拦截，未能打 tag。

## 验证状态（2026-11-03）

已在 PostgreSQL 16 + Node 22 上实际跑通：`npm install` → `tsc` 零错误 → vitest 21 用例 → `prisma db push` + seed → `npm run smoke`（十步，24 事件，7 份报告 PDF）→ `next build` → `npm run e2e`（Playwright 真浏览器 33 步：登录、三语切换、型号库、客户/工厂/联系人、建档、关联、报修到回款十步、案例归档、PDF、二维码标签、出入库、搜索、AI 看板生成、月结、手机端门户登录/报修/隔离校验），无浏览器报错。

## 本地运行

```bash
docker compose up -d db && npm run db:push && npm run db:seed && npm run fx:fetch && npm run smoke && npm run dev
# 登录 dongsheng.zhu@ducheng-industrial.com / dcit2026 ；浏览器回归：npm run e2e（需 npx playwright install chromium）
```
- 0.8 自测：`npm run smoke:mem` 用内存版 Prisma 替身（`scripts/dev/fake-prisma.ts`，按 schema.prisma 解析关系）+ zod 替身，在无数据库、无 node_modules 的环境下跑完整个十步流程并生成 08/10/13 报告（docx + PDF）。已通过：15 条事件、编号、状态机、金额、报告无空占位符。
- 0.9 看板与 AI 助手：指标目录（`src/lib/metrics.ts`，15 个指标，AI 只能从目录选，不写 SQL）、无依赖 SVG 图表、看板页（默认看板 + 自建看板）、"描述即生成"看板构建器（有 API key 用模型选，没有则关键词回退）；全站浮动 AI 助手（文字 / 语音听写 / 拍铭牌；带工具：查设备、查服务单、相似案例、整理检测记录、建看板、读指标；草稿一键填入当前表单；门户内只看本客户数据）。smoke 增加指标、看板、动作解析校验。
- 0.10 型号库页面（品牌→系列→型号；故障代码、维护标准分系列/型号两级；BOM）、ERTH 设备接收单（07）、报价建议书 04 与订单确认 06 从 QTTH 生成、报告三语（`?lang=th|zh|en`，LLM 翻译文字字段，编号与数字不动）、BLTH 月度账单按钮、Admin 法人可编辑/新增（VN、CN）、全站搜索框、服务端动作统一错误横幅（不再白屏）、错误边界。smoke 新增 ERTH、04/06/07、BLTH。
- 0.11 设备页动作面板（流转、关联传动链、手工事件、报修、二维码标签入口）、派工可选工程师、AI 助手感知当前页表单字段（口述 → 直接填表）、seed 给 ETH2611001 设初始密码、`/api/health`、部署文档 `docs/DEPLOY.md`（Docker + Caddy 一把梭切域名）。
- 0.12 文件上传（铭牌照片、参数备份、事件附件，`/api/uploads`）、案例归档面板（第 10 步：根因/教训写回设备事件，可一键写入系列故障代码或维护标准）、备件页出入库表单（IBTH/OBTH）、员工编辑/停用/重设密码、验收点击路径 `docs/TEST-CHECKLIST.md`、无依赖类型检查 `tsconfig.check.json`。
- 0.13 AGENTS.md（给所有 AI 与人的开发守则）、Codex/Gemini 任务书改为"先跑通再打磨"、门户相机扫码（BarcodeDetector）、PWA manifest 与图标。
- 0.14 首次真实编译运行：修 zod 输入类型（`z.input`）、tsconfig 排除开发替身、登录按钮 type；接管设备默认在役并可在建档时选初始状态，ONBOARDED 可直接进维修；事件摘要改为语言中性（类型由界面翻译）；设备页显示系列级故障代码与维护标准；客户页修复 hydration；Playwright 浏览器回归脚本 `scripts/e2e.mjs`（33 步）。
- 0.15 三语彻底清理：所有页面写死的英文（标题、表头、占位符、下拉项、复选框、提示语、事件摘要、关联关系）全部走 next-intl，泰/中/英各约 350 条；侧栏菜单改为纯译名；事件时间线按结构化 payload 本地化渲染（`EventSummary`）。e2e 33 步仍全过。
- 0.16 按 2026-11-03 定稿的线框（Claude Design 画布）重做表单与流程：
  - 全局四条：列表页右上角「新增 XXX」；线框一律海军蓝系（橙色只给报警/冲突/必填/逾期，红色只给故障现象和报警代码）；步骤页左上角回退到应用页面；每个表单顶部有上传/粘贴框，上传即识别并填表（淡蓝底标出，`/api/ai/recognize`，无 API key 时按文本规则识别），原件随记录保存。
  - 设备：新增设备页（型号按铭牌输入、序列号重复橙色提示、配置工况、建档时直接关联电机/控制柜/PLC，「保存并打印 DCiT 二维码标签」）；设备页「历史服务」列出每次服务的全部报告。
  - 客户：新增客户只接受 DBD / ภ.พ.20 / 开票信息；按税号从 DBD 查回公司名、地址、电话、资本、状态（`src/server/dbd.ts`，接口地址可配 `DBD_API_URL`，未在线验证）；注销公司不能保存；联系人默认脱敏，重新输入密码后显示 5 分钟并记审计日志（`AuditLog`）。
  - 服务单：新增服务单（扫 DCiT 二维码标签、PO/报修附件原件存档、保存并派工）；详情页只看状态和已完成单据（按报告名称，不显示模板号）、下一步按钮、带日期的时间线；每一步是独立表单页：检测 INTH、报价、客户 PO 确认（PO 行）、设备接收 ERTH（随附件逐项）、出库 OBTH、维修 RPTH、维护保养 PMTH（按型号维护标准的保养项目、隐患、下次保养、隐患一键转报修）、送货单 DNTH、验收、开票、回款、案例归档。
  - 送货单 DNTH（新）：逐行对照 PO，ERTH 收进的随附件和 RPTH 标「退回客户」的旧件必须送回；不一致不能开具，只有 MD 填原因可批准（审计）；可分批；客户签收写设备时间线；新模板 `templates/word/19_Delivery_Note.docx`。编号 DN = 送货单，借项通知单改为 DB。
  - 组织人才（员工）和法人只有 MD 可见；法人代码 DCiT / DCiV / DCiC；员工号按所选法人的国家。
  - 报告：DCiT 模板本身是多语言，取消按 th/zh/en 分别生成；门户只能下载本客户的单据；门户每次服务的报告逐行列出并可整包 ZIP 下载。
  - 验证：tsc 0 错误、vitest 31 用例、`npm run smoke`（PostgreSQL，含 DNTH 不一致拦截、PMTH、MD 限制）、`npm run smoke:mem`、`next build`、Playwright 41 步 e2e 全过。
  - 升级本地库：`git pull && npm install && npm run db:push && npm run db:seed`（已有法人自动得到代码 DCiT，ETH2611001 设为 MD）。
- 0.17（2026-11-04 决定）：
  - 一张 IBTH / OBTH 可以有多行物料，每行对应一个 SKU（`recordStockDoc`）；编号一张单一个，单据登记一次，库存仍按 SKU 计；行上记批次、单位成本、旧件去向，单头记供应商单号。
  - 客户联系人姓名在对外报告上也脱敏：渲染前把该客户所有联系人、验收签字人、送货签收人的姓名替换为脱敏形式（`maskNamesIn`）；员工页面的时间线、送货签收、验收签字同样脱敏显示，完整姓名只在数据库和「重新输入密码后显示」里。
  - 表单校验失败返回时不再清空已填内容（`FormMemory`，会话内暂存；密码和文件不暂存）。
  - 验证：tsc 0 错误、vitest 32、smoke（PostgreSQL，含一张 IBTH 两个 SKU、报告姓名脱敏）、smoke:mem、build、e2e 41 步全过。
  - 升级本地库：`git pull && npm install && npm run db:push`。

- 0.18（2026-11-05 决定：跑通之前不做业务闭环）：
  - 业务闭环开关 `BUSINESS_CLOSURE`（默认 off，`src/lib/closure.ts`）：关闭时 TITH、IVTH、回款、BLTH 在业务层直接拒绝（`CLOSURE_OFF`），开票/回款页显示三语提示且没有保存按钮，客户页不显示 BLTH 按钮；检测、报价、维修、送货、验收、案例归档照常可走。试运行全部通过后在 `.env` 设 `BUSINESS_CLOSURE=on`。
  - 试用账号 `npm run trial:seed`：员工 `trial.staff@dcit.test`（经理，非 MD）+ 门户 `trial.portal`（试用客户 `[TRIAL] Test Rubber`，税号 0999999999999）；密码随机生成只打印在终端，可重跑重置。
  - 给 Grok 的测试任务书 `docs/GROK-TRIAL.md`（i 员工端 18 步、门户 5 步、T 原型各页签、回报格式）。
  - 修：中国银行页面改为日期栏内带时间（`2026/11/05 08:29:39`），`fx:fetch` 原来会写入无效日期而失败；smoke 的 CNY 校验改为按当天实际存储的汇率。
  - 验证：tsc 0 错误、vitest 33、smoke（PostgreSQL，含闭环关闭拦截）、smoke:mem、build；浏览器实测两个试用账号登录、开票页提示与按钮隐藏、组织人才页拒绝。
  - 升级本地库：`git pull && npm install && npm run db:push && npm run trial:seed`。
- 0.19（2026-11-05 试运行发现）门户隔离修复：
  - 根因：`.env.example` 自带 `DEV_EMPLOYEE_CODE=ETH2611001`，开发模式下（`npm run dev`）没有员工登录的请求一律当作 MD——门户联系人、甚至未登录的人都能打开员工页面、调用 `/api/*`、下载别的客户的报告。现在这个免登录只在 `DEV_AUTH_BYPASS=on` 且非生产时生效，门户联系人登录时永不生效；`.env.example` 默认注释掉。
  - `/api/documents/:no/pdf` 原来对任何门户联系人开放任意单号，现按单据客户校验；渲染、ZIP、AI 助手统一用 `sessionScope()` / `canReadDocument()`（`src/server/api-auth.ts`）。
  - 门户 ZIP 只打包门户页列出的报告类型；门户 AI 助手只给四个按客户过滤的查询工具（相似案例、指标会跨客户，员工专用）。
  - 验证：开发模式 + 旧 `.env` 下浏览器实测，修复前门户账号可见员工设备列表、他客户单据 200；修复后员工页跳登录、`/api` 401、他客户单据/ZIP 404，本客户单据/ZIP 仍 200；员工登录正常；vitest 33、smoke 通过。
  - 升级：`git pull` 后重启 `npm run dev`。员工端现在需要正常登录（不再自动以 MD 身份进入）。
