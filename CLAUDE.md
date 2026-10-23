# Solar EPC ERP — Backend (Express 5 + Prisma 7 + PostgreSQL)

Replies to the developer (Sri) in Hinglish. Keep code simple for junior devs.

## Folder pattern (no service layer)
route → validate (zod) → controller → dal
- `route/<module>/*.route.ts` — `requirePermission("module.menu.action")` + `validate(schema)`. Every URL param (`:id`, `:docId` …) is checked right after `const router = Router();` with `["id", "docId"].forEach((name) => router.param(name, validId));` (middleware/validId.ts) — bad id → 404, never a Prisma 500
- `validations/*.validation.ts` — zod 4 schemas (body). Query params are parsed in the controller with `.catch()` defaults (Express 5 `req.query` is read-only)
- `controller/<module>/*.controller.ts` — one handler per action, plain `try { ... } catch (err) { console.error("[Name]", err); return genrateResponse(res, 500, "...") }`
- `dal/*.dal.ts` — Prisma where-builders, find helpers, code generators
- `constants/options.ts` — dropdown lists (`as const`)
- `constants/regex.ts` — validation patterns (phone, GSTIN, Aadhaar)
- `utility/` — small helpers (IST dates, code generator, file storage)
- No validation logic inside controllers. No generics unless unavoidable.

## Data rules
- Every query goes through `getScope(req.user)` (dal/scope.dal.ts): company tree + SELF/TEAM user scope
- Soft delete with `deletedAt`. Codes: LD/CUS/PRJ + 6 digits via `nextCode`, retry on P2002
- Dates in IST (`utility/istDate.ts`)
- Multiple Prisma schemas: `prisma/<db>/schema.prisma` + `prisma.config.ts`. Migrations are hand-written to keep data (`prisma migrate diff`, then edit). Apply: `node migrate.js`, client: `node generate.js`

## Documents
- One `Document` table (project schema) for lead / customer / project. Files on disk:
  `uploads/{companyId}/{yyyy-mm}/{category-slug}/{12-char-random}.jpg|pdf` — never public; served only through `/api/<entity>/:id/documents/:docId/file` after scope check
- Photos compressed with sharp (2000px, JPG q80 mozjpeg, EXIF stripped). PDFs stored as-is. Max 10 MB

## B2C project workflow (handwritten chart)
Survey → Engineering → Quotation → (Bank Loan, only if LOAN) → Registration → Invoice → Order → Dispatch → Installation → QC → Commissioning → Net Metering → Subsidy → Handover
- Strict payments: Order only after 90% payment; remaining 10% after Net Metering
- Panel serial: captured at Dispatch; if not, recorded at Installation/QC
- B2B (simple): Quotation/Invoice → Order (100% advance) → Dispatch → Close
- Every project action writes a `ProjectActivity` row (timeline). Stage moves via `moveStage()` in dal/project.dal.ts

## Never
- Never commit/ship `.env`. JWT_SECRET ≥ 32 chars. Don't print secrets
