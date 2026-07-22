import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const issuesRoot = path.resolve("data/newsletters/issues");
const reportPath = path.resolve("data/newsletters/provenance-audit.json");

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

function provenance(sources = []) {
  if (sources.some((source) => /^(?:gmail|hotmail)$/i.test(source))) {
    return { tier: "email_primary", verbatim_confidence: "high" };
  }
  if (sources.some((source) => /^(?:tim\.blog)$/i.test(source))) {
    return { tier: "official_public", verbatim_confidence: "medium" };
  }
  return { tier: "secondary_public", verbatim_confidence: "low" };
}

const footerPattern = /(?:FORWARDED THIS MESSAGE|DUE TO VOLUME|To unsubscribe|mailing address|And, as always|Have (?:a wonderful|an amazing) weekend|send a tweet to @tferriss)/i;
const trackingPattern = /(?:convertkit-mail|click\.fourhourmail|safelinks\.protection\.outlook)/i;
const files = await walk(issuesRoot);
const issues = await Promise.all(files.map(async (filename) => JSON.parse(await readFile(filename, "utf8"))));
const findings = [];
const tiers = {};
const confidence = {};

for (const issue of issues) {
  const sourceInfo = provenance(issue.sources);
  tiers[sourceInfo.tier] = (tiers[sourceInfo.tier] ?? 0) + 1;
  confidence[sourceInfo.verbatim_confidence] = (confidence[sourceInfo.verbatim_confidence] ?? 0) + 1;
  const problems = [];
  if (!Array.isArray(issue.sources) || issue.sources.length === 0) problems.push("missing_source");
  if (issue.bullets.some((bullet, index) => bullet.position !== index + 1)) problems.push("nonsequential_positions");
  if (issue.bullets.some((bullet) => !bullet.title)) problems.push("missing_title");
  if (issue.bullets.some((bullet) => bullet.category !== "quote" && !bullet.note)) problems.push("missing_note");
  if (trackingPattern.test(JSON.stringify(issue.bullets))) problems.push("tracking_url");
  if (footerPattern.test(JSON.stringify(issue.bullets))) problems.push("footer_contamination");
  if (!issue.special_edition && /^5-Bullet Friday\b/i.test(issue.subject) && issue.bullets.length !== 5) {
    problems.push(`expected_5_found_${issue.bullets.length}`);
  }
  if (issue.extraction_status !== "extracted") problems.push(issue.extraction_status);
  if (problems.length) {
    findings.push({
      issue_date: issue.issue_date,
      sources: issue.sources,
      provenance_tier: sourceInfo.tier,
      verbatim_confidence: sourceInfo.verbatim_confidence,
      bullet_count: issue.bullets.length,
      findings: problems,
    });
  }
}

const report = {
  generated_at: new Date().toISOString(),
  total_issues: issues.length,
  total_bullets: issues.reduce((sum, issue) => sum + issue.bullets.length, 0),
  provenance_tiers: tiers,
  verbatim_confidence: confidence,
  issue_count_with_findings: findings.length,
  finding_counts: Object.fromEntries(
    [...new Set(findings.flatMap((finding) => finding.findings))]
      .sort()
      .map((name) => [name, findings.filter((finding) => finding.findings.includes(name)).length]),
  ),
  findings: findings.sort((a, b) => a.issue_date.localeCompare(b.issue_date)),
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, findings: undefined }, null, 2));
