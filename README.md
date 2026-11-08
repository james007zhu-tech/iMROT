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
| 资产 / 客户 / 员工 / 供应商 | `A|C|E|S` + 国家 + YYMM + 流水（A 4 位，C/E/S 3 位），按月重置 | ATH26100001 · CTH2611001 · ETH2611001 · STH2611001 |
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
- 0.20（2026-11-07：线框逐张对照实际页面后补齐的差距 + 菜单与字体）：
  - 送货单 DNTH：顶部「关联单据」表（客户 PO 与原件、报价/订单确认、检测、设备接收、维修/维护、出库，带日期和"用于核对什么"，报告可直接打开）；逐行「本次送 · 核对」实时显示「✓ 一致 / 少 N / 多 N」；「保存草稿」占用 DNTH 号，草稿不计入已送，核对开具时沿用同一号码。
  - 维修 RPTH / 维护 PMTH 的「保存草稿」改为继续写同一张单（原来每存一次草稿就新开一个号、时间线多一条）；再次打开时带回草稿内容。RPTH 增「差旅 / 其他费用」；PMTH 增「耗材 / 换件」（默认带入本服务单出库）和「客户现场陪同人」（报告里脱敏）；检测 INTH 增「检测地点」「附件编号」；验收增「客户签字」照片（已有门户电子签时显示已签日期）。
  - 新增设备：品牌、系列、型号分成三栏；输入型号库里已有的型号会自动带出品牌和系列，型号库里没有会当场提示。
  - 法人：种子数据加 DCiV（越南）和 DCiC（中国）两个占位法人，「所属法人」下拉显示 DCiT · 泰国 · TH · THB 等，默认是创建人自己的法人；系统管理页按线框重做（带栏位名的表单，非 MD 只读，「新增法人」，缺税号橙色提示），写入走 `saveLegalEntity` 并记审计。
  - 编号修正：流水号按编号里的国家计数，不再按所选法人计数——泰国员工给 DCiV 建客户仍是 CTH 号，原来会和已有 CTH 号撞号而保存失败。
  - 报错一律可读：校验错误显示为「有栏位没填或格式不对：工厂（至少一个）」，唯一约束显示为「已存在相同记录（料号）」，其余数据库报错不再把 Prisma 原文贴到页面上（`src/lib/errors.ts`，`Flash` 统一翻译）。
  - 2026-11-05 试运行的几条：没派工就做检测或报价，服务单会自动派给做的人并推进状态（门户能看到确认报价）；付费维护单派工后下一步是报价，不是检测；占位符改为浅色斜体并以「例如」开头，不会看起来像已填。
  - 左侧菜单（2026-11-07 选定方案 C）：白底细分隔线，每项统一线条图标，中文四字「工作看板 / 设备管理 / 客户管理 / 服务管理 / 采购仓储 / 财务管理 / 税务运营 / 组织人才 / 系统管理」，当前项浅蓝底加蓝色竖条。
  - 字体：页面西文和数字改用 Helvetica（Mac 自带；Windows 用 Arial），泰文仍是 Sarabun，中文思源黑体。对外 Word / PDF 报告仍按《DCiT 文件模板体系》用 Sarabun + Noto Sans SC。
  - 验证：tsc 0 错误、vitest 41、smoke（PostgreSQL，含草稿同号、DCiV 客户编号）、smoke:mem、build、Playwright 43 步 e2e 全过；16 张线框与实际页面逐张并排截图核对。
  - 升级本地库：`git pull && npm install && npm run db:push && npm run db:seed`（Mac mini 的 Docker 开发环境：写 `.dev-ops/restart`，再写 `.dev-ops/seed`）。
- 0.20.1（2026-11-07 独立审查 v0.20 后的修正）：
  - 出错返回后点「保存草稿」会把送货单直接开具、把维修/维护单直接完成：`FormMemory` 把按钮的值也存了回去。现在只存栏位，不存按钮；草稿按钮单独提交 `draft=1`，并且不做必填校验。
  - 草稿再次保存时，这次留空的栏位会被清空（原来会保留上次的内容并印到报告上）。
  - 草稿的时间线事件保留最初的状态（如 在役 → 测试与验收），不再被改成 维修 → 维修。
  - 维修单：草稿里的换件和之后新做的出库都显示出来，不再有看不见却会被提交的行；维护单：草稿重开时型号标准里尚未测量的项目不会丢。
  - 只在服务单还在派工/诊断/执行中时续用草稿，且不续用早于已完成单的旧草稿（返工时不会捡起以前丢下的草稿）。
  - 送货单草稿页面不能打印/签收，打开会回到送货单表单；现场陪同人必须是该客户的联系人。
  - 系统管理 VAT 显示 7%（原 7.000000000000001%）；步骤页和系统管理页的报错也显示栏位中文名。
  - 验证：tsc、vitest 46、smoke（PostgreSQL，含草稿清空栏位、事件起始状态）、smoke:mem、build、Playwright 44 步（含「出错后保存草稿仍是草稿」）全过。
