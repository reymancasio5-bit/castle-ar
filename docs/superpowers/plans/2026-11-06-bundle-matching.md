# Bundle Matching Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically route future blank/zero Airbnb imports into a separate bundle matching report and database tab.

**Architecture:** Explicit `bundleOnly?: boolean` on imported properties and addProperty changes. Reuse matching and editing; companion monthly sheets omit AR formulas. Combine companion records into the logical month for display and matching.

**Tech Stack:** React, TypeScript, Google Apps Script, Node test runner.

**Spec:** docs/superpowers/specs/2026-11-06-bundle-matching-design.md

## Global Constraints
Future uploads only. Blank or zero triggers only for recognized Airbnb exports. Preserve positive expected amount imports and historical zero records. Local preview only.

## Review Focus
Same property name in both workflows; duplicate uploads; mixed AR/bundle bank deposits; blank companion tabs; export and manager totals must not treat bundles as receivables.

### Task 1: Import routing
- [x] Add failing tests in tests/bundle-matching.test.ts for blank/zero, positive, legacy, duplicate and mixed workflows.
- [x] Add marker to src/types.ts, src/property-import.ts, src/bulk-import.ts and src/preview-api.ts.
- [x] Run Node tests for imports.

### Task 2: Sheets persistence
- [x] Add backend tests for companion creation, round-trip, edits, matching, deletion and isolation.
- [x] Extend apps-script/Code.gs read and write paths, retaining atomic validation and revision checks.
- [x] Run backend tests.

### Task 3: Report and local preview
- [x] Add Bundle Matching navigation/report and explicit import classification; hide AR fields for bundle records.
- [x] Separate AR exports and add bundle export sheet; keep manager totals scoped to AR.
- [x] Run npm test and npm run build, review diff, launch local preview and inspect browser.

## Execution ledger
Ruling: Work in the user's supplied checkout and proceed inline under their explicit instruction to update the code and show it locally. No live deployment or historical migration.

Task 1: complete ? import routing and duplicate/legacy tests pass.
Task 2: complete ? companion sheet create, match, append, delete, rename and reimport tests pass.
Task 3: complete ? 224 tests pass; production build and server-render checks pass. Local HTTP preview returns 200. Independent code review findings fixed and regression tested.
Verification limit: Computer Use stopped because it could not determine the Windows browser URL confidently. No rendered-browser visual check completed. Local preview server remains running for user review.
