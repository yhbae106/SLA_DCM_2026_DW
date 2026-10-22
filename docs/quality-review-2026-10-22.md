# Dashboard quality review — 2026-10-22

- Honor the configured 30-second poll instead of forcing 12 seconds (60% fewer scheduled revision requests when continuously active). Coalesce requests and back off to at most five minutes after failures. Hidden/offline checks do not fetch; foreground checks use revisions.
- Read-only needs/change tables initially render 60 rows, with a more button. Total counts and full CSV exports are unchanged. Changing the scope resets paging; missing previous periods cannot show stale rows.
- Table line spacing, keyboard-accessible scroll regions, visible focus, reduced motion and mobile input sizes improved.
- Validation: `node tests/harness.mjs`, pagination and polling behavior tests; browser 60 → 120 displayed rows from 243 needs.

## Verification and limits

- Repository regression harness passes, including existing save, scope, totals and draft-protection scenarios.
- Added behavioral checks for polling coalescing, hidden/offline suppression, backoff and revision changes.
- Browser preview checked for the public pages; authenticated production writes were not exercised.
- Existing local drafts, pending edits, remembered-code opt-in and verified data fallback are retained.
- No backend Apps Script changes or data migrations.
