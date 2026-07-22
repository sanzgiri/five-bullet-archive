# 5-Bullet Friday archive

Portable newsletter inventory built from the authorized Gmail and Hotmail mailboxes.

- `issues/YYYY/YYYY-MM-DD.json` contains the canonical portable record for each newsletter date.
- `index.jsonl` is generated from the dated files for search and website builds.
- `schema.json` documents the portable issue format.
- `coverage.json` records coverage and candidate missing Fridays.
- `gap-audit.json` records the evidence used to fill or leave candidate dates unresolved.
- Mailbox message IDs, recipient addresses, and authorization data are intentionally excluded.
- `status: "email"` means at least one authorized mailbox contains the issue.

Full newsletter bodies are not committed by default. Each structured recommendation preserves Tim Ferriss's associated note verbatim, while sponsor copy, boilerplate, and unrelated footer text are excluded.

Records marked `extraction_status: "metadata_only"` confirm an issue date but do not yet contain recommendation bullets. Run `npm run archive:build` to validate every dated file and rebuild the index.

The public backfill currently targets July 3, 2015, the earliest contemporary evidence located so far. Public-source provenance is recorded in `public-sources.json`.
