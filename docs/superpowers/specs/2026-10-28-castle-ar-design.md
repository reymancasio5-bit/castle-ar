# Castle Monthly AR

Build a responsive, no-login accounts receivable app. Latest user decisions: host the interface on GitHub Pages; use the supplied Google Sheet as the shared database; deliver Apps Script Code.gs. Earlier browser-local and hosted database options are superseded.

Source: https://docs.google.com/spreadsheets/d/1EGS6cj8WKfUlH8ayk5cXaB9KW53xu7vEbl4oboAJxPY/edit
One November 2026 tab (ID 0), 3 property blocks, repeated headers at rows 3/11/19. Each block contains total, 3 Airbnb rows, Vrbo, owner, formula AR. Expected 1055.90; payments 324.86; AR 731.04. Payout and bank details and verification blank. Source has no currency specification; show neutral amount formatting, not an invented currency.

Approach: React + Vite static client, Apps Script server reads and updates the existing sheet. Integer cents internally. Apps Script uses lock and content revision checks; write only validated cell fields; preserve formulas. No client credentials. No automatic login. Owner authorizes deployment once. Anyone with endpoint access can edit by explicit user request.

UX: pale neutral background, deep green navigation, strong typography, monthly selector, manager/search/status filters, overview metrics, property table/cards, payment detail drawer, Excel wizard, connection settings. Good touch targets, focus states, reduced motion, responsive 360px through desktop. Sample snapshot visibly labeled when backend not configured; never claim sample is live.

Excel: xlsx/xls/csv, workbook sheet/header selection, property and amount mapping, destination amount selection, preview/errors, explicit apply. Blank preserves values; zero sets zero. Duplicate/unmatched rows cannot silently overwrite; mapping and validation happen before saving. Export workbook for backup.

Backend API contract: GET read returns Snapshot; GET status by request ID returns completed write outcome; POST mutation with requestId, revision, changes. Cross-origin write acknowledgement must be read back; never infer success from an opaque response. Source month/property/payment IDs are sheet ID and row. Snapshot revision detects direct sheet edits. Sheet dates use its timezone.
