# Codex 任务书（更新 2026-11-03）

代码已由 Claude 写到 v0.12，但 Next/Prisma 层在 Claude 的环境里没编译过。你的第一天任务是把它跑起来并补测试。

## 第一步：跑通（优先级最高）
1. `npm install && npm run db:generate && npm run typecheck` — 修掉所有类型错误，**不改业务逻辑**；不确定的地方在 PR 里留评论。
2. `docker compose up -d db && npm run db:push && npm run db:seed && npm run fx:fetch && npm run smoke` — 直到 `SMOKE PASSED`。
3. `npm run dev`，按 `docs/TEST-CHECKLIST.md` 17 步点一遍，把失败项记在 PR 描述里。

## 第二步：测试
- 用 Vitest + 真实 PostgreSQL（或 `scripts/dev/fake-prisma.ts`）给 `src/server/*` 每个导出函数写一个用例；重点：状态机拒绝非法跳转、编号按法人/月/日重置、金额与 CNY 折算、门户只能看本客户。
- 给 `src/lib/docx` 加 09/10/11/12 模板的占位符覆盖测试（同 `fill.test.ts` 的方式）。

## 第三步：Admin / CRM / OPD 打磨
- 列表分页与排序，表单校验提示（Zod 错误映射到字段）。
- Admin 增加：备份导出按钮（pg_dump 触发）、审计日志页（AssetEvent 全局流）。

分支 `feat/codex-bringup`，PR 小而多。遵守 AGENTS.md。
