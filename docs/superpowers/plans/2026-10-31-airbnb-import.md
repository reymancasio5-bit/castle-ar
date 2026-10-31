# Airbnb import implementation plan

**Goal:** Import Airbnb payments into a selected database property, with a manually entered total and creation of new properties at confirmation.

**Architecture:** Preserve the existing spreadsheet reader and generic mapping logic. Add a property-targeted preview that recognizes Airbnb exports, links payout headers to payment details, and produces the existing mutation batch. Extend addProperty with validated initial payment slots so creation and import are atomic.

**Tech stack:** React, TypeScript, Google Apps Script, existing SheetJS.

## Behavior

- Step 2 uses database property suggestions and accepts a typed name. Existing totals are prefilled; new properties require a manager and manual total.
- Airbnb Amount supplies the payment; the preceding Payout row supplies Arriving by date and Paid out. Never infer the total from CSV amounts.
- Default to the next empty Airbnb slot; skip an already recorded identical payment. Allow explicit slot selection for replacing existing data.
- Review shows total, creation intent, payment amount, payout date and bundle before saving. Invalid Airbnb groups block the batch to avoid partial payments.
- Keep generic imports with a selected target property and destination.
- Preserve bank details, verification, formulas, revision checks and atomic save behavior.

## Tasks

- [x] Add failing tests for sample mappings, manual totals, new-property payloads, repeats, invalid groups and slot capacity.
- [x] Implement property preview and extend addProperty validation and initialization; test backend atomicity.
- [x] Wire property selection, manual total, manager, slot controls and detailed review into ImportWizard.
- [x] Run the full test suite and production build; inspect UI if available. Document deployment requirements.

## Verification

79 tests pass; production build and diff whitespace checks pass. The three user-provided CSV files were read locally through the real spreadsheet reader and produced the expected three payments, dates, bundles and 45.62 AR. Code review identified a generic summary-row regression, fixed with a failing-then-passing regression test. Browser access host was unavailable, so visual/browser verification was not performed. No live database writes or deployments were performed; README documents frontend and Apps Script deployment.

## Review focus

Duplicate imports, multiple listings in one file, malformed dates/amounts, filled payment slots, and new-property validation must never silently lose or misattribute money.
