import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("data/newsletters/issues");
const reportPath = path.resolve("data/newsletters/catalog-resolution-report.json");
const curatedOnly = process.argv.includes("--curated-only");
const resolveMusicBrainz = process.argv.includes("--musicbrainz");
const spotifyMatches = new Map([
  ["45|shinedown", { type: "spotify_track", url: "https://open.spotify.com/track/420JGkyLfLUZcgBHKiIK9v" }],
  ["love me or leave me|billie holiday", { type: "spotify_track", url: "https://open.spotify.com/track/3d8zTTGjJ3T6fh1RHTylkB" }],
  ["save me by damageplan|", { type: "spotify_track", url: "https://open.spotify.com/track/3VMoO0h3y7a8PBlJP1gZeq" }],
  ["a thousand kisses deep|leonard cohen", { type: "spotify_track", url: "https://open.spotify.com/track/1ReUenrzajxFqwCCfJv3EE" }],
  ["beats antique collide album|", { type: "spotify_track", url: "https://open.spotify.com/track/0Jk5J9HrDmCEKV7xYmaB6m", note: "Representative track recommended in the newsletter note: Beauty Beats." }],
  ["alan watts and superposition listen dream|", { type: "spotify_album", url: "https://open.spotify.com/album/4WER0jHByxYmFwXZgRL6Pk" }],
  ["julieta venegas eres para mi|", { type: "spotify_track", url: "https://open.spotify.com/track/32JziZKwTGzOPPkjzv10tg" }],
  ["chancha via circuito jardines ft lido pimienta|", { type: "spotify_track", url: "https://open.spotify.com/track/47cXnfnILbqGJFjAORgXy5" }],
  ["sabelo|bajofondo", { type: "spotify_track", url: "https://open.spotify.com/track/1FPx0zQMlGR8CbDZWfDfCQ" }],
  ["zitarrosa|bajofondo", { type: "spotify_track", url: "https://open.spotify.com/track/3LsIKnWBQhqjQ5TWNxJenK" }],
  ["hi ren|ren", { type: "spotify_album", url: "https://open.spotify.com/album/2wXIwZRV93MS5en0FQuDMA" }],
  ["le festin|", { type: "spotify_track", url: "https://open.spotify.com/track/3yShr5EC1pAAJcEOKj6h1R" }],
  ["i know what i know|paul simon", { type: "spotify_track", url: "https://open.spotify.com/track/1JLqsx00ZNdZeoSIvZyH4A" }],
  ["tres deseos sesiones de estudio en vivo|", { type: "spotify_track", url: "https://open.spotify.com/track/6O3BszmiYc6sbnbU7ua7Se" }],
]);

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

const norm = (value = "") => String(value ?? "").toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9]+/g, " ").trim();
const slug = (value = "") => norm(value).replace(/\s+/g, "-");
const cleanCreator = (value = "") => value.split(/,?\s+narrated by/i)[0].trim();
const serviceDomain = {
  amazon: /amazon\.com/,
  justwatch: /justwatch\.com/,
  spotify_track: /open\.spotify\.com\/(?:track|album)\//,
  spotify_album: /open\.spotify\.com\/album\//,
};
const hasExact = (bullet, type) => bullet.links.some((link) =>
  !link.search_fallback && (link.type === type || serviceDomain[type]?.test(link.url)),
);

function addExact(bullet, type, url, metadata) {
  if (bullet.links.some((link) => link.type === type && link.url === url)) return false;
  bullet.links.push({ type, url, ...metadata });
  return true;
}

function removeServiceLinks(bullet, types) {
  const before = bullet.links.length;
  bullet.links = bullet.links.filter((link) => !types.includes(link.type));
  return before - bullet.links.length;
}

function isbn10(isbns = []) {
  const isbn13 = isbns.find((value) => /^978\d{10}$/.test(value));
  if (isbn13) {
    const stem = isbn13.slice(3, 12);
    const total = [...stem].reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0);
    const check = (11 - total % 11) % 11;
    return `${stem}${check === 10 ? "X" : check}`;
  }
  return isbns.find((value) => /^\d{9}[\dX]$/.test(value)) ?? null;
}

