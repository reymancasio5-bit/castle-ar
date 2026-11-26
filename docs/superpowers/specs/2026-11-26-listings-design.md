# Listings

Add a permanent Listings directory independent of reporting months. Each listing has a name, an optional owner, and an optional registered account manager. No amount or financial record is created. Existing monthly properties appear automatically; saving assignments applies them to matching existing monthly records, as requested by the user.

Use a dedicated Listings sheet for name and manager ID, and retain Property Owners.propertyNames as the authoritative ownership mapping. This avoids creating zero-dollar monthly records or duplicating ownership data. The alternative of making the existing monthly amount optional would still tie listings to a month and misrepresent the directory as financial records.

Match names using the existing owner normalization. Preserve existing names and receipt history; editing this page changes assignments, not names of existing listings. Registered inactive assignees may be retained but not newly assigned. Multiple existing owner mappings remain visible until explicitly resolved. Future monthly forms and imports use directory manager defaults. Existing financial values, follow-up contents, and transfer history remain intact.

Keep existing React/Vite and Apps Script architecture, revision checks, atomic Sheets batch saves, preview mode, and Initial Capitals UI copy conventions. No deployment is implied.

User clarification: store listings in a separate sheet and provide Add To Month. The action selects any available reporting month, then offers an outstanding amount or the existing file-import review. Existing monthly records prevent duplicate creation but remain available for payment imports. Import handoff carries the selected manager and existing/entered expected amount.
