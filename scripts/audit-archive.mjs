import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("data/newsletters/issues");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
  }
  return files;
}

const issues = await Promise.all(
  (await walk(root)).map(async (filename) => JSON.parse(await readFile(filename, "utf8"))),
);
const status = Object.groupBy(issues, (issue) => issue.extraction_status);
const report = {
  generated_at: new Date().toISOString(),
  total_issues: issues.length,
  extraction_status: Object.fromEntries(
    Object.entries(status).map(([key, values]) => [key, values.length]),
  ),
  total_bullets: issues.reduce((sum, issue) => sum + issue.bullets.length, 0),
  issues_requiring_review: issues
    .filter((issue) => issue.extraction_status !== "extracted")
    .map((issue) => issue.issue_date)
    .sort(),
};

console.log(JSON.stringify(report, null, 2));
