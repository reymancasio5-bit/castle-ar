# Account managers and assigned work

Status: approved by the user with ?proceed?; implemented locally. Shared deployment remains pending.

## Intent
Prevent assignment typos by choosing a saved account manager. Give each manager a details page containing their listings, separate tasks with due dates, and updates. Tasks are separate records, as requested by the user.

## Approach
Use the existing React application and Google Sheets / Apps Script storage. Add shared manager, task, update, and assignment records with stable IDs. Browser-only records would not be shared; deriving options from property names would not provide independently managed manager records. A new database would add an unnecessary service. The shared-sheet approach is recommended; its implementation details below are proposed defaults.

## Pages and behavior
- Add Account Managers to navigation. A searchable directory allows creating and editing managers (required name, optional email and notes). Prevent duplicate names after case and whitespace normalization.
- Selecting a manager opens their details with Listings, Tasks, and Updates sections. Listings show assigned monthly properties with month labels, balances, and links to their existing follow-up/payment views. Default to the selected reporting month, with an all-months option.
- Tasks are independent of reporting month. Each has a title, optional description, required manager and date-only due date, and Open / In progress / Completed status. An optional link identifies a monthly property by month sheet ID and normalized property name. Support create, edit, reassign, complete, and reopen. Highlight overdue unfinished tasks using today's local calendar date. No notifications, recurrence, or task deletion in this change.
- Updates are timestamped text entries associated with a manager, optionally a task or monthly property. Users can add updates. Show them newest first alongside current follow-up notes for that manager's assigned listings, clearly labeled as current notes rather than historical events. Do not invent past history or author identities in this no-login workspace. Saved manual updates remain attached to the manager they were recorded against when work is reassigned.
- Use record-backed select controls for assignments in Follow-ups, Add Property, import creation, and task forms. Follow-ups retains Unassigned; new properties and tasks require a manager. Empty directories link to manager creation. Name typing is allowed only when managing a manager record.
- Managers may be marked inactive instead of deleted. Keep existing assignments visible, exclude inactive records from new assignments, and allow retaining the current inactive assignment while editing unrelated fields.

## Storage and compatibility
- Add dedicated, header-validated sheet tabs for managers, tasks, updates, and monthly listing assignments. Store stable manager IDs; preserve human-readable manager names in existing monthly column A and Status records for spreadsheet readability and filtering.
- Bootstrap manager records from existing nonempty names across months on the first explicit write requiring migration. Deduplicate case and whitespace variants; do not guess whether differently spelled names represent the same person. Read operations never mutate sheets.
- Monthly assignments use month sheet ID plus normalized property name, matching existing follow-up identity. Preserve existing assignments during migration, and include properties without follow-up metadata. Existing direct spreadsheet manager edits resolve to registered names; unknown names are surfaced as needing registration and cannot become new dropdown choices silently after migration.
- Renaming a manager preserves IDs and updates related monthly/Status display names atomically. Tasks and updates use IDs and do not lose their associations.
- Validate IDs, names, task statuses, dates, text lengths, and optional property/task links on the server. Keep existing revision conflict checks and atomic saves; include new tabs in snapshot revisions. Reject stale saves without losing drafts. Reject incompatible populated tabs without overwriting them.
- Extend the preview data and reducers so the same workflow works in preview, with the existing temporary-preview notice. Shared data is never stored only in local browser preferences.
- The rebuilt frontend requires the updated Apps Script deployment. Detect an old backend and show a clear upgrade message before permitting new writes. Publishing/deploying and migration of live data are separate from local implementation and verification.

## Verification and scope
Test migration/deduplication, rename stability, dropdown validation, invalid dates and references, reassigning/completing tasks, inactive records, stale revisions, and preservation of existing financial calculations. Run the existing test suite and production build. Check navigation, empty states, keyboard-accessible forms, responsive layout, and unsaved-draft protection. Match the existing Castle design.

No login changes, email delivery, reminders, automatic manager-name merging, or changes to financial calculations. Exact component breakdown and sheet schemas are left to implementation, within these behaviors.
