# Owner Payment Allocation Implementation Plan

**Goal:** Settle owner management-fee balances using bank deposits, including bulk payments across reporting months.

**Design:** Retain exact name and amount matching in the selected month and the existing review/save workflow. Manual allocation exposes all mapped AR properties by month. Record one transfer with month-specific allocations; create verified Owner rows in those months. Airbnb rows remain unchanged. Require the entire deposit to be allocated before saving and preserve duplicate prevention. Existing ledger entries remain readable. New backend capability gates cross-month allocation.

**Approach:** Extend the existing Owner transfer flow, rather than marking unrelated Airbnb deposits as verified or creating a separate unallocated-credit ledger. User approved implementation after the behavioral discussion. Full-deposit allocation is the implementation assumption stated before work.

**Tech Stack:** React, TypeScript, Google Apps Script, existing Node test harness.

## Tasks
- [x] Add regression tests for exact settlement, partial settlement, cross-month splits, malformed month targets and duplicate imports.
- [x] Extend transfer types, domain validation and Apps Script persistence with optional allocation month IDs and a capability flag.
- [x] Show all mapped months in manual review, including remaining balances and month-specific payment history.
- [x] Run unit/backend tests, UI render checks and production build. Start and inspect an isolated local preview with example owner deposits.

## Review Focus
Legacy transfer compatibility; same property name in different months; stale/invalid month selection; duplicate bank references; partially paid balances.

## Progress
Implementation authorized; existing exact matching and owner payment posting confirmed by inspection.

Verification: 263 tests passed; owner UI static rendering and production build passed. Independent review found a cumulative balance preview issue, corrected to use the validated working snapshot. Local server returned HTTP 200. Browser automation host unavailable; visual browser verification could not be performed. No deployment performed.

## Follow-up: Airbnb Recipient Mapping
User requested a per-file recipient dropdown instead of saved bank-account ownership. Preserve amounts on owner-received records, exclude them from collections/AR and bank reconciliation, persist recipient using the Airbnb Owner Payout row label, and retain backward compatibility for unmarked rows. Manual input semantics (balance after import versus amount due before Castle payments) await the user response; no change made to that calculation yet. Actual supplied airbnb_.csv verified: payout 29104 cents, owner recipient, Castle collections zero, outstanding 2311 cents.