- 0.22.1（2026-11-08：11-05 试运行剩下的问题 + 网页图标）：
  - 网页图标（选定方案 C）：logo 里的「i」和蓝色方点放在深蓝圆角方块上；16 / 32 px 按整像素绘制，不再把横版 logo 压成方块。favicon.ico（16/32/48）、icon-16/32/192/512、apple-touch-icon；矢量源在 `docs/brand/favicon*.svg`。
  - AI 助手没配 key 时不再只回一句英文：离线模式按单号查记录和最近历史（ATH / QTTH / INTH … / CTH），按序列号或位置搜设备，口述「新建设备 变频器 序列号 … 位置 …」直接填表（`src/server/ai-offline.ts`）。
  - 汇率：中国银行抓取每次 25 秒超时、最多三次；报价页显示「1 THB = … CNY（中国银行 日期）· 合计约 CNY …」，缺汇率时橙色提示；汇率超过一天没更新，打开报价页会在后台自动重抓；系统管理页有「立即抓取中国银行汇率」。
  - DBD 查询按 DBD 实际返回格式读取（`status.code` 1000 / 1004、`cd:OrganizationJuristic…` 字段），1004 = 查无此公司；单次 12 秒，结果缓存一天（DBD 有防火墙，频繁查询会被拦）；DBD 不提供电话。
  - 服务单「已取消」按钮改为「取消服务单 / 关闭服务单」；收款开票关闭（BUSINESS_CLOSURE 未开）时，回款页不再显示上传框，财务/税务页不显示「从已验收服务单开票」，服务单不提示「下一步：开票」。
  - 本机没有 LibreOffice 时，报告按钮显示「导出 Word」，不再写 PDF 却下载 Word；macOS 上装在 /Applications 的 LibreOffice 也能找到。
  - 新增设备：序列号输入时就提示重复（保存时仍会拦）。
  - 需要 Node ≥ 22.18（package.json engines，.nvmrc = 24），Node 22.11/22.12 会全站报错。
  - 供应商编号 STH：已有供应商的库升级时 `db push` 会失败（新加的必填唯一字段），改为可空 + `db:seed` 自动补号；Mac mini 开发容器遇到只是「新增唯一约束」的提示时会自动重试。
  - 验证：tsc、vitest 60、smoke（PostgreSQL）、smoke:mem、build、Playwright 49 步（含输入时重复序列号提示、离线助手查单和口述填表、图标）全过。中国银行和 DBD 的真实抓取在本环境连不上，未实测。
- 0.22.2（2026-11-08：AI 真 key 联调 + 剩下的线框差距 + 编号防撞）：
  - AI：用 DCiT 的 key 实测，默认模型 claude-sonnet-4-5 已不可用（404），改为 claude-sonnet-5-5；两处调用统一走 `callClaude()`，.env 里写着旧模型名时自动退回默认模型。实测：变频器铭牌照片、客户 PO PDF（含两行明细）、泰文 KBank 转账单（佛历 69 → 2026）都识别正确；助手按 ATH 查维修历史正确。
  - 助手看到的客户联系人、送货签收人、验收签字人姓名一律脱敏（规则 13），它不会再把全名说出来。
  - Mac mini 开发容器：.env 的值在建容器时就固定了，之后填的 key 进不去；现在每次重启 next dev 都重新读取 .env。
  - 列表分页：服务单、客户、料号每页 20 条（设备列表原本就有）。
  - 出入库单：每行输入料号后显示名称，料号库没有的当场橙色提示。
  - 检测单 INTH：「保存草稿」（同一 INTH 号，草稿不出报告、不进时间线、不推进状态）；草稿页列出缺失项（测量值、仪器、隔离/挂牌确认、客户授权、失败项缺照片），只提醒不拦。
  - 维护单 PMTH：型号库没有维护标准时，按设备类型（变频器 / 电机 / 控制柜 / PLC / 其他）给出通用检查项和判定准则，不再是空表。
  - 编号：每个国家只在本国法人上计数；没有该国法人时拒绝编号（NO_ENTITY_FOR_COUNTRY），不再借用别的法人计数器——那样等该国法人建好后会从 001 重新开始，和已发出的号撞号。
  - 验证：tsc、vitest 73、smoke（PostgreSQL）、smoke:mem、build、Playwright 53 步全过。

