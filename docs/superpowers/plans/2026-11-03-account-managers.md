# Account Managers Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Shared account-manager records, dropdown assignments, and manager details with separate due-date tasks and updates.
**Architecture:** Extend the existing snapshot and atomic Apps Script save protocol. Keep financial property fields compatible while resolving assignments against stable manager IDs.
**Tech Stack:** React, TypeScript, Vite, Google Apps Script, Sheets.
**Spec:** ../specs/2026-11-03-account-managers-design.md

## Global constraints
Preserve financial calculations and existing assignments. No remote writes during development. No new dependencies. Maintain revision conflict protection and temporary preview mode.

## Review focus
Unknown spreadsheet manager names must not silently enter the catalog. Inactive current assignments must survive unrelated edits. Rename must preserve assignments. Month changes must not hide tasks. Failed saves must preserve form drafts.

### Task 1: Data and preview
- [x] Add `AccountManager`, `ManagerTask`, `ManagerUpdate`, and manager change types in src/types.ts, and src/managers.ts for bootstrap, validation, and preview changes.
- [x] Write tests/managers.test.ts for deduplication, rename stability, invalid assignments/dates, inactive retention, and task reassignment; run failing tests before implementation.
- [x] Integrate with src/preview-api.ts; run targeted tests.

### Task 2: Shared backend
- [x] Extend apps-script/Code.gs with header-validated catalog/task/update/assignment tabs, migration, reads and atomic write requests.
- [x] Test production script functions in tests/managers-backend.test.ts for bootstrap, unknown IDs/names, rename, inactive assignment, validation and incompatible tabs. Run red then green.
- [x] Include all new records in revisions and advertise manager schema support.

### Task 3: UI
- [x] Create src/AccountManagers.tsx and src/account-managers.css: directory, manager editing, listings/month scope, tasks, updates, draft guards and error states.
- [x] Integrate navigation and record-backed assignment selects in App.tsx, FollowUps.tsx and ImportWizard.tsx. Extend preferences view type. Show backend-upgrade message when capability is missing.
- [x] Run production typecheck/build and tests. Exercise local preview via browser if available.

### Task 4: Verification and delivery
- [x] Document deployment and preview instructions in README.md.
- [x] Run full tests and production build; request one fresh code review and fix important issues.
- [x] Leave changes in the user's workspace for local inspection; no commit/push/deployment requested.

## Execution ledger
Ruling: User said proceed after requesting changes in their local app. Execute in this workspace without another approval handoff, commit, or worktree switch.
Pre-flight: backend, preview and UI share the types from Task 1; existing property manager display strings remain compatible, with manager IDs resolved from records at the boundary.

Task 1: complete ? manager model/preview tests pass.
Task 2: complete ? production Apps Script exercised by extended backend harness.
Task 3: complete ? production build and component render checks pass.
Task 4: complete ? 129 tests pass; build and diff checks pass; local preview HTTP 200.
Review: fresh reviewer identified persisted-value validation, month-independent rendering, and draft-loss links; fixed with source validation/date normalization, independent view routing, and explicit discard protection. Additional regression tests cover blank sheet rows, inactive assignments, unknown names, and stale task saves.
Ruling: Reused tests/backend.test.ts harness rather than a duplicate backend test file. Existing free-text fixtures now select registered managers, preserving their original financial assertions.
UI limitation: Computer Use stopped because it could not determine Edge?s current URL; no visual or interactive browser verification claimed. Static component render checks pass via node tests/manager-ui-render.mjs.

## Follow-up: profile images
User requested Team B/Team A reference badges, per-manager upload controls, and blank placeholders. Implemented optional profileImage with blank/preset/raster values, preview persistence, guarded upload/replace/remove controls, and compatible legacy-sheet migration. Reference badge designs are implemented in CSS; arbitrary user uploads persist as validated raster data. Explicit removal remains blank and new records start blank. Fresh reviewer reported no important defects.
