# Codex 任务书（更新 2026-11-03）

代码已由 Claude 写到 v0.14 并在真实环境跑通（typecheck 零错误、vitest、smoke、next build、33 步 Playwright e2e 全过）。你的任务是加厚测试和打磨 Admin/CRM/OPD。

## 第一步：复现基线
`npm install && npm run typecheck && npm test && docker compose up -d db && npm run db:push && npm run db:seed && npm run smoke && npm run build && npm run e2e`（e2e 需 `npx playwright install chromium`，先 `npm run start` 起服务）。任何一步失败先修它。

## 第二步：测试
- 用 Vitest + 真实 PostgreSQL（或 `scripts/dev/fake-prisma.ts`）给 `src/server/*` 每个导出函数写一个用例；重点：状态机拒绝非法跳转、编号按法人/月/日重置、金额与 CNY 折算、门户只能看本客户。
- 给 `src/lib/docx` 加 09/10/11/12 模板的占位符覆盖测试（同 `fill.test.ts` 的方式）。

## 第三步：Admin / CRM / OPD 打磨
- 列表分页与排序，表单校验提示（Zod 错误映射到字段）。
- Admin 增加：备份导出按钮（pg_dump 触发）、审计日志页（AssetEvent 全局流）。

分支 `feat/codex-bringup`，PR 小而多。遵守 AGENTS.md。
