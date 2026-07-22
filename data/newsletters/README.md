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

## Bulk Hotmail extraction

The local extractor uses Microsoft Graph's read-only delegated `Mail.Read` permission and device-code login. It never needs a password or client secret, does not commit its token cache, and does not save full message bodies or mailbox message IDs.

One-time Microsoft setup:

1. Open [Microsoft Entra](https://entra.microsoft.com/) and create an app registration.
2. Choose **Accounts in any organizational directory and personal Microsoft accounts**.
3. Under **Authentication**, enable **Allow public client flows**.
4. Under **API permissions**, add the Microsoft Graph delegated permission **Mail.Read**.
5. Copy the app's **Application (client) ID**.

Run a dry run first:

```bash
MICROSOFT_CLIENT_ID="<client-id>" npm run archive:extract-hotmail -- --dry-run
```

Then write the parsed records and rebuild the index:

```bash
MICROSOFT_CLIENT_ID="<client-id>" npm run archive:extract-hotmail
npm run archive:unwrap-links
npm run archive:build
npm run archive:audit
```

Useful options include `--start YYYY-MM-DD`, `--end YYYY-MM-DD`, and `--force`. Without `--force`, the extractor does not replace records already marked `extracted`. Machine-generated records are deliberately marked `partial` pending the quality review.

The public backfill currently targets July 3, 2015, the earliest contemporary evidence located so far. Public-source provenance is recorded in `public-sources.json`.
