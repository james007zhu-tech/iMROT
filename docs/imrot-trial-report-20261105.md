# iMROT 试运行测试报告（2026-11-05，Mac mini，Asia/Bangkok UTC+7 10:00–11:30）

环境：repo ~/src/imrot（commit 1414f2c），Node 24.11，Next.js 15 dev（localhost:3000），Postgres imrot-db-1。Playwright 1.x + Chromium（装在 /Volumes/Data for Macmini/dev/trial-pw，未改 repo 的 package.json）。员工端用桌面窗口，门户用 390×844 手机视口。BUSINESS_CLOSURE 全程为 off，未改、未绕过。未改 repo 源码。
试用数据：新建 GrokTestBrand/GrokSeries1/GTM-001、CTH2611002 [TRIAL] Grok Test Co.、ATH26110001–003、QTTH26110501–505、GTB-FAN-01/GTB-IGBT-01 等，均为测试数据。

## 问题清单

[i-员工] 0 · 环境 / npm run fx:fetch · —
操作：按准备步骤运行 npm run fx:fetch
期望：拉取中国银行汇率
实际：ETIMEDOUT（连不上中国银行）；FxRate 表为 0 行，/admin 显示「尚无汇率」。连带：所有报价 totalCny/fxRateToCny 为空，报价页无 CNY 折算（见步骤 7）
严重程度：错误

[i-员工] 0 · 环境 / npm run dev · —
操作：在 Node 22.11 / 22.12 下启动 dev server
期望：页面 200
实际：全站 500，ERR_REQUIRE_ESM（magic-string，经 @tailwindcss/node 4.3.4 引入）；换 Node 24 解决。package.json 没有 "engines" 字段，也无 .nvmrc
严重程度：阻断（建议：package.json 加 "engines": {"node": ">=22.18"}（或 >=24）并加 .nvmrc）

[i-门户] 5 · /api/portal/orders/[no]/zip、/api/documents/[no]/render、员工端全部页面 · 全部语言
操作：门户账号 trial.portal 登录后，直接请求别的客户（CTH2611002）的 QTTH26110504 的 ZIP、INTH26110504 报告，以及打开员工页 /assets/ATH26110003、/service-orders/QTTH26110504；另用未登录的浏览器请求同样地址
期望：拒绝访问
实际：门户页面 /portal/orders/QTTH26110504 正确返回 404；但 ZIP（188 KB）和 docx 报告都返回 200 能下载，门户账号甚至未登录访客都能打开员工端页面，侧栏显示「บุคลากร/系统」（相当于 MD 身份）。原因：.env.example 自带 DEV_EMPLOYEE_CODE=ETH2611001（MD），src/server/auth.ts:49 没有 Cookie 时退回到这个员工号，而且第 49 行没有判断 NODE_ENV（第 38 行有）。按 GROK-TRIAL 准备步骤 cp .env.example .env 就会带上它
严重程度：阻断（建议：.env.example 删掉 DEV_EMPLOYEE_CODE 或注释掉；auth.ts:49 加 NODE_ENV 判断；门户 ZIP 和文档 API 必须校验门户会话的 customerId。按要求未改 .env，本次没有在关掉它之后复测）

[i-员工] 7 · /service-orders/QTTH26110503 → /inspect、/quote · 中文
操作：PMTH 隐患一键转出的报修单 QTTH26110503（未派工，状态「已受理」）直接做检测 INTH 和报价
期望：要么提示先派工，要么状态推进到诊断中 → 待确认报价
实际：INTH26110502 和报价（THB 3745）都保存成功，但状态一直是 RECEIVED，quoteSentAt 为空；门户看不到「确认报价」。也没有任何提示。（先派工的 QTTH26110501/505 推进正常）
严重程度：错误

[i-员工] 7 · /service-orders/[no]/quote · 中文/EN/ไทย
操作：报价保存后看金额
期望：报价有泰文品名、VAT、CNY 折算
实际：泰文品名和 VAT 7%（15000 + 1050 = 16050）正确；没有 CNY 折算（汇率表为空，见 fx:fetch）。页面上只写着「CNY 按最新中国银行汇率折算」，没有数字，也没有「缺汇率」提示
严重程度：错误（主因在汇率）；建议缺汇率时显示提示

[i-员工] 4 · /customers/new · 中文
操作：输入税号 0107537000114，点「从 DBD 查询」
期望：从 DBD 带出公司信息；注销公司不能保存
实际：/api/dbd/… 返回 502，约 24 秒后才提示「DBD 查询失败，请手工填写」（慢页面 >3s）。手工填写后能保存，拿到 CTH2611002。因为 DBD 连不上，「注销公司不能保存」没法验证。ภ.พ.20 识图需要 AI key（.env 里 ANTHROPIC_API_KEY 是空的），未测
严重程度：错误（DBD 不可用 + 等太久）；注销校验：未验证

