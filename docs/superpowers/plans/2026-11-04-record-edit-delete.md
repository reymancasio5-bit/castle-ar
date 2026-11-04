# Direct record editing and deletion

Approved scope: edit financial/property details in the app; delete individual payment rows and complete property blocks. User explicitly confirmed both deletion scopes.

- Extend payment drafts to bank details and payment type; keep computed verification automatic and invalidate on evidence edits.
- Add property name/manager fields and confirmed Delete Payment/Delete Property controls to the existing drawer. Preserve clear-field behavior, stale revision handling, and preview mode.
- Add atomic backend record actions. Rename preserves Status and manager-linked history; property deletion removes its Status/assignment and detaches task references while retaining task history. Payment deletion repairs AR and relies on bottom-up Sheets row shifting. Delete requests are isolated from unsaved edits.
- Test editor, preview, backend rename/deletion, neighboring rows, last payment, stale revisions, and conflicts. Build and update the local preview only.

Validation: 192 automated tests pass, including metadata/link preservation, stale revisions, payment-row and property-block deletion, final-payment AR repair, empty-month reimport, and orphan metadata collision rejection. Independent review findings resolved. Frontend build passed. Local preview remains on port 5173; no live data edited or deployment performed.
