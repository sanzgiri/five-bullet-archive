import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const issuesRoot = path.resolve("data/newsletters/issues");
const reportPath = path.resolve("data/newsletters/enrichment-report.json");
const resolveLibby = process.argv.includes("--resolve-libby");
const refreshLibby = process.argv.includes("--refresh-libby");
const libraryKey = process.env.LIBBY_LIBRARY_KEY || "lapl";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
  }
  return files;
}

function queryFor(bullet) {
  return [bullet.title, bullet.creator].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function normalized(value = "") {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function domainType(url) {
  let hostname;
  try { hostname = new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
  if (hostname === "open.spotify.com") return /\/album\//.test(url) ? "spotify_album" : "spotify_track";
  if (hostname.endsWith("amazon.com")) return "amazon";
  if (hostname.endsWith("audible.com")) return "audible";
  if (hostname.endsWith("libbyapp.com")) return "libby";
  if (hostname.endsWith("worldcat.org")) return "worldcat";
  if (hostname.endsWith("justwatch.com")) return "justwatch";
  if (hostname.endsWith("kanopy.com")) return "kanopy";
  if (/netflix\.com$|hulu\.com$|max\.com$|disneyplus\.com$|paramountplus\.com$|peacocktv\.com$/.test(hostname)) return "streaming";
  return null;
}

function hasDomain(links, pattern) {
  return links.some(({ url }) => pattern.test(url));
}

function add(links, type, url, extra = {}) {
  if (!links.some((link) => link.type === type && link.url === url)) links.push({ type, url, ...extra });
}

async function libbyMatch(bullet) {
  const query = queryFor(bullet);
  if (!query) return null;
  const endpoint = `https://thunder.api.overdrive.com/v2/libraries/${libraryKey}/media?query=${encodeURIComponent(query)}&limit=10`;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const payload = await response.json();
    const wantedTitle = normalized(bullet.title);
    const wantedCreator = normalized(bullet.creator);
    const candidates = (payload.items ?? []).map((item) => {
      const itemTitle = normalized(item.title);
      const creators = normalized((item.creators ?? []).map((creator) => creator.name).join(" "));
      let score = itemTitle === wantedTitle ? 10 : itemTitle.includes(wantedTitle) || wantedTitle.includes(itemTitle) ? 6 : 0;
      if (wantedCreator && creators.includes(wantedCreator)) score += 4;
      if (bullet.category === "audiobook" && item.type?.id === "audiobook") score += 2;
      if (bullet.category === "book" && item.type?.id === "ebook") score += 1;
      return { item, score };
    }).sort((a, b) => b.score - a.score);
    if (!candidates[0] || candidates[0].score < 10) return null;
    const match = candidates[0].item;
    return {
      url: `https://share.libbyapp.com/title/${match.id}`,
      title: match.title,
      creator: (match.creators ?? []).map((creator) => creator.name).join(", ") || null,
    };
  } catch {
    return null;
  }
}

const files = await walk(issuesRoot);
const stats = { issues: files.length, bullets: 0, links_added: {}, links_reclassified: {}, libby_resolved: 0, libby_unresolved: 0 };
const libbyQueue = [];
const libbyChanged = new Map();

for (const filename of files) {
  const issue = JSON.parse(await readFile(filename, "utf8"));
  let changed = false;
  for (const bullet of issue.bullets) {
    stats.bullets += 1;
    const query = queryFor(bullet);
    if (!query) continue;
    if (refreshLibby) {
      const retained = bullet.links.filter((link) => !(link.type === "libby" && link.catalog_match));
      if (retained.length !== bullet.links.length) {
        bullet.links = retained;
        changed = true;
      }
    }
    for (const link of bullet.links) {
      const detected = domainType(link.url);
      if (link.type === "other" && detected) {
        link.type = detected;
        stats.links_reclassified[detected] = (stats.links_reclassified[detected] ?? 0) + 1;
        changed = true;
      }
    }
    const before = bullet.links.length;
    if (bullet.category === "music" && !hasDomain(bullet.links, /open\.spotify\.com/)) {
      add(bullet.links, "spotify_track", `https://open.spotify.com/search/${encodeURIComponent(query)}`, { search_fallback: true });
    }
    if (["book", "audiobook"].includes(bullet.category)) {
      if (!hasDomain(bullet.links, /amazon\.com/)) add(bullet.links, "amazon", `https://www.amazon.com/s?k=${encodeURIComponent(query)}`, { search_fallback: true });
      if (!hasDomain(bullet.links, /worldcat\.org/)) add(bullet.links, "worldcat", `https://search.worldcat.org/search?q=${encodeURIComponent(query)}`, { search_fallback: true });
      if (bullet.category === "audiobook" && !hasDomain(bullet.links, /audible\.com/)) add(bullet.links, "audible", `https://www.audible.com/search?keywords=${encodeURIComponent(query)}`, { search_fallback: true });
      if (resolveLibby && !hasDomain(bullet.links, /libbyapp\.com/)) libbyQueue.push({ filename, issue, bullet });
    }
    if (["video", "tv"].includes(bullet.category)) {
      if (!hasDomain(bullet.links, /justwatch\.com/)) add(bullet.links, "justwatch", `https://www.justwatch.com/us/search?q=${encodeURIComponent(query)}`, { region: "US", search_fallback: true });
      if (!hasDomain(bullet.links, /kanopy\.com/)) add(bullet.links, "kanopy", `https://www.kanopy.com/en/search?query=${encodeURIComponent(query)}`, { region: "US", requires_participating_library: true, search_fallback: true });
    }
    for (const link of bullet.links.slice(before)) stats.links_added[link.type] = (stats.links_added[link.type] ?? 0) + 1;
    if (bullet.links.length !== before) changed = true;
  }
  if (changed) await writeFile(filename, `${JSON.stringify(issue, null, 2)}\n`);
}

async function worker() {
  while (libbyQueue.length) {
    const { filename, issue, bullet } = libbyQueue.shift();
    const match = await libbyMatch(bullet);
    if (match) {
      add(bullet.links, "libby", match.url, {
        requires_participating_library: true,
        catalog_match: "exact_normalized_title",
        catalog_title: match.title,
        catalog_creator: match.creator,
      });
      stats.libby_resolved += 1;
      stats.links_added.libby = (stats.links_added.libby ?? 0) + 1;
      libbyChanged.set(filename, issue);
    } else {
      stats.libby_unresolved += 1;
    }
  }
}

if (resolveLibby) {
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  await Promise.all([...libbyChanged].map(([filename, issue]) => writeFile(filename, `${JSON.stringify(issue, null, 2)}\n`)));
}
stats.link_totals = {};
stats.search_fallback_totals = {};
for (const filename of files) {
  const issue = JSON.parse(await readFile(filename, "utf8"));
  for (const bullet of issue.bullets) {
    for (const link of bullet.links) {
      stats.link_totals[link.type] = (stats.link_totals[link.type] ?? 0) + 1;
      if (link.search_fallback) stats.search_fallback_totals[link.type] = (stats.search_fallback_totals[link.type] ?? 0) + 1;
    }
  }
}
stats.generated_at = new Date().toISOString();
stats.libby_library_key_used_for_catalog_resolution = resolveLibby ? libraryKey : null;
await writeFile(reportPath, `${JSON.stringify(stats, null, 2)}\n`);
console.log(JSON.stringify(stats, null, 2));
