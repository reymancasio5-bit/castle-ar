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
6. Put it in `public/config.js` as `appsScriptUrl`, commit, and publish. This config connects every visitor to the same sheet. The app's **Connect Google Sheets** dialog can test a URL and save it for the current browser during setup; it is not a substitute for publishing the shared config.
7. Verify the live app loads three November 2026 properties and the original totals. For a write test, use a new test property or an agreed disposable cell, then confirm it from a second browser. This project has not modified source data during development.

This is deliberately a no-login app: anyone with access to the Apps Script endpoint can read and edit the records. The frontend contains no Google credentials. The public endpoint URL is not a password. No authentication layer is implemented because the user explicitly requested none.

When changing Code.gs, publish a new version under **Deploy → Manage deployments**; saving the editor alone does not update the live web app.

## Publish on GitHub Pages

Create a repository named `castle-monthly-ar`, then push this project with `main` as the default branch. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. The included `.github/workflows/deploy.yml` tests, builds, and deploys on each push to `main`.

```sh
git remote add origin https://github.com/YOUR_ACCOUNT/castle-monthly-ar.git
git push -u origin main
```

The Vite base is relative (`./`), so project URLs such as `https://YOUR_ACCOUNT.github.io/castle-monthly-ar/` work. No Node server or Cloudflare service is needed in production. Never put a GitHub token or Google OAuth token in `config.js`.

A prebuilt `dist/` folder can also be served by any static web host. `npm run build` copies Code.gs and its manifest into the build so the connection dialog's downloads work.

## What the app does

- Month, team, status, and property search filters.
- Expected payments, recorded payments, outstanding AR, and reconciliation views.
- Edit expected totals and Airbnb, Vrbo, or owner payments.
- Record platform payout dates, payout bundle amounts, bank receipt dates and amounts, and Daisy's review.
- Add a property with the existing spreadsheet block format.
- Import `.xlsx`, `.xls`, and `.csv`: choose worksheet/header, map property and amount columns, choose destination, review, then apply.
- Export a numeric Excel summary plus detailed payment rows.
- Reject stale edits instead of overwriting changes made since opening an editor.

System verification is an explicit application rule: a payout bundle amount and bank amount must both exist and match. Missing amounts stay Pending. A zero is an actual value. Manual verification by Daisy is separate. The source originally left both verification columns empty.

AR = expected total minus the recorded Airbnb, Vrbo, and owner payments. Bank receipts are tracked separately and do not subtract a second time. The source does not specify currency, so amounts are shown without inventing a currency symbol.

## Import rules

Files can have different column names and header positions. Matching uses exact property names after case/whitespace normalization; it does not guess a similar property. Unmatched and invalid rows are not applied. Blank amounts preserve existing data; explicit zero writes zero. Duplicate matches are blocked unless the user explicitly chooses to sum them. Import writes replace the selected destination value, so repeatedly importing the same snapshot does not add it again.

Amounts use US-style `1,234.56` separators and support accounting negatives. Values are rounded to cents. Formula cells require a cached numeric result; macros/formulas are never executed. Limits: 10 MB per file, 10,000 worksheet rows, 500,000 cells, and 500 changes in one server save. Larger imports must be split. Import/export uses locally bundled SheetJS CE 0.20.3; its license is in `public/vendor/LICENSE-sheetjs.txt`.

## Spreadsheet structure

Monthly tabs are recognized by names such as `Nov, 2026` or `November 2026`. Each property has a header, Total Payment row, payment rows, and AR formula row. The parser reads recognized monthly tabs and leaves unrelated tabs alone. Additional matching monthly tabs created in Google Sheets appear after Refresh. Extra payment rows of recognized types can be inserted in Sheets, provided their AR formula is maintained.

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

