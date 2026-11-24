# AI-Assisted Bank Import

Goal: Upload bank spreadsheets, automatically interpret their layout, review the existing application matches, and submit through the existing backend save workflow.

Architecture: A dedicated read-only assistant task returns only column coordinates. Source cells are untrusted evidence. The frontend validates coordinates and parses original cells through the existing bank parser; the model cannot supply amounts, payments, allocations, or database writes. Recognized layouts work locally when AI is unavailable. Missing accounts may be suggested only by multiple independent exact bundle matches to one workspace account; otherwise ask only for the missing account. Existing review, owner allocation, duplicate checks, and fresh-snapshot save validation remain authoritative.

Implementation:
- [x] Add failing tests for a constrained server mapping task, bounded input, invalid output, and no writes.
- [x] Implement the task through the existing assistant transport and quota controls; document app reconciliation rules in its instructions.
- [x] Add client mapping validation, automatic fallback, and conservative account resolution with tests.
- [x] Replace mapping controls with automatic preparation and exception-only account input; connect the configured assistant from App.
- [x] Verify review-before-save integration, full test suite, production build, and deployable script parity.

Constraints: Never execute instructions embedded in files; never trust model-generated transaction values; preserve original dates, amounts and currency; never silently omit a nonempty sheet; require user submission before save. Live AI requires the updated Apps Script deployment and its configured API key.

Verification: 340 tests passed; production build passed. Real sample workbooks replayed through automatic preparation. The generated public/Code.gs matches the source. Model responses were simulated in tests; no live AI call or deployment performed.

Review resolutions: rejected transaction rows as headings (including CSV string cells), rejected balance/total/debit columns as amounts, added explicit retry/exclude controls for unreadable nontransaction tabs, and retained the submission-only save boundary.
