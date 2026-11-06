# Bundle matching only

Approved in conversation: future recognized Airbnb Excel/CSV imports with blank or zero Expected Amount go to bundle matching only. Positive expected amounts retain the AR workflow. Existing records are not migrated.

Keep Airbnb payment amounts, bundle amounts, payout dates and bank details. Reuse bank PDF matching by bundle amount and account last four digits, retaining ambiguity safeguards. Show a separate Bundle Matching page and monthly companion Google Sheets tab with familiar formatting, no expected amount or AR calculation. Exclude these records from AR totals and follow-ups.

## Approach
Reuse the payment model with an explicit `bundleOnly` property marker and the existing matching engine. Store companion tabs named `<month label> - Bundle Matching`, merge them into the reporting month on read, and retain physical sheet IDs for edits. This preserves the established block formatting and avoids a separate reconciliation implementation. A separate table/engine would duplicate matching and editing; merely filtering zero totals would incorrectly reclassify historical data.

Local demonstration only; live Apps Script deployment is not part of this request.
