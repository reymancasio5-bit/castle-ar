# Assistant files and reports

Extend the current direct-access assistant, preserving quotas, app-only scope and explicit write review.

1. Add tests and safe Markdown/report HTML rendering. Format model replies without executing model-provided markup or URLs. Reports are model-authored PDF, XLSX, or TXT artifacts. Ask the user which format when unspecified, recommending PDF. jsPDF/AutoTable renders actual paginated PDF bytes.
2. Add one local attachment (PDF text, XLSX/XLS/CSV, TXT/MD), max 10 MB and 18,000 extracted characters. Read bounded text locally and send it as untrusted evidence. Larger documents are explicitly labeled excerpts while imports retain the full original file. Screenshots are sent as vision inputs. Reject unreadable/scanned PDFs rather than inventing their contents. Keep original File locally for import handoff.
3. Add create_report and prepare_import tools with validation; return artifacts and review actions, never executable code. Keep system verification in existing bank importer. Progress receipts describe actual stages while waiting; this transport is not SSE/token streaming.
4. Add paperclip/composer, file chip, formatted messages, progress animation, downloadable report cards and import review buttons. Prefill existing import dialogs with original attachments; preserve revision/validation and explicit final apply.
5. Test size limits, malicious markup, model tool calls, incorrect file types, reports, and import routing. Build, review, document limitations and deployment. No live deployment or model call without configured credentials.
