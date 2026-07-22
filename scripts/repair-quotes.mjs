import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { quoteText } from "./quote-text.mjs";

const issuesRoot = path.resolve("data/newsletters/issues");
let repaired = 0;

for (const year of await readdir(issuesRoot)) {
  const yearRoot = path.join(issuesRoot, year);
  for (const name of await readdir(yearRoot)) {
    if (!name.endsWith(".json")) continue;
    const filename = path.join(yearRoot, name);
    const issue = JSON.parse(await readFile(filename, "utf8"));
    let changed = false;

    for (const bullet of issue.bullets ?? []) {
      if (bullet.category !== "quote" || !bullet.title) continue;
      const title = quoteText(bullet.title);
      if (title === bullet.title) continue;
      bullet.title = title;
      bullet.creator = title.match(/[—–―-]\s*([^([]+)/)?.[1]?.trim() ?? bullet.creator ?? null;
      changed = true;
      repaired += 1;
    }

    if (changed) await writeFile(filename, `${JSON.stringify(issue, null, 2)}\n`);
  }
}

console.log(`Repaired ${repaired} quote records.`);
