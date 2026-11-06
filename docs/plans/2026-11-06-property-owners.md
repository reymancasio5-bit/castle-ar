# Property owners implementation

Approved scope: global owner profiles, one statement name, property mappings carried across months, active toggle retaining history. Property Owners navigation below Account Managers. Owner Autodeposit credits from bank PDF match unique exact outstanding automatically; other cases and inactive owners require manual allocation. Allow positive splits totaling the deposit exactly. Append Owner Payment rows with D/I allocated amount, G account, H bank date, blank bundle, system verified, Daisy false. Keep normal AR formulas and Airbnb behavior. Save through existing review. Prevent reimport by account + transaction reference across all months; missing references require skipped review, never guessed credits. No live deployment.

Contract: PropertyOwner and OwnerTransfer/OwnerChange in src/types.ts. propertyNames are global normalized-name matches (trim, collapse spaces, lower case); retain historical mappings. ownerSchema=1. saveOwner and importOwnerTransfer validated atomically server side, ledger persisted in dedicated Owner Transfers tab, profiles Property Owners tab. Inactive names recognized but require manual review. Only selected month's AR properties can receive a split. No combined auto subset allocation: user chooses when not unique exact single-property match.

Tasks:
1. Backend tables, owner save and import validation, verified payment insertions, regression tests.
2. PDF owner parsing and pure owner-domain validation/matching, preview parity and tests.
3. Root: owner directory, bank allocation review, navigation integration and schema guards.
4. Review, run full tests/build and local preview; provide Apps Script update file.

Ruling: duplicate identity uses normalized account + reference, excluding date/amount so altered reuploads cannot double-credit. Historical owners cannot be deleted; inactive can still be selected for manual allocation. Missing reference is review-only and cannot be saved automatically.

Completed: owner directory, global profiles, inactive recognition, exact matching/manual splits, owner ledger and atomic Sheets writes. Review resolved normalized property-name collisions before writes. Verification: 243 tests pass; production build passes; owner/bundle/manager SSR checks pass; public and dist Code.gs match source+Assistant. Local preview responds HTTP 200 on port 5174. Browser host unavailable, so no visual browser check. No live deployment performed.
