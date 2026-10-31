# Castle Monthly AR

A responsive, no-login accounts-receivable workspace. The interface runs on GitHub Pages; the existing Google Sheet is the shared database through Google Apps Script.

## Run locally

Use Node.js 24 (or at least 22.13).

```sh
npm ci
npm run dev
```

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

Without an Apps Script URL, the app opens a clearly labeled preview based on the reviewed spreadsheet. Preview edits are temporary and reset on reload. They do not update Google Sheets.

## Connect the shared database

1. Open [the supplied spreadsheet](https://docs.google.com/spreadsheets/d/1EGS6cj8WKfUlH8ayk5cXaB9KW53xu7vEbl4oboAJxPY/edit).
2. Select **Extensions → Apps Script**. Paste `apps-script/Code.gs` into the script editor, replacing its empty starter function. The spreadsheet ID is already set.
3. Under **Services**, add **Google Sheets API** (v4). The supplied `apps-script/appsscript.json` also declares this advanced service; you can copy it into the manifest if preferred. For a standard Google Cloud project, enable its Google Sheets API too.
4. Select **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Authorize the requested spreadsheet access as the spreadsheet owner. Some Workspace administrators restrict public deployments.
5. Copy the deployment URL ending in `/exec`, not the editor URL or `/dev` URL.
6. Put it in `public/config.js` as `appsScriptUrl`, commit, and publish. This config connects every visitor to the same sheet and takes priority over previously saved browser connection URLs. After a deployment URL update, press Ctrl+F5 to reload the published configuration; no local-storage cleanup is needed. Saved browser URLs are used only when the published URL is empty. Connection configuration is managed by the workspace administrator; the team menu contains personal preferences.
7. Verify the live app loads three November 2026 properties and the original totals. For a write test, use a new test property or an agreed disposable cell, then confirm it from a second browser. This project has not modified source data during development.

This is deliberately a no-login app: anyone with access to the Apps Script endpoint can read and edit the records. The frontend contains no Google credentials. The public endpoint URL is not a password. No authentication layer is implemented because the user explicitly requested none.

The supplied Code.gs also includes the spreadsheet's account-manager filter. Save it in the spreadsheet's bound Apps Script project, keeping only one `onEdit` and one `filterAccountManagers` function across the project. Editing `Nov, 2026!A2` shows the selected team's complete property sections; `All` or an empty cell restores every data row. Matching ignores case and surrounding spaces. The filter removes any standard sheet filter and starts at row 3. After adding properties through the website, run `filterAccountManagers` or change A2 to apply the selection to the new sections.

Saving the bound script enables this edit handler. To update the live web app too, publish a new version under **Deploy → Manage deployments**; saving the editor alone does not update the web-app deployment.

## Publish on GitHub Pages

Create a repository named `castle-monthly-ar`, then push this project with `main` as the default branch. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. The included `.github/workflows/deploy.yml` tests, builds, and deploys on each push to `main`.

```sh
git remote add origin https://github.com/YOUR_ACCOUNT/castle-monthly-ar.git
git push -u origin main
```

The Vite base is relative (`./`), so project URLs such as `https://YOUR_ACCOUNT.github.io/castle-monthly-ar/` work. No Node server or Cloudflare service is needed in production. Never put a GitHub token or Google OAuth token in `config.js`.

A prebuilt `dist/` folder can also be served by any static web host. `npm run build` copies Code.gs and its manifest into the build for the workspace administrator.

## What the app does

- Month, team, status, and property search filters.
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

## Import rules

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

