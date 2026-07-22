import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("data/newsletters");
const issuesRoot = path.join(root, "issues");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

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

function validate(issue, filename) {
  const errors = [];
  if (!datePattern.test(issue.issue_date ?? "")) errors.push("invalid issue_date");
  if (path.basename(filename, ".json") !== issue.issue_date) errors.push("filename/date mismatch");
  if (!Array.isArray(issue.sources) || issue.sources.length === 0) errors.push("sources must be non-empty");
  if (!Array.isArray(issue.bullets)) errors.push("bullets must be an array");
  for (const [index, bullet] of (issue.bullets ?? []).entries()) {
    if (!Number.isInteger(bullet.position)) errors.push(`bullet ${index + 1}: invalid position`);
    if (!bullet.section || !bullet.category) errors.push(`bullet ${index + 1}: section/category required`);
    if (bullet.note != null && typeof bullet.note !== "string") errors.push(`bullet ${index + 1}: note must be string or null`);
    if (!Array.isArray(bullet.links)) errors.push(`bullet ${index + 1}: links must be an array`);
  }
  return errors;
}

await mkdir(issuesRoot, { recursive: true });
const files = await walk(issuesRoot);
const issues = [];
const failures = [];

for (const filename of files) {
  const issue = JSON.parse(await readFile(filename, "utf8"));
  const errors = validate(issue, filename);
  if (errors.length) failures.push(`${path.relative(root, filename)}: ${errors.join(", ")}`);
  issues.push(issue);
}

issues.sort((a, b) => a.issue_date.localeCompare(b.issue_date));
const duplicateDates = issues.filter((issue, index) => index && issue.issue_date === issues[index - 1].issue_date);
if (duplicateDates.length) failures.push(`duplicate dates: ${duplicateDates.map((x) => x.issue_date).join(", ")}`);
if (failures.length) throw new Error(`Archive validation failed:\n${failures.join("\n")}`);

const index = issues.map(({ bullets, ...metadata }) => ({
  ...metadata,
  bullet_count: bullets.length,
  path: `issues/${metadata.issue_date.slice(0, 4)}/${metadata.issue_date}.json`,
}));
await writeFile(path.join(root, "index.jsonl"), `${index.map((x) => JSON.stringify(x)).join("\n")}\n`);

const serviceTypes = new Set(["spotify_track", "spotify_album", "amazon", "justwatch"]);
const archiveData = issues.flatMap((issue) => issue.bullets.map((bullet) => ({
  id: `${issue.issue_date}-${bullet.position}`,
  date: issue.issue_date,
  section: bullet.section,
  category: bullet.category,
  title: bullet.title,
  creator: bullet.creator,
  note: bullet.note,
  links: bullet.links.filter((link) => link.type === "original" || serviceTypes.has(link.type)),
})));
await mkdir(path.resolve("public"), { recursive: true });
await writeFile(path.resolve("public/archive-data.json"), `${JSON.stringify(archiveData)}\n`);
console.log(`Validated ${issues.length} issues and rebuilt index.jsonl + archive-data.json`);
