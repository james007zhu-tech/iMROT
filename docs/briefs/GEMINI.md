# Gemini 任务书 — ALM 设备页面 · 客户门户（移动端优先）

目标：设备页面是整个系统的首页；客户门户是同一套数据的受限视图。两者都先在手机上好用。

## 约束
- 数据只从 `/api/assets`、`/api/assets/:code`、`/api/service-orders` 读写；状态变更只通过 `/api/service-orders/:no/status` 与 `/api/assets/:code/events`。
- 文案走 next-intl（th/zh/en）。品牌色 Navy #0B2D53 / Blue #2374D5，字体 Sarabun + Noto Sans SC。
- 门户用户是 Contact（不编号），登录为 portalLogin + 密码；只能看到自己客户的设备与工单。

## 交付
1. ALM 设备列表 `src/app/(app)/assets`：搜索（编号/序列号/位置）、按客户和状态筛选、二维码扫描入口（扫 ATH 直达详情）。
2. ALM 设备详情 `assets/[code]`，自上而下：基本信息与当前状态 → 事件时间线 → 关联单据（QTTH 分组）→ 备件与更换记录 → 参数备份与文件 → 同型号知识（故障代码、维护标准、历史案例）。关联设备（电机/PLC/柜）以传动链形式展示。
3. 建档表单（接管）：铭牌照片上传、六个必填（序列号、型号、所属客户、位置、责任人；ATH 由后端分配）。
4. 客户门户 `src/app/(portal)/...`：报修（选设备或扫码 → POST /api/service-orders）、工单进度条（九个状态词）、报告下载、验收签字（Acceptance）。
5. 二维码铭牌打印页：ATH + 序列号 + 型号，A4 多枚排版。

分支 `feat/alm-portal`，PR 到 `main`。PR 前跑 `npm run typecheck && npm test`。
