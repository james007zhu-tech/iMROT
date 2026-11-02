# Phase 1 验收点击路径（约 20 分钟）

前提：`docker compose up -d db && npm run db:push && npm run db:seed && npm run fx:fetch && npm run dev`，浏览器开 http://localhost:3000 。

| # | 页面 | 操作 | 期望 |
| --- | --- | --- | --- |
| 1 | /login | dongsheng.zhu@ducheng-industrial.com / dcit2026 | 进入看板，右上角可切 ไทย/中文/EN |
| 2 | /admin | 看到法人 TH、中国银行汇率（THB、USD…）、流水计数 | 汇率日期为今天 |
| 3 | /models | 新增品牌 ABB、系列 ACS880、型号 ACS880-01-145A-3 | 树里出现；点进去可加故障代码、维护标准、BOM |
| 4 | /customers | 新增客户（勾 BLTH 月结）→ 详情加工厂 P1、联系人并设门户登录 | 客户编号 CTH2611xxx |
| 5 | /assets/new | 建档：类型 VFD、序列号、型号、客户、位置、责任人 | 跳到 ATH2611xxxx 详情，时间线有"建档" |
| 6 | 设备详情 | 关联一台电机（先建 MOTOR 资产）；QR label 打印页 | 关联区显示 DRIVES；标签页可打印 |
| 7 | 设备详情 → 报修 | 填症状、报警码 | QTTH2611xxxx，状态 已受理，设备时间线有"报修" |
| 8 | 服务单详情 | 派工（选工程师）→ 填 INTH 检测 → 报价行（含泰文描述）→ 客户确认 | 状态依次 已派工→诊断中→待确认报价→执行中 |
| 9 | 服务单详情 | ERTH 设备接收（车间）；RPTH 维修并勾"完成" | 设备状态变 测试与验收；单据列表出现 ERTH、RPTH |
| 10 | 服务单详情 | 13 验收 ACCEPTED | 设备回 在役运行；状态 已验收 |
| 11 | 服务单详情 | Issue TITH+IVTH；记收款（含预扣税） | 状态 已开票→已完成；FIN 页看到发票 |
| 12 | 单据列表 | 点 INTH 的 PDF、RPTH 的 PDF、QT 的 04/06/13、语言 th/zh/en | PDF 打开，无 [[占位符]]；三语版需要 ANTHROPIC_API_KEY |
| 13 | 客户详情 | BLTH this month | 生成 BLTH 月度账单 |
| 14 | /portal/login | 用步骤 4 的门户账号登录（手机或窄窗口） | 只看到本客户设备；扫码/选设备报修；进度条九步；验收签字 |
| 15 | 任意页 AI 按钮 | 问"ATH… 上次换了什么件"；在 INTH 面板口述并点"填入表单" | 回答带单号；表单被填入（需 API key） |
| 16 | /dashboard | 输入"本月维修看板：工单、收入、工程师" → AI | 新看板出现，图表有数 |
| 17 | 终端 | `npm run smoke` | SMOKE PASSED |
