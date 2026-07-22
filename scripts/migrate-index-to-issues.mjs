import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("data/newsletters");
const rows = (await readFile(path.join(root, "index.jsonl"), "utf8"))
  .split("\n")
  .filter(Boolean)
  .map(JSON.parse);
const sample = JSON.parse(await readFile(path.join(root, "sample-extraction.json"), "utf8"));

for (const row of rows) {
  const issueDate = row.issue_date ?? row.date;
  const year = issueDate.slice(0, 4);
  const directory = path.join(root, "issues", year);
  await mkdir(directory, { recursive: true });
  const detailed = sample.issue_date === issueDate ? sample : null;
  const bullets = (detailed?.bullets ?? []).map((bullet) => ({
    ...bullet,
    original_url: bullet.url,
    links: bullet.url ? [{ type: "original", url: bullet.url }] : [],
  })).map(({ url, ...bullet }) => bullet);
  const issue = {
    schema_version: 1,
    issue_date: issueDate,
    subject: detailed?.subject ?? row.subject,
    sources: row.sources ?? [row.source].filter(Boolean),
    status: row.status ?? "email",
    extraction_status: bullets.length ? "extracted" : "metadata_only",
    special_edition: Boolean(row.special_edition),
    bullets,
  };
  await writeFile(path.join(directory, `${issueDate}.json`), `${JSON.stringify(issue, null, 2)}\n`);
}

console.log(`Created ${rows.length} canonical dated issue files`);
