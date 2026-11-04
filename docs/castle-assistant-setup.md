# Castle Assistant setup

The local code includes the assistant panel, app-specific instructions, record queries, reports and reviewed edits. It is not deployed automatically. No API key is included in this project.

## Local preview

Run `npm.cmd run dev` and open http://127.0.0.1:5173/?preview=1. Click the chat icon. Preview always produces a clearly marked calculated sample report; it does not call OpenAI or change Google Sheets. To exercise real AI from localhost, use the connected app without `?preview=1` after configuring the backend below. That connected mode uses real records and Apply saves to the real sheet.

## Configure the backend when ready

1. Run `npm.cmd run build`. Copy the entire generated `public/Code.gs` into the Apps Script project's Code.gs. It combines `apps-script/Code.gs` and `apps-script/Assistant.gs`. Alternatively, maintain those two source files separately in Apps Script; do not install both forms, which would duplicate functions.
2. Update the Apps Script manifest from `public/appsscript.json`. It adds the external-request permission needed to call OpenAI. Keep the advanced Sheets service enabled.
3. In Apps Script **Project Settings → Script Properties**, set:

| Property | Value |
| --- | --- |
| `OPENAI_API_KEY` | Your OpenAI Platform API key |
| `CASTLE_AI_DAILY_LIMIT` | Optional: shared questions/day, default 40, maximum 500 |
| `CASTLE_AI_MODEL` | Optional: default `gpt-4.1-mini`; must support Responses and strict function tools |

4. Save a new web app deployment version and authorize the added permission. Keep its `/exec` URL in the existing public configuration. Never place the key in config.js, frontend environment variables, commits, or chat messages.
5. Open the connected app, click the chat icon and type your question. Test a report first, then an edit proposal. The assistant does not save unless the user reviews and clicks **Apply changes**.

## Supported behavior

### When Project Settings shows more than 50 properties

The read-only list is an editor limitation, not a limit of 50 stored properties. Keep the `castle_request_...` entries: they are save-request receipts used to prevent duplicate writes.

After copying the updated generated `public/Code.gs` into your spreadsheet-bound Apps Script project, save it. Select **castleConfigureAssistant** in the function dropdown next to **Run**, then click **Run**. Switch back to your Google Sheet: enter the API key in the prompt. The prompt displays what you type, so use it privately. It does not place the key in source code or logs. Canceling the prompt saves nothing. The helper adds/updates just the AI settings and preserves existing properties. Existing deployments read the new properties without needing another deployment just for the settings.

If the project is standalone, use the [PropertiesService](https://developers.google.com/apps-script/guides/properties) from its editor instead; spreadsheet prompts require a bound project.

- Reports and answers use fresh monthly properties/payments, follow-up statuses/notes, managers, tasks and updates. Values are calculated in integer cents; reports distinguish D received amounts from I bank amounts. Query results are paginated; the assistant must state when data is incomplete. Attachments and profile images are not analyzed.
- It can propose property name/manager changes, expected totals, payment field edits (including Daisy verification), and property/payment deletion. Other actions are explained through the existing app workflow. It cannot run arbitrary code, send messages, alter the app source, or set System verification. Bank verification remains in the PDF importer.
- Review cards identify the record and display the intended values in readable form. Saves reuse existing backend validation and revision checks. If the sheet changes, refresh and request a new proposal.
- Chat history is kept only in the current page session. Reloading clears it.

## Usage and access boundaries

The team shares 6 questions/minute and the configured daily limit, resetting at UTC midnight. Each question is reserved before network calls; failed requests also count. Each question allows at most 3 model calls, 1,200 output tokens per call, 50,000 characters of conversation/tool input, and a short history. These are request/context limits, **not a dollar billing cap**. Configure provider project usage controls separately. `CASTLE_AI_USAGE` is managed automatically; do not edit it during active use.

Obvious unrelated prompts are rejected without an OpenAI call. Ambiguous or mixed requests may consume tokens before the model refuses them. Scope instructions are a guardrail, not a guarantee that every unrelated phrase will cost zero tokens.

The API key stays in Script Properties, which project editors can access. The assistant uses `store:false`, but questions and relevant records are still transmitted to OpenAI for processing. Short-lived results are cached in Apps Script for 10 minutes and retrieved using a random request receipt. Treat receipt URLs as private. No passcode or login is required: anyone who can reach the app or its endpoint can use the shared AI allowance. Server-side usage limits still apply. Any old CASTLE_AI_PASSCODE property is ignored and may be left in place.

No model fine-tuning is required. Maintain the application guide in `Assistant.gs` when workflows change. The API uses [OpenAI Responses function calling](https://developers.openai.com/api/docs/guides/function-calling) and the default [GPT-4.1 mini model](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

## Verification before live use

Automated tests cover access without a passcode, refusal without a paid request, exact-cent summaries, quotas, transport credential handling, real backend proposal validation, and revision-controlled saves. A real model request requires your configured deployment/key and has not been run by the local build. Check a report against the sheet and review a small proposed edit before wider team use.
