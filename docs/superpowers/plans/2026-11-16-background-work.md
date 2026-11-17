# Background Uploads And Saves

User scope: all file uploads and record saves, including Add Property. Keep measured progress visible while navigation remains usable. Work continues within the open browser tab.

Implementation:
1. Add a serial save queue with tests for ordering, rejection, and pending counts. Retain immutable submission inputs and revalidate against the latest server revision when each queued save runs.
2. Keep workspace views mounted across navigation so pending work and failed drafts survive. Track dirty state per workspace, while permitting navigation and filtering. Preserve the month of each open editor/import.
3. Minimize busy dialogs without unmounting their forms. Keep a persistent Return To Form/Review Files action, and retain existing validation and failure recovery. Do not navigate the user away from their current page on background completion.
4. Extend the progress panel for queued tasks, return actions, and tab-close protection. Keep server polling frequency unchanged and preserve indeterminate stages where no measured total exists.
5. Run the full test suite, production build, and code review. Local preview remains available; no live deployment is requested.

Validation focuses on preventing overlapping writes, preventing lost drafts, and ensuring a failed task cannot appear complete or stop subsequent queued work.
