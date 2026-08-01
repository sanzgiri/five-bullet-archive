# Five Bullet Index

A searchable, portable archive of recommendations from Tim Ferriss’s 5-Bullet Friday newsletter.

The published site is [five-bullet-index.sanzgiri.chatgpt.site](https://five-bullet-index.sanzgiri.chatgpt.site). It is a public, independent index of newsletter emails and is not affiliated with Tim Ferriss. The source repository is [sanzgiri/five-bullet-archive](https://github.com/sanzgiri/five-bullet-archive).

## What’s included

- 532 dated newsletter issues from 2015–2026
- 2,719 extracted recommendations, searchable by title, person, category, and year
- Verbatim associated notes where available
- Spotify discovery links for music, Amazon links for books, and JustWatch links for films and TV
- One portable JSON file per issue at `data/newsletters/issues/YYYY/YYYY-MM-DD.json`

`data/newsletters/index.jsonl` and `public/archive-data.json` are generated files. The latter is the compact client-side dataset used by the website.

## Data quality and quote handling

Each source issue keeps its source metadata and structured recommendation bullets. Mailbox message IDs, credentials, and full raw message bodies are excluded from Git.

Quotes receive extra cleanup because they are often the last newsletter section. `scripts/quote-text.mjs` removes newsletter footers, sharing prompts, and follow-on promotional copy before a quote is stored. The same logic is used by Gmail, Hotmail, and EML importers. `npm test` checks every quote record for known footer fragments.

## Local setup

Requires Node.js 22.13 or later.

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run archive:build       # validate issue JSON and rebuild generated datasets
npm run archive:audit       # audit coverage and extraction quality
npm run archive:enrich      # add/update service discovery links
npm run archive:import-eml -- imports/five-bullet-emails --write
npm test                    # production build plus archive regression tests
```

The EML importer is the operational update path for Outlook/Hotmail exports. It is safe to rerun: use `--force` only when intentionally replacing an existing dated issue. The Gmail JSON importer and the Microsoft Graph Hotmail extractor use the same structured format; see [data/newsletters/README.md](data/newsletters/README.md) for their details.

## Weekly update workflow

1. Export or add newly received 5-Bullet Friday messages as `.eml` files under `imports/five-bullet-emails/`.
2. Run the EML importer with `--write`.
3. Rebuild, audit, and test the archive.
4. Review the resulting dated JSON records, then commit and push the changed issue files and generated `public/archive-data.json`.
5. Publish a new Sites version from the exact pushed commit.

The weekly Codex maintenance automation runs on Saturday mornings, imports qualifying Outlook issues, validates the archive, and publishes the current pushed commit to the public Sites deployment after a successful test/build.

The scheduled maintenance task follows this workflow and reports failures instead of silently publishing an unverified issue.

## Deployment

The app is a Next.js/Vinext static archive deployed through OpenAI Sites. The Sites project ID is stored in `.openai/hosting.json`; it is not a Netlify, Render, Vercel, or Fly deployment.

Before publishing a release, run:

```bash
npm test
git diff --check
```

Then save and deploy a Sites version from the exact commit that was pushed to both GitHub and the Sites source repository.

## Known coverage gaps

The archive is an indexed reconstruction from received newsletter emails and public-source backfills; it is not a claim of complete publication history. The current audit marks these six dates as unresolved candidate Fridays with no confirmed full issue: 2018-01-19, 2018-09-21, 2019-03-29, 2021-10-01, 2021-12-31, and 2022-03-25. Seven older records remain flagged for review because they are metadata-only or partial: 2015-07-03, 2017-03-03, 2017-05-19, 2017-06-02, 2017-07-21, 2018-01-12, and 2019-03-15. See [data/newsletters/gap-audit.json](data/newsletters/gap-audit.json) for evidence and status.