[i-员工] 4/18 · /customers/new · 中文
操作：不填工厂就保存
期望：给出可读的报错，已填内容保留
实际：已填内容保留；但报错直接显示原始 Zod JSON（[ { "code": "too_small", … "message": "at least one plant" … } ]），URL 里也是这段 JSON，而且没有翻译
严重程度：显示

[i-员工] 15 · /parts/new · 中文
操作：新建料号 GrokTestBrand + FAN-01（SKU GTB-FAN-01 之前在型号 BOM 里已经自动生成）
期望：提示「料号已存在」
实际：直接显示 Prisma 原始报错「Invalid `prisma.part.create()` invocation: Unique constraint failed on the fields: (`sku`)」
严重程度：显示

[i-员工] 5 · /assets/new · 中文
操作：录入重复序列号 GRK-V-001
期望：序列号重复时出现橙色提示
实际：输入时没有提示；点保存后才跳出 ⚠「序列号 GRK-V-001 已存在于 ATH26110002（…）」并拦住保存。结果对，但不是实时提示
严重程度：建议

[i-员工] 16 · AI 助手（右下角 AI 按钮）· 中文
操作：问「ATH26110002 的维修历史是什么？」；口述「新建设备 变频器 序列号 GRK-V-009 位置 Line 3」
期望：没有 API key 时按关键词回退
实际：两次都只回一句英文「ANTHROPIC_API_KEY is not configured on the server.」，没有回退，也没有翻译。看板 AI（/dashboard 描述生成）有回退，能生成看板（约 6.5 秒）
严重程度：错误

[i-员工] 14 · /api/documents/[no]/render?format=pdf · 全部
操作：点各报告的「PDF」（报价建议书 04、订单确认 06、服务完成确认 12、客户验收单 13、INTH、RPTH、ERTH、DNTH）
期望：能打开 PDF，没有 [[占位符]]，联系人脱敏
实际：8 份都返回 200，没有 [[…]]，联系人显示为 S****，不显示全名。但下载下来的是 .docx，不是 PDF：本机没装 LibreOffice（soffice），代码会退回 docx。按钮写着「PDF」，文件却是 Word；门户 ZIP 里也全是 .docx。OBTH/IBTH 没有模板（返回 400 "no Word template for document type OB"）
严重程度：显示（建议：本机装 LibreOffice，或者 GROK-TRIAL 准备步骤里写明；按钮按实际格式显示）

[i-员工] 17 · /admin · 中文
操作：经理账号打开系统管理
期望：法人编辑被拒绝（只有 MD）
实际：没有保存按钮，服务端也有 MD 校验，所以改不了，结论算通过。但法人表单的输入框（名称、税号、地址、VAT 等）对经理是可以编辑的，只有 countryCode 只读，容易让人误会
严重程度：显示

[i-员工] 11 · /service-orders/[no]/payment、/finance · 全部
操作：查看回款页和财务页
期望：橙色提示，没有开具/保存按钮
实际：符合（见通过表）。但回款页还留着「选择文件/拍照/粘贴」上传控件；/finance 和 /tax 还显示「＋ 从已验收服务单开票」入口；已验收服务单上显示「下一步：开票」
严重程度：建议

[i-员工] 7 · /service-orders/[no] · 中文
操作：看服务单详情的状态按钮
期望：取消按钮的文字要明确
实际：取消服务单的按钮文字是「已取消」（状态名），容易被看成当前状态
严重程度：显示

[i-员工] 8 · /service-orders/[no]（维护保养单）· 中文
操作：新建「维护」类服务单
期望：下一步应该是 PMTH
实际：下一步提示是「检测单 INTH」（直接打开 /maintain 也能做）
严重程度：建议

[i-员工] 8 · /service-orders/[no]/receive · 中文
操作：设备接收 ERTH 不改「随附件」就保存
期望：给出可见提示
实际：「随附件」示例文字是 placeholder，看上去已经填了，其实是空的必填项；浏览器原生拦截，页面上没有可见报错（只有浏览器气泡）
严重程度：显示

[T] — · T 模块 · —
操作：—
期望：—
实际：需要朱总给 Share 链接，本次未测
严重程度：未测试

## 步骤通过表

