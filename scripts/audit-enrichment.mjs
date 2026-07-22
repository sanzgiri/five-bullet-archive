import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const issuesRoot = path.resolve("data/newsletters/issues");
const reportPath = path.resolve("data/newsletters/enrichment-audit.json");

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

const services = {
  spotify: { categories: ["music"], types: ["spotify_track", "spotify_album"], domain: /open\.spotify\.com/ },
  amazon: { categories: ["book", "audiobook"], types: ["amazon"], domain: /amazon\.com/ },
  justwatch: { categories: ["video", "tv"], types: ["justwatch"], domain: /justwatch\.com/ },
};

const bullets = [];
for (const filename of await walk(issuesRoot)) {
  const issue = JSON.parse(await readFile(filename, "utf8"));
  for (const bullet of issue.bullets) bullets.push({ issue_date: issue.issue_date, ...bullet });
}

function matches(link, service) {
  return service.types.includes(link.type) || service.domain.test(link.url);
}

const byService = {};
const unresolved = [];
let totalSlots = 0;
let coveredSlots = 0;
let exactSlots = 0;
let fallbackSlots = 0;

for (const [name, service] of Object.entries(services)) {
  const eligible = bullets.filter((bullet) => bullet.title && service.categories.includes(bullet.category));
  const summary = { eligible: eligible.length, covered: 0, exact_or_resolved: 0, search_fallback: 0, missing: 0, coverage_percent: 0 };
  for (const bullet of eligible) {
    const links = bullet.links.filter((link) => matches(link, service));
    if (links.length) {
      summary.covered += 1;
      if (links.some((link) => !link.search_fallback)) summary.exact_or_resolved += 1;
      else summary.search_fallback += 1;
    } else {
      summary.missing += 1;
      unresolved.push({ issue_date: bullet.issue_date, position: bullet.position, category: bullet.category, title: bullet.title, creator: bullet.creator, missing_service: name });
    }
  }
  summary.coverage_percent = Number((summary.covered / summary.eligible * 100).toFixed(1));
  byService[name] = summary;
  totalSlots += summary.eligible;
  coveredSlots += summary.covered;
  exactSlots += summary.exact_or_resolved;
  fallbackSlots += summary.search_fallback;
}

const enrichedCategories = new Set(Object.values(services).flatMap((service) => service.categories));
const eligibleRecommendations = bullets.filter((bullet) => bullet.title && enrichedCategories.has(bullet.category));
const recommendationsWithEnrichment = eligibleRecommendations.filter((bullet) =>
  bullet.links.some((link) => Object.values(services).some((service) => matches(link, service))),
);
const excludedMissingTitle = bullets
  .filter((bullet) => !bullet.title && enrichedCategories.has(bullet.category))
  .map((bullet) => ({ issue_date: bullet.issue_date, position: bullet.position, category: bullet.category, section: bullet.section }));

function hasExactService(bullet, name) {
  const service = services[name];
  return bullet.links.some((link) => matches(link, service) && !link.search_fallback);
}

const musicRecommendations = eligibleRecommendations.filter((bullet) => bullet.category === "music");
const bookRecommendations = eligibleRecommendations.filter((bullet) => ["book", "audiobook"].includes(bullet.category));
const filmRecommendations = eligibleRecommendations.filter((bullet) => ["video", "tv"].includes(bullet.category));
const mapped = (items, predicate) => items.filter(predicate).length;
const metric = (covered, eligible) => ({ covered, eligible, percent: Number((covered / eligible * 100).toFixed(1)) });
const spotifyMapped = mapped(musicRecommendations, (bullet) => hasExactService(bullet, "spotify"));
const amazonMapped = mapped(bookRecommendations, (bullet) => hasExactService(bullet, "amazon"));
const justwatchMapped = mapped(filmRecommendations, (bullet) => hasExactService(bullet, "justwatch"));

const report = {
  generated_at: new Date().toISOString(),
  methodology: {
    recommendation_coverage: "Eligible recommendations with at least one enrichment destination.",
    service_slot_coverage: "Covered destination slots divided by all expected category/service combinations.",
    exact_or_resolved: "A direct publisher/service item URL already present in the source or verified by a catalog resolver.",
    search_fallback: "A service search URL generated from the extracted title and creator; useful but not an exact item match.",
  },
  exact_item_mapping_coverage: {
    note: "Search fallbacks are excluded from every metric in this section.",
    music_to_spotify: metric(spotifyMapped, musicRecommendations.length),
    books_to_amazon: metric(amazonMapped, bookRecommendations.length),
    films_to_justwatch: metric(justwatchMapped, filmRecommendations.length),
  },
  recommendation_coverage: {
    eligible: eligibleRecommendations.length,
    covered: recommendationsWithEnrichment.length,
    percent: Number((recommendationsWithEnrichment.length / eligibleRecommendations.length * 100).toFixed(1)),
  },
  service_slot_coverage: {
    eligible: totalSlots,
    covered: coveredSlots,
    missing: totalSlots - coveredSlots,
    percent: Number((coveredSlots / totalSlots * 100).toFixed(1)),
    exact_or_resolved: exactSlots,
    exact_or_resolved_percent: Number((exactSlots / totalSlots * 100).toFixed(1)),
    search_fallback: fallbackSlots,
    search_fallback_percent: Number((fallbackSlots / totalSlots * 100).toFixed(1)),
  },
  by_service: byService,
  unresolved,
  excluded_missing_title: excludedMissingTitle,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, unresolved: `${unresolved.length} records`, excluded_missing_title: `${excludedMissingTitle.length} records` }, null, 2));
