# Castle Assistant

Design: embed a responsive assistant in the existing app. Use Google Apps Script as the secret-holding backend, OpenAI Responses with bounded function calls, and fresh spreadsheet records. No fine-tuning is needed. Team passcode and usage limits protect the paid AI route, not the existing public spreadsheet bridge. Never put secrets in frontend configuration.

1. Add backend tests for authentication, scope, budgets, calculated summaries, and proposal restrictions. Run failing tests.
2. Implement Assistant.gs: POST authentication, unguessable private receipt polling, shared daily/minute quotas, bounded queries, exact-cent calculations, current-record validation of proposed changes. Reuse existing revision-controlled saves only after user review. No AI-generated bank verification.
3. Add frontend transport and accessible responsive assistant panel: memory-only passcode, bounded history, report download, review/apply changes, explicit sample-only local demonstration.
4. Bundle Assistant.gs into downloadable Code.gs, add external request scope and setup documentation. Verify tests/build and review security boundaries. Do not deploy live.

Defaults: GPT-4.1 mini, 40 questions/day shared, 6 questions/minute shared, at most 3 model calls/question and 1,200 output tokens/call. Context and tool results are capped. Limits are configurable in Script Properties and are request limits rather than a dollar billing cap. Scope checks reject obvious unrelated prompts locally and enforce app-only instructions in the model.
