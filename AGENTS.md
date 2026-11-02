# Working on DCiT OS (for Claude, Codex, Gemini, Grok and people)

Read this before changing anything. Also read README.md and the design doc linked there.

## Non-negotiable rules
1. **Every business record carries an asset.** Orders, inspections, jobs, invoices, movements and events all resolve to ATH codes. A write that cannot say which asset it concerns is wrong.
2. **All writes go through `src/server/*`.** Pages and API routes never call Prisma for writes directly; they call the service layer, which allocates numbers inside the same transaction and appends `AssetEvent`s. Reads for display may use Prisma directly.
3. **Numbers come from `src/lib/numbering*.ts` only.** Never build an ATH/QTTH/… string by hand. Country comes from the creator's employee code.
4. **Asset status changes only through the lifecycle** (`src/lib/lifecycle.ts`). Only ACCEPTANCE leads back to IN_SERVICE.
5. **No raw SQL, no AI-written queries.** Dashboards select from `src/lib/metrics.ts`. The assistant's tools are the only data the model sees.
6. **No hard-coded UI text.** Every label goes through next-intl (`messages/th|zh|en.json`); add keys to all three files.
7. **Customer-facing documents use the Word templates in `templates/word/`** via `src/lib/docx`; never redraw them in HTML.
8. **Money:** original currency + BoC rate + CNY on every amount; VAT separate; WHT never reduces the invoice.
9. **Portal users see only their own customer's data** — filter by `customerId` in every portal query and tool.

## Before a PR
```bash
npm run typecheck && npm test && npm run smoke:mem   # no DB needed
npm run smoke                                       # with a database
```
Branches: `feat/<module>-<topic>` → PR to `main`. Keep PRs under ~400 lines; one module per PR.

## Where things are
- `prisma/schema.prisma` — data model (comments explain each model)
- `src/server/` — alm (assets/events), slm (orders), slm-docs (INTH/RPTH/ERTH/acceptance/quote), scm, to (invoices/payments/statements), reports (templates), ai (assistant, dashboards), models (product knowledge), auth
- `src/app/(app)/` — staff pages; `src/app/portal/` — customer portal; `src/app/api/` — JSON routes
- `src/components/` — shared UI (badges, charts, assistant, dashboard builder)
- `scripts/smoke.ts` — the ten-step end-to-end test; `scripts/dev/` — in-memory harness

## Style
TypeScript strict, server components by default, `"use client"` only for interaction. Tailwind v4 with DCiT tokens (`bg-navy`, `bg-blue`). Mobile first for the portal. Short files, plain names, comments say *why*.