| 端 | 步骤 | 内容 | 结果 | 备注 |
|---|---|---|---|---|
| 员工 | 1 | 登录、侧栏没有组织人才 | 通过 | 经理登录后侧栏没有「组织人才」 |
| 员工 | 2 | 型号库 品牌→系列→型号、故障代码/维护标准/BOM | 通过 | 系列级、型号级都能加 |
| 员工 | 3 | 工厂/联系人、脱敏、密码显示 5 分钟、错误密码提示 | 通过 | 「密码不对」；「完整信息显示 5 分钟（已记入审计日志）」 |
| 员工 | 4 | 新增客户（DBD/ภ.พ.20）、注销公司不能保存 | 部分 | 手工建档拿到 CTH2611002；DBD 502；注销校验未验证 |
| 员工 | 5 | 建变频器、关联电机、时间线、重复序列号 | 通过（有建议） | ATH26110002 驱动 ATH26110001；重复序列号在保存时才拦 |
| 员工 | 6 | 标签页、流转、手工事件、上传照片 | 通过 | 都进了时间线 |
| 员工 | 7 | 报修→派工→INTH→报价→PO 确认 | 部分 | 流程跑通、QTTH 编号正常；没有 CNY；未派工的单状态不推进 |
| 员工 | 8 | ERTH→OBTH（多行）→RPTH / PMTH 隐患转报修 | 通过 | 设备变成「测试与验收」；PMTH26110501 → QTTH26110503 |
| 员工 | 9 | DNTH 少送被拦、改对后开具、签收 | 通过 | 「与 PO 不一致，只有 MD 可以批准开具」；DNTH26110501 已签收 |
| 员工 | 10 | 验收（有条件） | 通过 | 设备回到「在役运行」，服务单「已验收」 |
| 员工 | 11 | 开票页/回款页 橙色提示、没有开具/保存 | 通过 | 三种语言都显示（border-alert #F2A33A 橙色）；中文：「试用阶段：业务闭环（开票、请款、回款、月度账单）暂不开放…」 |
| 员工 | 12 | 月结客户不显示 BLTH 按钮 | 通过 | 只有「月结客户（BLTH）」属性文字，没有按钮 |
| 员工 | 13 | 案例归档、写入时间线和系列故障代码 | 通过 | F30001 和维护项写入系列 |
| 员工 | 14 | 各报告 PDF | 部分 | 内容 OK、没有占位符、已脱敏；但输出是 docx（没装 LibreOffice） |
| 员工 | 15 | 备件 IBTH/OBTH 多 SKU | 通过（有显示问题） | IBTH261105001、OBTH261105001 各 2 行，库存 5→3 / 5→4 |
| 员工 | 16 | 搜索、看板生成、AI 助手 | 部分 | 搜索、看板通过；AI 助手没有回退 |
| 员工 | 17 | /people、/admin 法人编辑被拒 | 通过（有显示问题） | /people 显示「无权限」；法人没有保存按钮 |
| 员工 | 18 | 漏填必填项 | 通过（有显示问题） | 已填内容保留；服务端报错是原始 JSON |
| 门户 | 1 | 登录、只看本客户 | 通过 | 只列出 CTH2611001 的设备和单据；手机视口没有横向滚动 |
| 门户 | 2 | 报修（?asset=ATH…） | 通过 | QTTH26110505，员工端能看到 |
| 门户 | 3 | 九步进度、报价确认、验收签字 | 通过 | 门户确认后员工端变成「执行中」；签字后变成「已验收」 |
| 门户 | 4 | 报告下载、整包 ZIP | 部分 | 本客户 ZIP/报告能下载（docx）；但也能下载别的客户的（见 5） |
| 门户 | 5 | 隔离 | 不通过 | 门户页面 404 正确；ZIP、报告 API、员工页面都没有隔离（DEV_EMPLOYEE_CODE） |
| T | 全部 | T 模块 | 未测试 | 需要 Share 链接 |

三语切换：员工端 34 个页面、门户 4 个页面都切过 ไทย/中文/EN，没有发现漏翻的界面文字（只有用户数据和专有名词）；dev 模式下除 DBD 查询（约 24 秒）以外，所有页面加载都在 3 秒以内（大多 0.2–1.9 秒）。

## 截图（/Volumes/Data for Macmini/dev/trial-pw/shots/）
s02_models_tree_zh.png, s02_model_detail_zh.png, s03_wrong_pw.png, s03_revealed.png, s04_dbd_lookup.png, s04_save.png（原始 JSON 报错）, s04_new_customer.png, s05_asset_detail.png, s05_dup_serial.png, s06_label.png, s06_asset_timeline.png, s07_so_created.png, s07_inspect_saved.png, s07_quote_saved.png, s07_po_confirmed.png, s08_erth_attempt.png, s08_obth.png, s08_asset_status.png, s08_pmth.png, s09_dn_short.png, s09_dn_page.png, s10_accepted.png, s11_invoice_{th,zh,en}.png, s11_payment_{th,zh,en}.png, s12_customer_detail.png, s13_model_after_archive.png, s15_ibth.png, s16_dashboard.png, s16_ai_assistant.png, s17_admin_manager.png, s18_customer_validation.png, p1_portal_home_{th,zh,en}.png, p2_report_submitted.png, p3_portal_quote_confirm.png, p3_portal_accept.png, p3_portal_signed.png, p5_isolation_portal_orders_QTTH26110504.png, p5_iso_staffpage_assets_ATH26110003.png, p5_iso_staffpage_service-orders_QTTH26110504.png, 以及 crawl_*.png（各列表页）
下载的文档/ZIP：/Volumes/Data for Macmini/dev/trial-pw/pdfs/（含越权下载的 ISO_*.bin 证据）
试用密码只保存在 trial-pw/seed.out（chmod 600），报告里不写密码。


请 Claude 按上面的问题清单修复，P0 是门户隔离（DEV_EMPLOYEE_CODE 和 auth.ts:49）。请修完后把版本号写回该文件末尾。
