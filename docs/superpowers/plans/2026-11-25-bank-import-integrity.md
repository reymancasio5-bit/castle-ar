# Bank Import Accuracy And Review Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent components; integrate and review the complete flow before completion.

**Goal:** Resolve the November 25 audit findings and make all supplied statement layouts readable, explain every omitted credit, and prevent bank evidence from being reused beyond its value.

**Architecture:** Retain React, TypeScript, local SheetJS/PDF.js extraction, and Google Apps Script/Sheets. Deterministic parsing produces immutable source evidence and explicit exclusions. A persistent bank-receipt ledger validates platform reconciliation across months atomically with payment updates. The review keeps user corrections and clearly identifies required source details.

**Tech Stack:** Existing dependencies only; Node test runner, React component tests, Apps Script in-memory harness, Vite production build.

**Spec:** User-approved findings in the November 25 audit and explicit instruction to implement all improvements. Implementation decisions below are the developer's choices within that authorization.

## Global Constraints

- Preserve original bank amounts, dates, text, and source references. Never fabricate a missing reference or infer currency from a filename.
- Keep existing records compatible. New bank imports require the upgraded backend so older deployments cannot bypass receipt validation.
- No live financial writes, publishing, or external transmission of the supplied statements during development.
- Keep initial capitals in UI labels, sentence case in help, and preserve source text exactly.
- Work in the user-requested clean checkout; do not move the user's project or create an unsolicited worktree.
- No new dependencies unless a demonstrated requirement makes them necessary.

## Review Focus

1. Same receipt reused across files, sessions, and months; contradictory identity or cumulative allocations must fail atomically.
2. Full account identities sharing a suffix; mixed or unknown currencies must not silently match unrelated accounts.
3. Missing references, all-letter RBC references, duplicate controls, formula/error evidence, and partial source descriptions.
4. Distinct equal-value deposits, repeated identical exports, and ambiguous payout groups; no arbitrary matching.
5. Responsive review on narrow screens, long source text, keyboard access, large batches, and stale database revisions.

## Tasks

- [x] **Spreadsheet parsing and preparation:** Write failing regressions for letter-only references, dual CAD/USD columns, ambiguous optional headings, and explicit exclusions. Preserve account identity/currency and source row metadata; add a validated manual mapping fallback. Validate all nine XLSX files without AI.
- [x] **PDF extraction and coverage:** Add failing regressions for complete excluded-credit reporting and Wells Fargo Airbnb parity. Preserve account identity/currency and source context. Independently verify all source amounts/dates in both PDFs.
- [x] **Receipt ledger and matching:** Add failing tests for cumulative cross-month use, contradictory references, identity collision, replay, equal amounts, and legacy deployment gating. Persist receipt identity/amount/currency and allocations in the same atomic Sheets batch. Match indexed evidence, support explicit payout-group selection, and protect row changes/deletion from orphaning the ledger.
- [x] **Review UI and feedback:** Display mapped fields, account/currency confirmation, deposit and exclusion totals by currency, per-row reasons, duplicate status, and missing details. Permit 25 files / 50 MB. Keep manual corrections reviewable and prevent unsafe submission. Improve responsive tables/forms and avoid unnecessary reprocessing.
- [x] **Automated verification and documentation:** Run a temporary local private-file audit runner using the supplied paths (never commit statements), all 11 originals, the full automated suite, TypeScript/build, and independent code review. Document backend deployment requirements and test limits.
- [ ] **Browser visual verification:** Mobile/tablet/desktop rendering checks could not be completed because the browser host was unavailable and native browser interaction was stopped by the computer-use service's URL-identification policy. No substitute visual success claim is made.

## Progress And Decisions

- Baseline: existing complete test suite and TypeScript checks passed; git working tree clean before implementation.
- User has explicitly authorized implementation of the review findings; no additional design/permission gate is needed.
- Unknown incoming credits are visible for review; they cannot become automatic payment evidence without valid source identity and user-reviewed classification.
- Original bank files and live Google Sheets remain unchanged during verification.

## Verification Results — November 25, 2026

- Full suite: `node --experimental-strip-types --test tests/*.test.ts` — 406 passed, 0 failed, 0 skipped.
- Production build: `npm.cmd run build` — TypeScript and Vite passed. Vite retains non-fatal classic-script/static-dynamic-import notices and a main chunk size warning (502.20 kB minified, 149.31 kB gzip).
- Original input check: all nine XLSX workbooks and both PDFs processed through the real import component with the real file readers in a local test harness. The Node harness uses the legacy PDF.js adapter; browser rendering itself was not verified.
- Combined source result: 220 parsed deposits (122 owner, 98 platform) and 34 visible exclusions. These are raw file totals, including overlapping exports; they are not counts of unique receipts or database writes. All nine workbook column mappings were local and deterministic, with zero AI requests. Twenty-two owner entries genuinely lack a transaction reference and remain review items.
- Currency totals after explicit source confirmation: CAD 217,755.30 parsed and 108,636.00 excluded; USD 23,009.74 parsed and 0.00 excluded. The US export requires source account/currency confirmation; both PDFs require currency confirmation. The harness supplies a synthetic full account for the US export to exercise review without creating financial records.
- Independent workbook XML and PDF row controls agree with parsed plus excluded credits. Three mixed-case all-letter RBC references are recovered. Wells Fargo Airbnb credits are included. The RBC Vrbo credit without an explicit transaction reference stays visible as excluded.
- Review interaction checks cover pagination across all 220 deposits and 34 exclusions, acceptance of 25 files and rejection of 26, source-detail changes, preserved original references, individual payout selection, and partial receipt selection/clearing. The final 11-file run took approximately 1.63 seconds to read files and 0.23 seconds to prepare review in the test harness; this is not a mobile/browser performance benchmark.
- Backend tests run the actual Apps Script code against an in-memory Google Sheets harness, including atomic ledger writes, replay, cross-month allocation limits, account/reference conflicts, stale owner context, history protection, and legacy backend rejection.
- Final independent review approved the changes after verifying the last currency-format and partial-receipt reproductions; 66 focused review tests passed. No remaining material defect was found within the reviewed scope.
- No live financial writes, deployment, commit, or push was performed. The frontend and the existing Apps Script web-app deployment must both be updated before the live app can save imports with the new receipt protections. Deployment instructions are in README.md.
