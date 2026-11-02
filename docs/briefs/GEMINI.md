# Gemini 任务书（更新 2026-11-03）

页面骨架已经在（/assets、/service-orders、/portal、/dashboard）。你负责让它们在手机上好用、好看，并补齐视觉细节。

## 任务
1. **门户移动端打磨**：`src/app/portal/**` 一列布局、大按钮、离线提示；报修页加相机扫码（见 `src/components/ScanButton.tsx`，BarcodeDetector 不可用时退回系统相机扫印刷二维码）。
2. **PWA**：完善 `public/manifest.json` 图标（用 docs/brand/DCiT_Logo_Primary.png 生成 192/512），`apple-touch-icon`，安装提示。
3. **设备页**：时间线按天分组、事件类型图标、附件缩略图；传动链用一张横向小图（VFD → 电机 → 负载）。
4. **看板**：`src/components/charts.tsx` 增加堆叠柱、双轴折线；看板页支持拖拽排序（保存回 spec）。
5. **泰文文案审校**：`messages/th.json` 所有文案请按泰国工厂现场用语改顺。
6. 品牌：Navy #0B2D53 / Blue #2374D5，Sarabun + Noto Sans SC，已在 `src/app/globals.css`。

约束：数据只走 `/api/*` 和 `src/server/*`；不要在页面里直接写 Prisma 写操作；文案走 next-intl。

分支 `feat/gemini-mobile`，PR 小而多。遵守 AGENTS.md。
