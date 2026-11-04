# Bank statement import implementation plan

Goal: Replace Add Property with Import Bank Statement and reconcile Airbnb bundle deposits into Google Sheets H/I/J.

Approved spec: user confirmed the matching rules in chat on 2026-11-04 and requested implementation.
Architecture: local PDF.js extraction, pure RBC statement parser and matching preview, existing revision-protected Apps Script save. PDF content remains in the browser. Keep Excel import.

- [ ] Test and implement statement extraction: account suffix, statement period/year, inherited transaction dates, deposit column, transaction references. Reject unsupported/scanned text with actionable feedback; support pasted extracted text.
- [ ] Test and implement exact-cent, same-account bundle matching across the selected month. Group rows by payout date; skip duplicate/ambiguous deposits, conflicting existing values and already verified rows.
- [ ] Test and implement dedicated backend reconciliation action: validate current bundle/account, copy current D to I, bank date to H, TRUE to J; preserve Daisy. Read system verification and invalidate it when source data changes.
- [ ] Add accessible review dialog and replace toolbar/empty-state Add Property actions. Pause background refresh and retain revision through review/save.
- [ ] Validate both supplied PDFs, full tests, production build. Document deployment requirements and limitations.

Review focus: duplicate amounts, year rollover, debit/balance confusion, stale saves, reimport and changed verification data.

### Validation outcome

- Completed parser/matcher, Apps Script reconciliation, review dialog, toolbar replacement, help and deployment documentation.
- Passed 181 automated tests, including actual PDF.js extraction from an in-memory PDF stream, column boundaries, account mixing, year rollover, ambiguous bundles, stale saves and verification invalidation.
- Production TypeScript/Vite build passed.
- The two supplied Downloads PDF paths are unavailable in the execution filesystem, so original-file verification remains outstanding.
- Browser host was unavailable; native Edge inspection encountered active user input, so visual QA was stopped without changing live records.
- No deployment or live Sheet writes performed.
