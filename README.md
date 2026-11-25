# Castle Monthly AR

A responsive, no-login accounts-receivable workspace. The interface runs on GitHub Pages; the existing Google Sheet is the shared database through Google Apps Script.

## Run locally

Use Node.js 24 (or at least 22.13).

```sh
npm ci
npm run dev
```

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

For local review without live writes, open `http://127.0.0.1:5173/?preview=1` after starting the dev server, then select Follow-ups. This override is available only in development and uses sample data.

Without an Apps Script URL, the app opens a clearly labeled preview based on the reviewed spreadsheet. Preview edits are temporary and reset on reload. They do not update Google Sheets.

## Connect the shared database

1. Open [the supplied spreadsheet](https://docs.google.com/spreadsheets/d/1EGS6cj8WKfUlH8ayk5cXaB9KW53xu7vEbl4oboAJxPY/edit).
2. Select **Extensions → Apps Script**. Paste `apps-script/Code.gs` into the script editor, replacing its empty starter function. The spreadsheet ID is already set. This is the single maintained script, including the embedded Castle Assistant. Remove any old separate Assistant.gs from the Apps Script project to avoid duplicate functions.
3. Under **Services**, add **Google Sheets API** (v4). The supplied `apps-script/appsscript.json` also declares this advanced service; you can copy it into the manifest if preferred. For a standard Google Cloud project, enable its Google Sheets API too.
4. Select **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Authorize the requested spreadsheet access as the spreadsheet owner. Some Workspace administrators restrict public deployments.
5. Copy the deployment URL ending in `/exec`, not the editor URL or `/dev` URL.
6. Put it in `public/config.js` as `appsScriptUrl`, commit, and publish. This config connects every visitor to the same sheet and takes priority over previously saved browser connection URLs. After a deployment URL update, press Ctrl+F5 to reload the published configuration; no local-storage cleanup is needed. Saved browser URLs are used only when the published URL is empty. Connection configuration is managed by the workspace administrator; the team menu contains personal preferences.
7. Verify the live app loads three November 2026 properties and the original totals. For a write test, use a new test property or an agreed disposable cell, then confirm it from a second browser. This project has not modified source data during development.

This is deliberately a no-login app: anyone with access to the Apps Script endpoint can read and edit the records. The frontend contains no Google credentials. The public endpoint URL is not a password. No authentication layer is implemented because the user explicitly requested none.

The supplied Code.gs also includes the spreadsheet's account-manager filter. Save it in the spreadsheet's bound Apps Script project, keeping only one `onEdit` and one `filterAccountManagers` function across the project. Editing A2 on any monthly AR or Bundle Matching tab shows the selected team's complete property sections; `All` or an empty cell restores every data row. Matching ignores case and surrounding spaces. The filter removes any standard sheet filter and starts at row 3. After adding properties through the website, run `filterAccountManagers` or change A2 to apply the selection to the new sections.

Saving the bound script enables this edit handler. To update the live web app too, publish a new version under **Deploy → Manage deployments**; saving the editor alone does not update the web-app deployment.

## Monthly Sheet Formatting

New property blocks and appended payment imports automatically receive the September-style monthly layout: Calibri, centered text, bold repeated headers and payment labels, wider columns, property-block borders, two-decimal amounts, and `yyyy-mm-dd` dates. Sheets with an existing two-row selector area keep those rows frozen. Both layouts (with or without Bank Details) are supported. Bundle Matching tabs retain their separate style.

To format existing October data:

1. Copy the complete `apps-script/Code.gs` into the spreadsheet's bound Apps Script project and save. This file includes the assistant functions too; avoid duplicate function definitions in other script files.
2. Select `formatOctober2026` in the editor's function menu and click **Run**. Authorize access if Google asks. This recognizes October 2026 aliases such as `Oct, 2026` and excludes Bundle Matching tabs.
3. Optionally run `formatAllMonthlySheets` to apply the same layout to every recognized monthly financial tab.
4. For future web-app imports, use **Deploy → Manage deployments → Edit → New version → Deploy** on the existing deployment, preserving its URL.

The manual functions change formatting only, preserving values, formulas, checkbox rules, the A2 selection, and hidden rows. They are safe to rerun. They do not create missing month tabs or install an edit trigger for pasting data directly into Google Sheets; run the formatter after direct sheet imports. The existing account-manager filter behavior is unchanged.

## Publish on GitHub Pages

Create a repository named `castle-monthly-ar`, then push this project with `main` as the default branch. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. The included `.github/workflows/deploy.yml` tests, builds, and deploys on each push to `main`.

```sh
git remote add origin https://github.com/YOUR_ACCOUNT/castle-monthly-ar.git
git push -u origin main
```

The Vite base is relative (`./`), so project URLs such as `https://YOUR_ACCOUNT.github.io/castle-monthly-ar/` work. No Node server or Cloudflare service is needed in production. Never put a GitHub token or Google OAuth token in `config.js`.

A prebuilt `dist/` folder can also be served by any static web host. `npm run build` copies Code.gs and its manifest into the build for the workspace administrator.

## What the app does

### Background Uploads And Saves

Uploads and record saves continue while you navigate the app. File selection, reading, configuration, and review stay visible. Import and property dialogs minimize automatically only after a database save starts; the header?s minimize icon lets you minimize a form manually, and the progress panel offers **View Form** or **Return To Form** to reopen the retained draft. Follow-up, manager, and owner editors keep their drafts when you switch views or reporting months. A completed background import does not redirect you away from your current page.

Saves run one at a time, rereading and validating against the latest records before writing. Repeated clicks on the same pending submission share one write. A conflict waits for **View Task** before asking for review; errors keep the form available, and unconfirmed writes are not automatically replayed. Measured percentages describe the current byte, row, page, or save stage; stages without a known total remain indeterminate.

Keep the browser tab open until work finishes. This is in-tab background processing, not a server job that survives closing or reloading the page. No additional Apps Script polling is introduced.

Imports do not require a current dashboard revision. On confirmation, spreadsheet imports reread the latest records and rebuild the retained files against current property/payment rows, deduplicating payments already present. Bank imports remap reviewed payments and allocations to current rows. Explicit server conflict/busy replies are retried up to four attempts; unconfirmed writes and network failures are never blindly retried. When a targeted amount or payment has changed, the dialog retains its files and shows refreshed records for another review instead of requiring a page reload. All record editors also read current records before saving and merge changes to different fields. Same-field conflicts show the current and proposed values for confirmation, while keeping the draft. Row-based property/payment identifiers are remapped using the original record; ambiguous or removed targets are never silently redirected.

Wells Fargo PDF imports support incoming **Zelle From** owner payments and identifiable Airbnb credits, including wrapped references and memos. RBC PDF imports support Airbnb and owner Autodeposits, plus Vrbo credits with an explicitly labelled transaction reference. Outgoing payments are excluded. Unsupported or incomplete incoming credits remain visible with their original amount, source location, and reason. Owner matching uses configured bank names; explicit statement service months and property addresses constrain automatic allocation.

- Month, team, status, and property search filters.
- **Follow-ups** replaces the Properties page: track owner-contact status, write notes, attach up to three compressed screenshots, and assign an account manager per monthly property. Saving updates Overview and the shared Google Sheet.
- **Castle team → User settings:** choose the opening page, default manager/team and record filter, table spacing, and payout date display. Preferences apply when saved and persist in the current browser; they do not change shared records. Defaults also apply when switching months, and the default status applies when navigating pages. Restore defaults changes the draft until Save preferences is selected. If browser storage is blocked, a notice explains that preferences last only for the current session.
- Expected payments, recorded payments, outstanding AR, and reconciliation views.
- Edit expected totals and Airbnb, Vrbo, or owner payments.
- Record platform payout dates, payout bundle amounts, bank receipt dates and amounts, and Daisy's review.
- Add a property with header, Total Payment, and AR rows. All payment rows, including Owner Payment, are created only for imported payments.
- Import `.xlsx`, `.xls`, and `.csv`: select one file or a bulk batch of Airbnb exports, choose one database property for the entire batch, enter Total Payment manually, review, then apply. Airbnb exports automatically map payments, payout dates and bundles.
- Export a numeric Excel summary plus detailed payment rows.
- Reject stale edits instead of overwriting changes made since opening an editor.

System verification is an explicit application rule: a payout bundle amount and bank amount must both exist and match. Missing amounts stay Pending. A zero is an actual value. Manual verification by Daisy is separate. The source originally left both verification columns empty.

AR = expected total minus the recorded Airbnb, Vrbo, and owner payments. Bank receipts are tracked separately and do not subtract a second time. The source does not specify currency, so amounts are shown without inventing a currency symbol.

## Property follow-ups

Each monthly property has a shared status: Not contacted, Contact attempted, Awaiting owner response, Owner responded, Payment promised, Follow-up needed, or Resolved. These track the conversation; financial collection status remains calculated from payments. Edit one property at a time, then Save update or Cancel. Notes allow 5,000 characters. Manager assignment is a dropdown of saved account-manager records. Choose Unassigned to clear an assignment. Create or rename managers on the Account Managers page.

Attach up to three PNG, JPEG, or WebP screenshots (10 MB source limit each). Images are compressed in the browser to fit the sheet; inspect their previews before saving and crop dense screenshots for legibility. The app stores the current note and attachments, not an activity history. Replacing/removing an attachment removes it from the next saved record.

**Deployment:** replace the bound Apps Script project with the latest `apps-script/Code.gs`, then deploy a new version of the existing web-app deployment. No new OAuth scopes are needed. Account manager writes to column A on the Total Payment row. Follow-up metadata is stored in the Status tab, one row per month sheet ID and property name: month, property, manager, status, note, timestamp, and three JSON-encoded image cells. The tab is created if absent; an existing empty tab is initialized. Existing K:P follow-ups remain readable and migrate together on the next follow-up save, in the same atomic batch that clears only recognized legacy cells. Existing Status records take precedence. Unrelated monthly columns are untouched. A populated Status tab with incompatible headers is rejected without overwriting it. Do not change record keys, headers, or image JSON manually. Property names must be unique within each month; payment row insertions do not change the link. Existing properties default to Not contacted until updated.

The no-login workspace shares notes and images with anyone who can access its public endpoint, just like the financial records. Save uses the existing revision checks and atomic Sheets batch. Unsaved follow-up edits keep navigation and filters disabled until Save or Cancel.

## Import rules

### New Monthly Tabs

Monthly tabs containing only the standard **AM FILTER** setup in rows 1–2 are also recognized. The first import preserves those rows and starts the property header at row 3, even when the manager dropdown is still empty.

Create a blank tab named **October 2026**, **November 2026**, **January 2027**, or another month and year in the connected spreadsheet. The app discovers monthly tabs during automatic refresh or when you select **Refresh Records**. Select the tab under **Reporting Month** before importing. The selected month is the destination regardless of the dates inside the uploaded file. The first confirmed import creates the property headers, payment rows, and AR formulas, including the Bank Details column. Subsequent imports, reconciliation, and follow-ups use that monthly tab. Discovery alone does not write to the spreadsheet. Existing populated tabs must retain the supported property-header layout.

For blank-tab discovery, replace the bound Apps Script's `Code.gs` with the updated `apps-script/Code.gs` and publish a new version of the existing web-app deployment under **Deploy → Manage deployments**. Keep the existing deployment URL; saving the script alone does not update the live app.

Step 2 suggests property names from the loaded Google Sheet database, across months. Choose an existing property or type/paste a name. Names match within the selected month after case/whitespace normalization. A name not present in that month creates a monthly property record on confirmation, requiring a manager and a manually entered Total Payment. Existing totals are prefilled and can be edited. New property creation, imported payment rows, formatting and formulas use the Add Property path in one atomic save. New blocks contain only the header, Total Payment, and AR until payments are imported. Only supplied payment rows are inserted before AR, including Owner payments. No default zero Owner Payment or blank platform slots are created. An empty property has AR equal to Total Payment.

Airbnb exports use the detail row's **Amount** for the payment and the preceding **Payout** row's **Arriving by date** and **Paid out** for its payout date and bundle. The bundle is not added to collected payments. Multiple details for one payout are summed into one payment slot. Import one listing per file and one currency per batch; unsupported row types, malformed amounts/dates and missing payout details block the whole import. Default placement uses the next completely empty Airbnb slot and skips an identical amount/date/bundle already recorded, including earlier files in the same batch. Once all slots are full, the importer inserts Airbnb Payment rows immediately before the selected property's AR row, copies the payment formatting, adds Daisy checkboxes and verification formulas, and updates AR to include the added rows. To fill payout information for amounts already entered manually, select **Replace starting at Airbnb payment 1**, **2** or **3** as appropriate. Review all replacements before confirmation. Bank receipt fields and Daisy verification remain unchanged.

Total Payment never comes from the CSV. For the supplied example, enter **370.48**; three payments of **116.86**, **130.81** and **77.19** yield **45.62 AR**. Select the files together and map them to the selected month/property; payout dates do not change the destination month.

For other spreadsheets, select the amount column and payment destination. All amounts target the chosen database property. Blank amounts and recognized summary rows are skipped; explicit zero writes zero. Multiple payment rows are blocked unless the user explicitly chooses to sum them. Invalid rows in a sum block the entire property's payment. Payment writes replace the selected destination value; if that payment slot is missing, the import adds only the required payment row.

**Deployment for compact property blocks and bulk import:** publish the rebuilt frontend and replace `Code.gs` in the bound Apps Script project with `apps-script/Code.gs`, then deploy a new version of the existing web-app deployment. The compact new-property layout, `appendPayments` operation and `additionalPayments` field require this backend update. Deploy the latest version so new properties do not use the old blank-slot layout. Keep the existing deployment URL. Local tests do not write to the live database.

Amounts use US-style `1,234.56` separators and support accounting negatives. Values are rounded to cents. Formula cells require a cached numeric result; macros/formulas are never executed. Limits: 50 files, 10 MB per file, 50 MB combined uploads, 10,000 combined selected worksheet rows, 500,000 cells per worksheet, and 500 payment writes/changes in one server save. Larger imports must be split. Import/export uses locally bundled SheetJS CE 0.20.3; its license is in `public/vendor/LICENSE-sheetjs.txt`.

For bulk import, choose the destination property once for all selected files. Total Payment and manager are shared across the batch, and the existing total is prefilled. Changing or removing files keeps the selected destination. The file list is for previewing source data and adjusting worksheet/header settings only. Multi-file batches always use automatic placement, never replacement. Review shows the one destination plus each filename and source row, and confirmation sends one atomic save. Repeated imports are identified by amount, payout date, and bundle, not reservation ID; review skipped matches if separate payouts have identical values.

Airbnb is automatically recognized by Type, Amount, Paid out, Arriving by date, and Currency headers. The Listing column and listing values are optional: the property selected for the batch determines the destination. If listing names are present, multiple distinct names within one file are still flagged for review. Bulk upload currently accepts only recognized Airbnb exports. Vrbo and Booking.com detection/mapping are deferred until representative files are available; unknown single files retain manual mapping.

## Spreadsheet structure

Monthly tabs are recognized by names such as `Nov, 2026` or `November 2026`. Each property has a header, Total Payment row, payment rows, and AR formula row. The parser reads recognized monthly tabs and leaves unrelated tabs alone. Additional matching monthly tabs created in Google Sheets appear after Refresh. Extra payment rows of recognized types can be inserted in Sheets, provided their AR formula is maintained.

New properties copy A:J cell formatting from the first existing property in their month, including borders, fonts, alignment, and number/date formats. Header, total, payment types, and AR rows are matched separately to support templates with extra payment rows. The new property's values, formulas, and Daisy checkboxes are saved in the same batch. This applies to future additions; existing blocks are not reformatted.

Original snapshot reviewed 2026-10-28:

| Property | Team | Expected | Recorded | AR |
| --- | --- | ---: | ---: | ---: |
| Mtl 404 Le Bijou | Team B | 442.04 | 0.00 | 442.04 |
| Mtl 2429 Rue Allard Unit 1 | Team A | 243.38 | 0.00 | 243.38 |
| Tor Unit 918-251 Jarvis St | Team B | 370.48 | 324.86 | 45.62 |
| Total | | 1,055.90 | 324.86 | 731.04 |

The original AR formulas reconcile. The third property's floating-point result is represented as 45.62 using integer cents. All payout/bank details and verification fields were blank. Repeated headers and unnamed payment-type column are retained in the Sheet and normalized in the app.

## Validation and limitations

```sh
npm test
npm run build
```

Tests exercise the actual Apps Script code in a controlled Google-service fixture, parsing and atomic request construction, conflict/idempotency handling, client acknowledgements, currency calculations, and real XLSX/XLS/CSV input bytes. They do not substitute for an owner-authorized deployment check. Browser visual QA was unavailable in the execution environment.

Apps Script's script lock serializes app saves. Revision hashes also detect prior direct edits to the Sheet. A human editing a cell directly during the brief revision-check/write interval cannot be atomically excluded by the Sheets API. Each validated save uses a single atomic Sheets batch; a network failure can leave its outcome unknown, which the app reports without silently replaying it. Request receipts are retained for up to seven days or 800 requests.

Cross-origin reads use Google's documented JSONP Content Service support. Writes use a hidden form POST, then poll a read-only status endpoint for acknowledgement. A form submission or opaque response alone never means “saved.” If a save is unconfirmed, refresh and inspect the Sheet before trying again.


Click a screenshot thumbnail to open the full image in a centered viewer. Close using Escape, the close button, or the backdrop. Opening and closing fade/zoom smoothly, with reduced-motion preferences respected.

## Account managers and tasks

Account Managers is a shared directory with names, optional email/notes, and active status. Open a manager to see monthly listing assignments, separate tasks with required due dates and Open / In progress / Completed status, and timestamped updates. Tasks remain visible across reporting months. The listing view can switch between the selected month and all months. Tasks can be reassigned, completed, or reopened through Edit. Updates are append-only; current property follow-up notes are labeled separately and do not imply historical tracking.

Follow-ups, Add Property, new-property imports, and task assignments use saved manager records. Inactive managers retain existing assignments but are excluded from new assignments. Existing names are deduplicated by case and whitespace during bootstrap; other spelling differences are kept separate. Unknown names typed directly in monthly sheets after migration are flagged for registration, not silently added to the directory. Rename managers through the app so their IDs and monthly display names remain linked.

**Deployment:** replace the bound Apps Script with the rebuilt `apps-script/Code.gs`, then deploy a new version of the existing web-app deployment. The frontend checks `managerSchema: 1` before allowing manager/assignment writes. Keep the existing deployment URL. The first manager or assignment save atomically creates/initializes Account Managers, Manager Tasks, Manager Updates, and Manager Assignments tabs. Reads never migrate data. These tabs have validated field-name headers; do not change their IDs or headers. Existing financial cells and formulas are preserved. No new OAuth scopes are needed.

**Local inspection:** run `npm.cmd run dev`, then open `http://127.0.0.1:5173/?preview=1&view=managers` for the new page with temporary sample records. Preview changes reset on reload and do not write to Google Sheets. Without `preview=1`, local development uses the configured shared Google Sheet; saving there changes shared data. Preview override is available only in the development server. No live migration or deployment is performed by the local build/tests.

### Account-manager profile images

Use **Account managers ? Edit details ? Upload image / Change image** to add a PNG, JPEG, or WebP (up to 5 MB). The preview appears immediately in the form; Save changes stores it with the shared manager record. Remove image returns to the blank silhouette after saving. New managers start blank. Existing Team B and Team A records receive black and red text badges matching the supplied reference designs; uploads can replace these badges. Removed badges stay blank, including after refresh or rename.

Uploaded images retain their aspect ratio and transparency, are resized to at most 256 pixels, and are compressed below 45,000 characters to fit one Google Sheets cell. A new `profileImage` column is appended to Account Managers when saving with the updated script; existing five-column records remain readable, and an occupied/unrecognized sixth column is rejected without overwriting it. Redeploy the latest Apps Script to enable shared profile uploads. Preview mode supports profiles immediately.

## Automatic data refresh and returning to your page

Successful saves immediately apply the latest snapshot returned by Google Sheets without reloading the document or changing the current page. Connected workspaces also check for shared changes every 15 seconds while the tab is visible, refresh when returning to the tab or reconnecting, and notify other open tabs on the same origin after saves. Other devices and direct Google Sheet edits appear on the next successful check. Preview mode does not poll the shared sheet.

Automatic refresh pauses while editing a follow-up, manager, task, update, payment, new property, import, or preferences. In-flight responses from before editing/saving are discarded; one fresh read catches up after Save or Cancel. Stale server revisions still reject conflicting saves, leaving the draft available. Reads are serialized, unchanged revisions do not replace rendered records, and failed reads retain the last loaded data and retry automatically.

Current page, reporting month, property filters/search, and selected manager/manager section are remembered per browser tab using session storage, including after a manual browser reload. Explicit view links take precedence on entry and follow subsequent navigation. Active editors are not auto-reopened after a manual reload, and unsaved drafts are not persisted. Automatic refresh never unmounts them. If session storage is blocked, automatic updates still preserve the current in-memory view. Removed months/managers fall back to the first available record.

### Bank details and bank reports

Airbnb imports extract account labels such as "Checking 5864" from the Payout row's Details column (column K in the standard export). The recipient and currency suffix are excluded. Bank details follow each payout into its payment row, including multi-file imports. The import preview shows the extracted account. Re-importing the same amount/date/bundle fills missing bank details without duplicating the payment; differing known accounts are separate payments. Missing or unrecognized account text is shown as Not Specified.

Monthly tabs with Bank Details in column G use H for Bank Received Time, I for Bank Received Amount, J for Verify By System and K for Verify By Daisy. Every property header in the tab must use this layout. Older tabs retain their existing column mapping; to import bank details into an older tab, insert G and label every property header Bank Details first. The script rejects bank-detail writes to the old layout rather than overwriting dates. Deploy the updated apps-script/Code.gs and publish the frontend before using this feature.

Overview shows each property's distinct bank accounts. Bank Report (in the property table footer) downloads the selected month's payment records for all banks or multiple selected banks. The Excel workbook contains bank totals and filterable payment records, including an explicit Not Specified group. Bank totals sum recorded payments, not payout bundles or property balances. Existing overview filters do not limit the bank report.

### Assistant Account Managers

Account Managers appears below Reconciliation. When adding or editing a manager, choose Account Manager or Assistant Account Manager. Assistants require a saved parent Account Manager, selected from a dropdown; self-parenting and nested assistants are rejected. The directory groups assistants under their parent and both profiles link to the related records. Listings, tasks and updates retain their existing individual assignments. Reassign assistants before deleting a parent or changing that parent to an assistant.

Deploy the updated Code.gs to enable roles. The next manager save safely extends the Account Managers tab with role and parentManagerId columns (G and H of that tab). Existing five- and six-column records default to Account Manager, preserving profile images. Migration refuses to overwrite occupied extra columns.

### Bank statement import

The toolbar offers **Import Excel** for property/payment data and **Import Bank Statement** for bank reconciliation. Select the reporting month, choose **Import Bank Statement**, then **Choose Bank Files**. Upload RBC or Wells Fargo text-based PDFs, or bank transaction exports (`.xlsx`, `.xls`, `.csv`), review the matches, and click **Save Payment Rows**. PDF and spreadsheet files can be selected together: up to 25 files and 50 MB combined, with 20 MB per PDF and 10 MB per spreadsheet. Files are read locally with PDF.js or the bundled SheetJS reader. Scanned/image-only PDFs require OCR before importing; OCR is not built in.

Bank spreadsheets support the supplied Host/MG CAD/USD layouts and the supplied US transaction export. The importer checks account, transaction date, description, amount, currency, posting status and debit controls. Column order can vary. It selects a single populated currency column automatically and offers validated manual mapping for other layouts. Contradictory controls, damaged numeric identifiers, formulas and errors cannot become bank evidence. Missing source account/currency requires explicit confirmation. Every omitted incoming credit is listed with its reason and source row. Withdrawals are excluded. Excel dates, `YYYY-MM-DD`, and US `MM/DD/YYYY` text dates are supported; each worksheet is limited to 10,000 rows.

For RBC exports, positive `CAD$` values supply the received amount and negative values are outgoing. `e-Transfer - Autodeposit` identifies owner receipts; `AIRBNB PAYMENTS` identifies Airbnb receipts, including the `Account Payable Pmt` prefix. `Account Payable Pmt` with only a numeric reference is also supported, while a named different payer remains for review. References are extracted from the description text and retain their case and leading zeros. Leave **Transaction Reference** at **Extract From Descriptions** and **Debit Amount** at **No Separate Debit Column** for these exports. Column choices cannot reuse the same source field. Posting Status is no longer a mapping control; explicit status data in other formats is checked automatically when present.

Platform credits match account identity, currency, platform and exact bundle cents across properties in the selected month. Payout dates may differ from bank dates. Ambiguous groups and equal-value deposits require explicit payout selection. Selected rows cannot exceed the receipt's remaining value or belong to two deposits. Already recorded allocations are skipped, and conflicting receipt evidence is rejected. Owner credits use owner-name matching and allocation review; genuinely missing references remain unresolved until the user supplies an authentic source reference or skips the deposit.

A revision-protected Apps Script action revalidates the account, currency and bundle, copies the current payment amount from D to I, writes the bank transaction date to H and TRUE to J, and records the receipt allocation atomically. It never modifies Daisy's K checkbox. Changes to evidence fields invalidate prior system verification but do not release receipt history for reuse. Direct Google Sheets edits require manual review.

**Deployment:** publish the frontend build and update the existing Apps Script web-app deployment to a new version containing `apps-script/Code.gs`. The importer requires `bankStatementSchema: 2` and `bankReceiptSchema: 1` with a receipt list before saving. Monthly tabs require Bank Details in G and bank fields in H/I/J/K; legacy monthly layouts cannot receive bank-statement reconciliation. See **Bank Import Accuracy And Deployment** below for ledger migration and record-editing constraints.

### Editing and deleting records in the app

Open a property from Overview or Reconciliation to edit its name, manager, expected amount, payment type, payment/bundle/bank amounts, payout/bank dates, bank details and Daisy verification. Blank optional values clear the corresponding cells. System verification remains automatic and is invalidated when payment evidence changes.

**Delete Payment** removes that payment row and repairs the property's AR formula. **Delete Property** removes that property's data and payments from the selected month, clears its Status/assignment metadata, and detaches its task/update links while retaining task history. Both actions require confirmation; unsaved drawer edits are discarded only after confirmation. The final property deletion leaves an empty month available for future imports. Renaming preserves existing notes and links and rejects duplicate names or collisions with older metadata.

These controls use the existing revision checks and atomic Sheets batches. Update the Apps Script web-app deployment to expose `recordEditingSchema: 1` before using them live. The local preview supports editing and deletion with sample records and resets on reload.
# Castle Assistant

The app includes a direct-access AI panel for workspace questions, reports, and reviewed edits. See [setup and local preview instructions](docs/castle-assistant-setup.md). API credentials belong only in Apps Script settings.

### Owner payments across reporting months

Owner deposits match the saved Name on Bank Statement (case and extra spaces ignored). An exact, unique outstanding balance in the selected month is preselected. Manual review allows the full deposit to be allocated across mapped properties and months, with remaining balances shown before Save. Saving creates Owner payment rows and one transfer ledger entry; Airbnb payout records are unchanged. Existing transfers remain readable. Deploy the updated Apps Script before using cross-month allocation (`ownerAllocationSchema: 1`); older deployments remain limited to their selected month.

Local demo: `npm run dev`, then open `http://127.0.0.1:5173/?preview=1&ownerDemo=1&view=owners`. This uses fictional, temporary records that reset on reload. Import the CSV files under `tests/fixtures/owner-payments`: the exact payment clears November?s 23.11 balance; allocate the bulk payment as 30.00 to October and 40.00 to September.

Airbnb import mapping now requires a payment recipient for each file: Received By Castle or Received By Owner. Owner-received amounts remain visible as reference payouts and are excluded from Castle collections, AR deductions, and bank matching. The updated Apps Script advertises `airbnbRecipientSchema: 1` and stores these rows as Airbnb Owner Payout, with AR formulas excluding them. Existing unmarked payments retain their Castle-received behavior.

## Bank Import Accuracy And Deployment

Bank review accepts up to 25 files totaling 50 MB (20 MB per PDF, 10 MB per spreadsheet). CAD/USD amount columns, explicit currency metadata, posting status, debit controls, full accounts, dates, references, and source errors are checked before matching. A single populated currency column is selected locally; contradictory source evidence blocks automatic, AI-assisted, and manual mappings. Unknown layouts offer validated column selectors. A missing account or currency requires explicit confirmation from the source, never a guess from a filename or payout amount.

The review shows parsed and excluded totals separately by currency, the source rows and reasons for exclusions, duplicate status, and missing details. Repeated identical platform receipts are skipped. Equal-value receipts can select individual payout rows explicitly; there is no arbitrary split. Review lists are paginated and payout choices are searchable to keep large batches responsive. An unsupported, otherwise valid incoming credit can be reviewed as an owner payment, but its bank amount and any authentic source reference remain fixed. A genuinely missing reference requires more complete bank details or an explicit skip.

**Deploy both parts of this update:** publish the rebuilt frontend and paste the updated `apps-script/Code.gs` into the existing bound Apps Script project, then deploy a new version of its web app. Keep the existing endpoint. The frontend checks `bankReceiptSchema: 1` and the returned receipt list and disables bank saves when the deployed backend is older. Saving the script editor alone is not deployment.

The backend creates **Bank Receipts** on the first platform bank import, in the same atomic Sheets batch as the payment verification. It stores full account identity, currency, reference, original receipt amount/date/source, available original description and source coordinates, and allocations. Duplicate references, conflicting evidence, reused payment rows, cross-category owner/platform collisions, and cumulative over-allocation are rejected. Reimporting an already applied save is idempotent. Existing Owner Transfers records remain readable; their evidence columns migrate atomically on a later authorized save.

Historical receipt allocations remain reserved if a payment is edited. Renaming or deleting properties and removing earlier payment rows is blocked where it would break recorded receipt links. Pre-upgrade payment verifications that could consume the same receipt require review; the upgrade does not invent historical references or silently reallocate old bank evidence. The ledger is authoritative bank history: do not hand-edit its headers, identity keys, amounts, or allocation JSON.

Automated verification uses anonymized fixtures and an in-memory Google Sheets harness. Original private statements are checked locally and are not included in the repository. No local development check submits real financial records.
