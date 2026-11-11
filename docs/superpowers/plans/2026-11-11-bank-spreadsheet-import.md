# Bank Spreadsheet Import Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the tasks in order.

**Goal:** Accept RBC transaction spreadsheets alongside PDF statements in the existing bank import review.

**Architecture:** Convert recognized spreadsheet rows into the existing `BankDeposit` model using the bundled SheetJS reader. Keep PDF extraction, Airbnb matching, owner allocation, duplicate checks, and save actions intact.

**Tech Stack:** React, TypeScript, bundled SheetJS, Node test runner.

**Design / Approved Approach:** The user approved a combined uploader. A separate Excel bank screen would duplicate matching and review. Support the supplied RBC layout in .xlsx, .xls, and .csv; this is not an arbitrary bank column-mapping wizard. Read account numbers and dates per transaction, accept positive CAD deposits only, and retain names and references. Show malformed-row warnings and reject unsupported layouts. All processing remains local until the user saves reviewed payment changes.

## Global Constraints

- Preserve PDF bank statement support and existing save protections.
- Use Initial Capitals For Every Word in important UI text, keeping "on" lowercase.
- Do not change source names, import source workbooks into the repository, or save live payment data during verification.
- Reuse the existing spreadsheet limits: 10 MB and 10,000 rows; PDF limit remains 20 MB. Combined upload limit remains 10 files / 50 MB.

## Review Focus

- Negative amounts, fees, and unrelated credits must not become bank deposits.
- Excel dates, invalid dates, error cells, and formula cells must not silently create evidence.
- Reordered headers and multiple bank accounts must preserve row identity.
- Missing owner references must remain unresolved; repeated imports must remain protected.
- Both PDF and spreadsheet entry points must reach the same matching review.

### Task 1: Parse RBC Spreadsheet Deposits

**Files:** `src/bank-spreadsheet.ts`, `tests/bank-spreadsheet.test.ts`.

**Interface:** `parseBankSpreadsheet(sheets: ImportSheet[], source: string): { deposits: BankDeposit[]; warnings: string[] }`.

- [x] Write and run failing tests for recognized/reordered columns, positive Airbnb/owner deposits, account/date/reference extraction, malformed rows, unsupported headers, and matching/duplicate behavior.
- [x] Implement the parser using `ImportSheet` and integer cents.
- [x] Run parser tests and check both supplied workbooks with the real bundled SheetJS reader.

### Task 2: Connect Upload And Review

**Files:** `src/BankStatementImport.tsx`, `README.md`, and the assistant import tool's extension validation if needed.

- [x] Route spreadsheet extensions through `readSpreadsheet` and the new parser, and retain the PDF path.
- [x] Update upload labels, accepted extensions, size guidance, empty state, and warnings.
- [x] Cover the assistant's bank spreadsheet handoff with a regression test.
- [x] Run `npm.cmd test`, `npm.cmd run build`, and a rendered modal check. Review the final diff.

## Execution Notes

- Baseline: 243 tests passed before implementation.
- User authorized implementation with "go ahead proceed"; implement in the supplied checkout and leave changes available for review.
- Real-workbook checks: Host 73 eligible deposits (47 Airbnb / 26 owner); MG 7 (1 Airbnb / 6 owner). Counts and cent totals match independent source-row controls. Six Host owner deposits genuinely have no source reference and remain blocked by existing review protections.
- Review correction: ambiguous letter-only surname tokens must not become fabricated references. Added a failing regression and removed that heuristic; names are preserved and reference extraction follows the PDF requirement for a digit.
- Real bundled SheetJS round-trip checks cover XLSX, XLS, and CSV. Existing owner directory, allocation, history, and bank import server-render checks passed. No live records were saved and no deployment was performed.
