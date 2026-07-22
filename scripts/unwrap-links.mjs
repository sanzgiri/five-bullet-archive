import { readFile, readdir, writeFile } from "node:fs/promises";
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

function unwrap(url) {
  if (typeof url !== "string") return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "click.fourhourmail.com") {
      const encoded = parsed.pathname.split("/").filter(Boolean).at(-1);
      return Buffer.from(encoded, "base64url").toString("utf8");
    }
    if (parsed.hostname.endsWith("safelinks.protection.outlook.com")) {
      return parsed.searchParams.get("url") ?? url;
    }
  } catch {
    return url;
  }
  return url;
}

let changed = 0;
for (const filename of await walk(root)) {
  const issue = JSON.parse(await readFile(filename, "utf8"));
  let dirty = false;
  for (const bullet of issue.bullets ?? []) {
    const original = unwrap(bullet.original_url);
    if (original !== bullet.original_url) {
      bullet.original_url = original;
      dirty = true;
    }
    for (const link of bullet.links ?? []) {
      const url = unwrap(link.url);
      if (url !== link.url) {
        link.url = url;
        dirty = true;
      }
    }
  }
  if (dirty) {
    await writeFile(filename, `${JSON.stringify(issue, null, 2)}\n`);
    changed += 1;
  }
}

console.log(`Unwrapped tracked links in ${changed} issue files`);
