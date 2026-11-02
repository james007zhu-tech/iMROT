# Codex 任务书 — Admin · CRM · OPD 页面

目标：在 Phase 1 内做出可用的管理页面，全部基于 `prisma/schema.prisma` 和 `src/server/*` 的业务层。不要绕过业务层直接写 Prisma。

## 约束
- Next.js App Router，TypeScript strict，Tailwind。页面放在 `src/app/(admin)/...`。
- 所有文案走 next-intl（`messages/th.json` `zh.json` `en.json`），不要硬编码中文或泰文。
- 编号不在页面生成：创建客户/员工时调用 `allocateNumber`（`src/lib/numbering-db.ts`）在同一事务内分配 CTH / ETH。
- 每个列表页支持搜索与分页；每个详情页右侧显示该对象名下的设备列表（`/api/assets?customerId=`）。

## 交付
1. Admin：法人列表与编辑（LegalEntity，含银行信息 JSON 表单）、汇率表（FxRate 只读，按币种/日期查）、编号流水查看（DocSequence 只读）。
2. CRM：客户 CRUD（CTH 自动分配）、工厂（Plant）子表、联系人（Contact，可设门户登录）。
3. OPD：员工 CRUD（ETH 自动分配，角色 enum），登录与会话（最简：邮箱 + 密码，bcrypt；中间件保护 `(admin)` 路由）。
4. 布局：左侧模块导航 ALM/CRM/SLM/SCM/FIN/T&O/OPD/Admin，右上角语言切换 th/zh/en。品牌色 Navy #0B2D53 / Blue #2374D5，字体 Sarabun + Noto Sans SC（`public/fonts`）。

分支 `feat/admin-crm-opd`，PR 到 `main`。PR 前跑 `npm run typecheck && npm test`。