function creatorFromNote(note = "") {
  const patterns = [
    /(?:authored|written|performed|composed) by\s+\[?([^\]\n(.]{3,80})/i,
    /(?:collection|book|novel|album|song)\s+(?:of\s+[^.]{0,40}\s+)?by\s+\[?([^\]\n(.]{3,80})/i,
    /^\s*\(([^)]+)\)\s*(?:--|—)/,
  ];
  for (const pattern of patterns) {
    const value = note.match(pattern)?.[1]?.replace(/\\_/g, "_").trim();
    if (value) return value;
  }
  return null;
}

async function openLibraryMatch(bullet) {
  const inferredCreator = cleanCreator(bullet.creator) || creatorFromNote(bullet.note);
  const params = new URLSearchParams({ title: bullet.title, limit: "10", fields: "key,title,author_name,isbn,language" });
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(`https://openlibrary.org/search.json?${params}`, {
      headers: { "User-Agent": "five-bullet-archive/0.1 (https://github.com/sanzgiri/five-bullet-archive)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok || ![429, 503].includes(response.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  if (!response.ok) return null;
  const wantedTitle = norm(bullet.title);
  const wantedCreator = norm(inferredCreator);
  const docs = (await response.json()).docs ?? [];
  const ranked = docs.map((doc) => {
    const title = norm(doc.title);
    const authors = norm((doc.author_name ?? []).join(" "));
    let score = title === wantedTitle ? 10 : (title.includes(wantedTitle) || wantedTitle.includes(title) ? 5 : 0);
    if (wantedCreator && (authors.includes(wantedCreator) || wantedCreator.includes(authors))) score += 5;
    if ((doc.language ?? []).includes("eng")) score += 1;
    if ((doc.isbn ?? []).some((value) => /^978/.test(value))) score += 1;
    return { doc, score };
  }).sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score < (wantedCreator ? 15 : 11)) return null;
  const id = isbn10(ranked[0].doc.isbn);
  return id ? { id, doc: ranked[0].doc } : null;
}

async function imdbMatch(bullet) {
  const queries = [bullet.category === "tv" && bullet.creator ? bullet.creator : bullet.title];
  const episodeOf = bullet.title.match(/episode of\s+(.+?)(?:\s*\(|$)/i)?.[1];
  const seasonTitle = bullet.title.split(/\s+(?:--|—)\s+Season\b/i)[0];
  const colonSeries = bullet.note?.match(/episode of\s+(?:the\s+)?\[?([^\].]{3,80})/i)?.[1];
  for (const value of [episodeOf, seasonTitle !== bullet.title ? seasonTitle : null, colonSeries]) if (value) queries.push(value);
  let match = null;
  for (const rawQuery of [...new Set(queries)]) {
    const query = rawQuery.replace(/\([^)]*(?:TED|HBO|S\d+E\d+)[^)]*\)/gi, "").replace(/^['\"“]|['\"”]$/g, "").trim();
    if (!query || query.length < 2) continue;
    const key = query.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const response = await fetch(`https://v2.sg.media-imdb.com/suggestion/x/${encodeURIComponent(key)}.json`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) continue;
    const candidates = ((await response.json()).d ?? []).filter((item) => ["movie", "tvSeries", "tvMiniSeries", "tvMovie"].includes(item.qid));
    match = candidates.find((item) => norm(item.l) === norm(query));
    if (match) break;
  }
  if (!match) return null;
  const kind = match.qid === "movie" || match.qid === "tvMovie" ? "movie" : "tv-show";
  const url = `https://www.justwatch.com/us/${kind}/${slug(match.l)}`;
  const page = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!page.ok) return null;
  const html = await page.text();
  const title = html.match(/<title>([^<]+)/i)?.[1] ?? "";
  if (!norm(title).includes(norm(match.l))) return null;
  return { url, title: match.l, year: match.y ?? null, imdb_id: match.id, kind };
}

async function musicBrainzMatch(bullet) {
  const dashParts = bullet.title.split(/\s+[—-]\s+/).map((part) => part.trim()).filter(Boolean);
  const title = (bullet.creator || dashParts.length < 2 ? bullet.title : dashParts.slice(1).join(" - "))
    .replace(/[“”"]/g, "").replace(/\s+by\s+.+$/i, "").replace(/\s+\(Album\)$/i, "").trim();
  const embeddedArtist = bullet.title.match(/\s+by\s+(.+)$/i)?.[1]?.trim();
  const artist = cleanCreator(bullet.creator) || embeddedArtist || creatorFromNote(bullet.note) || dashParts[0];
  if (!title || !artist) return null;
  const query = `recording:"${title.replace(/"/g, "")}" AND artist:"${artist.replace(/"/g, "")}"`;
  const params = new URLSearchParams({ query, fmt: "json", limit: "5" });
  const response = await fetch(`https://musicbrainz.org/ws/2/recording/?${params}`, {
    headers: { "User-Agent": "five-bullet-archive/0.1 (https://github.com/sanzgiri/five-bullet-archive)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const wantedTitle = norm(title);
  const wantedArtist = norm(artist);
  const recordings = (await response.json()).recordings ?? [];
  const match = recordings.find((recording) => {
    const artists = norm((recording["artist-credit"] ?? []).map((credit) => credit.name).join(" "));
    return recording.score >= 90 && norm(recording.title) === wantedTitle && artists.includes(wantedArtist);
  });
  if (!match) return null;
  return {
    url: `https://musicbrainz.org/recording/${match.id}`,
    title: match.title,
    creator: (match["artist-credit"] ?? []).map((credit) => credit.name).join(", "),
  };
}

const files = await walk(root);
const report = { generated_at: null, issues: files.length, reclassified_non_books: 0, reclassified_non_films: 0, reclassified_non_music: 0, removed_irrelevant_links: 0, spotify_exact_added: 0, musicbrainz_resolved: 0, amazon_exact_added: 0, justwatch_exact_added: 0, errors: 0 };
const bookQueue = [];
const filmQueue = [];
const musicQueue = [];
const changed = new Map();

for (const filename of files) {
  const issue = JSON.parse(await readFile(filename, "utf8"));
  for (const bullet of issue.bullets) {
    if (bullet.category === "music" && !hasExact(bullet, "spotify_track") && !hasExact(bullet, "spotify_album")) {
      const key = `${norm(bullet.title)}|${norm(bullet.creator)}`;
      const spotifyMatch = spotifyMatches.get(key);
      if (spotifyMatch && addExact(bullet, spotifyMatch.type, spotifyMatch.url, { catalog_match: "verified_title_creator", ...(spotifyMatch.note ? { match_note: spotifyMatch.note } : {}) })) {
        report.spotify_exact_added += 1;
        changed.set(filename, issue);
      }
    }
    if (bullet.category === "music" && !/\b(?:music|song|album|track|listening|lyrics)\b/i.test(bullet.section)) {
      bullet.category = "other";
      report.reclassified_non_music += 1;
      changed.set(filename, issue);
      continue;
    }
    if (resolveMusicBrainz && bullet.category === "music" && !hasExact(bullet, "spotify_track") && !hasExact(bullet, "spotify_album") && !bullet.links.some((link) => link.type === "musicbrainz")) musicQueue.push({ filename, issue, bullet });
    if (["book", "audiobook"].includes(bullet.category) && /(?:popular )?post on facebook/i.test(bullet.section)) {
      bullet.category = "other";
      report.reclassified_non_books += 1;
      changed.set(filename, issue);
      continue;
    }
    if (["book", "audiobook"].includes(bullet.category) && /\b(?:article|paper|study|thread|review|reviews|quote|excerpt|highlight|highlights|passage|puzzle|giveaway)\b/i.test(`${bullet.section} ${bullet.title}`)) {
      bullet.category = /quote|excerpt|highlight|passage/i.test(bullet.section) ? "quote" : "article";
      report.reclassified_non_books += 1;
      report.removed_irrelevant_links += removeServiceLinks(bullet, ["amazon", "audible", "libby", "worldcat"]);
      changed.set(filename, issue);
      continue;
    }
    if (["video", "tv"].includes(bullet.category) && !hasExact(bullet, "justwatch")) {
      const evidence = `${bullet.title} ${bullet.section} ${bullet.note ?? ""}`;
      const catalogMedia = /\b(?:movie|film|documentary|docuseries|series|season|episode|television|tv show|netflix|hbo)\b/i.test(evidence);
      if (!catalogMedia) {
        bullet.category = "web_video";
        report.reclassified_non_films += 1;
        report.removed_irrelevant_links += removeServiceLinks(bullet, ["justwatch", "kanopy"]);
        changed.set(filename, issue);
        continue;
      }
    }
    if (!curatedOnly && ["book", "audiobook"].includes(bullet.category) && !hasExact(bullet, "amazon")) bookQueue.push({ filename, issue, bullet });
    if (!curatedOnly && ["video", "tv"].includes(bullet.category) && !hasExact(bullet, "justwatch")) filmQueue.push({ filename, issue, bullet });
  }
}

async function consume(queue, resolver, apply) {
  while (queue.length) {
    const entry = queue.shift();
    try {
      const match = await resolver(entry.bullet);
      if (match && apply(entry.bullet, match)) changed.set(entry.filename, entry.issue);
    } catch { report.errors += 1; }
  }
}

await Promise.all([
  ...Array.from({ length: 1 }, () => consume(bookQueue, openLibraryMatch, (bullet, match) => {
    const added = addExact(bullet, "amazon", `https://www.amazon.com/dp/${match.id}`, {
      catalog_match: "openlibrary_exact_title_creator",
      catalog_title: match.doc.title,
      catalog_creator: (match.doc.author_name ?? []).join(", ") || null,
      isbn10: match.id,
    });
    if (added) report.amazon_exact_added += 1;
    return added;
  })),
  ...Array.from({ length: 6 }, () => consume(filmQueue, imdbMatch, (bullet, match) => {
    const added = addExact(bullet, "justwatch", match.url, {
      region: "US", catalog_match: "imdb_exact_title", catalog_title: match.title,
      catalog_year: match.year, imdb_id: match.imdb_id, media_kind: match.kind,
    });
    if (added) report.justwatch_exact_added += 1;
    return added;
  })),
]);

for (const entry of musicQueue) {
  try {
    const match = await musicBrainzMatch(entry.bullet);
    if (match && addExact(entry.bullet, "musicbrainz", match.url, {
      catalog_match: "musicbrainz_exact_title_artist", catalog_title: match.title, catalog_creator: match.creator,
    })) {
      const fallback = entry.bullet.links.find((link) => link.type === "spotify_track" && link.search_fallback);
      if (fallback) {
        fallback.url = `https://open.spotify.com/search/${encodeURIComponent(`${match.title} ${match.creator}`)}`;
        fallback.catalog_basis = "musicbrainz";
      }
      report.musicbrainz_resolved += 1;
      changed.set(entry.filename, entry.issue);
    }
  } catch { report.errors += 1; }
  await new Promise((resolve) => setTimeout(resolve, 1100));
}

await Promise.all([...changed].map(([filename, issue]) => writeFile(filename, `${JSON.stringify(issue, null, 2)}\n`)));
report.amazon_exact_total = 0;
report.justwatch_exact_total = 0;
report.spotify_exact_total = 0;
for (const filename of files) {
  const issue = JSON.parse(await readFile(filename, "utf8"));
  for (const bullet of issue.bullets) {
    if (hasExact(bullet, "amazon")) report.amazon_exact_total += 1;
    if (hasExact(bullet, "justwatch")) report.justwatch_exact_total += 1;
    if (bullet.links.some((link) => ["spotify_track", "spotify_album"].includes(link.type) && !link.search_fallback)) report.spotify_exact_total += 1;
  }
}
report.generated_at = new Date().toISOString();
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
