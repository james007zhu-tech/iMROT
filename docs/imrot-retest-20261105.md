# iMROT 复测报告 2026-11-05

- 提交：`1414f2cf69143570cc2c161ead5e323498c69b60`（main，Merge PR #1，v0.18）
- 环境：Linux box，Node v24.22.1，本地 Postgres 17（无 docker），`.env` 由 `.env.example` 复制，`BUSINESS_CLOSURE=off`（未改动）
- 运行：db:push / db:seed / fx:fetch / trial:seed / `npm run dev` 均成功，dev server 在 :3000 后台运行。试用账号密码存于 `/workspace/imrot-cloud-secrets/trial-accounts.txt`（600）。
- 测试数据：手工插入客户 B `CTH2611099` 及其服务单 `QTTH26110099`。

## (1) 门户隔离 P0 —— **未通过（FAIL）**

修复并未合入 main：`.env.example` 仍含 `DEV_EMPLOYEE_CODE=ETH2611001`；`src/server/auth.ts` 第 38、49 行在非 production 下仍回退到该员工号（MD）。

| 检查 | 结果 | 证据 |
|---|---|---|
| 未登录访问员工页 | FAIL | `/dashboard` `/people` `/admin` `/customers/CTH2611001` 全部 200，页面渲染出 ETH2611001 |
| 未登录访问员工 API | FAIL | `GET /api/assets` 200 |
| 未登录下载他人 ZIP | FAIL | `GET /api/portal/orders/QTTH26110099/zip` → 200 application/zip（客户 B） |
| 门户用户 A 拿 B 的报告/ZIP/员工页 | FAIL（代码推定） | zip 与 ai/assist 路由先判 `sessionEmployeeCode()`，dev 回退恒为 MD，门户 cookie 被忽略 → 同上 |
| 门户 AI 只查本客户 | FAIL（代码推定） | `api/ai/assist` 优先走员工分支（全量范围），门户分支永远到不了 |

## (2) 早先问题复查

| 问题 | 结论 | 证据 |
|---|---|---|
| fx:fetch 超时且无缺汇率提示 | 本次通过 | 3.2s 写入 20 种货币（未复现超时；缺汇率提示未验证） |
| 未派工单检测+报价后卡在 已受理 | 仍存在（代码） | `slm.ts` 检测/报价不推进 RECEIVED 状态 |
| DBD 查询 502 | 仍存在 | `/api/dbd/0107537000254` 8.0s 后 502 `LOOKUP_FAILED: aborted due to timeout`（超时缩短，但仍 502） |
| 无 key 时 AI 无回退 | 仍存在 | ai/assist 返回 "ANTHROPIC_API_KEY is not configured on the server." |
| 无 LibreOffice 时 PDF 按钮出 .docx | 未验证 | 本机装有 soffice；`reports.ts` 仍为“有 LibreOffice 才出 PDF”逻辑 |
| 原始 Zod/Prisma 错误外露 | 仍存在 | `POST /api/service-orders {}` 返回原始 Zod issues JSON |
| 取消按钮显示 已取消 | 已修复 | zh `cancel`="取消"，按钮用 `t("cancel")` |
| 占位符像已填必填项 | 未验证 | 需浏览器目测 |
