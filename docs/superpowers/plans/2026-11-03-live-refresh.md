# Live data refresh

User requested automatic updated data while remaining on the current page. Implement in place, building on the approved manager work.

- Add a tested refresh controller that serializes reads, rejects stale results after saves or editing begins, pauses during editors, and catches up afterward.
- Add visible-tab polling every 15 seconds, focus/online refresh, and same-origin tab notifications after saves. Own saves immediately apply the returned authoritative snapshot.
- Keep existing component instances, month selection, filters, manager selection, and manager section. Store navigation only in session storage for reload restoration; never store unsaved record drafts there.
- Keep the current data on refresh failures and show a nonblocking retry notice.
- Validate race cases, pause/resume, failed reads, disposal, and saved-page restoration. Run full tests, component renders and build; request focused review.

No hard browser reload, new dependencies, backend deployment, or writes to live records are required for this change.

## Completion ledger
- Refresh controller implemented and verified for late reads after save, paused editing, coalescing, failure/recovery, and disposal.
- App polls visible shared sessions every 15 seconds and refreshes on focus, online, visibility, and cross-tab save notifications. Existing editor callbacks synchronously pause before opening.
- Navigation restoration wired to App and manager details; preview manager IDs made stable for reload demonstration. App SSR regression verifies actual initial page restoration.
- Fresh reviewer identified stale foreground read error after background recovery; separated read/export errors and cleared both read error channels on success. Regression now passes.
- No live writes, publishing, or browser automation performed.
