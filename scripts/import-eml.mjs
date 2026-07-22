import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import TurndownService from "turndown";
import { quoteText } from "./quote-text.mjs";

const projectRoot = process.cwd();
const inputRoot = path.resolve(process.argv[2] ?? "imports/five-bullet-emails");
const archiveRoot = path.join(projectRoot, "data/newsletters");
const issuesRoot = path.join(archiveRoot, "issues");
const reportPath = path.join(archiveRoot, "eml-import-report.json");
const write = process.argv.includes("--write");
const force = process.argv.includes("--force");
const onlyPartial = process.argv.includes("--only-partial");
const quiet = process.argv.includes("--quiet");

const turndown = new TurndownService({
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
});
turndown.remove(["script", "style", "img"]);

function decodeQuotedPrintable(value) {
  const unfolded = value.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let index = 0; index < unfolded.length; index += 1) {
    if (unfolded[index] === "=" && /^[0-9a-f]{2}$/i.test(unfolded.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(unfolded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(unfolded.charCodeAt(index));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeHeader(value = "") {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]+)\?=/gi, (_, charset, encoding, payload) => {
    const buffer = encoding.toLowerCase() === "b"
      ? Buffer.from(payload, "base64")
      : Buffer.from(payload.replaceAll("_", " ").replace(/=([0-9a-f]{2})/gi, (match, hex) => String.fromCharCode(Number.parseInt(hex, 16))), "binary");
    return new TextDecoder(charset.toLowerCase() === "us-ascii" ? "utf-8" : charset).decode(buffer);
  });
}

function parseHeaders(value) {
  const headers = new Map();
  for (const line of value.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    headers.set(line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}

function decodeBody(body, encoding = "") {
  if (/base64/i.test(encoding)) return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
  if (/quoted-printable/i.test(encoding)) return decodeQuotedPrintable(body);
  return body;
}

function extractMimeContent(headers, body) {
  const contentType = headers.get("content-type") ?? "text/plain";
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean);
  if (boundary) {
    let html = null;
    let text = null;
    for (const rawPart of body.split(`--${boundary}`)) {
      const partSeparator = rawPart.search(/\r?\n\r?\n/);
      if (partSeparator < 0) continue;
      const partHeaders = parseHeaders(rawPart.slice(0, partSeparator));
      const partBody = rawPart.slice(partSeparator).replace(/^\r?\n\r?\n/, "").replace(/\r?\n$/, "");
      const part = extractMimeContent(partHeaders, partBody);
      html ??= part.html;
      text ??= part.text;
    }
    return { html, text };
  }
  const decoded = decodeBody(body, headers.get("content-transfer-encoding"));
  if (/text\/html/i.test(contentType)) return { html: decoded, text: null };
  if (/text\/plain/i.test(contentType)) return { html: null, text: decoded };
  return { html: null, text: null };
}

function parseEml(raw) {
  const separator = raw.search(/\r?\n\r?\n/);
  const headers = parseHeaders(raw.slice(0, separator));
  const body = raw.slice(separator).replace(/^\r?\n\r?\n/, "");
  const { html, text } = extractMimeContent(headers, body);
  return {
    subject: decodeHeader(headers.get("subject")),
    date: headers.get("date"),
    html,
    text,
  };
}

function unwrap(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "click.fourhourmail.com" || parsed.hostname.endsWith("fourhourmail.com") || parsed.hostname.endsWith("convertkit-mail.com") || parsed.hostname.endsWith("convertkit-mail2.com")) {
      const encoded = parsed.pathname.split("/").filter(Boolean).at(-1);
      const decoded = Buffer.from(encoded, "base64url").toString("utf8");
      if (/^(?:https?:\/\/|mailto:)/.test(decoded)) return decoded;
    }
    if (parsed.hostname.endsWith("safelinks.protection.outlook.com")) {
      const destination = parsed.searchParams.get("url");
      return destination ? unwrap(destination) : url;
    }
  } catch {
    return url;
  }
  return url;
}

function unwrapMarkdown(markdown) {
  return markdown.replace(/\]\((https?:\/\/[^)\s]+)\)/g, (_, url) => `](${unwrap(url)})`);
}

function plainText(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gs, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, "$1")
    .replace(/[\u200b-\u200d\u2060\u034f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedFriday(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.valueOf())) return null;
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const friday = new Date(`${local}T12:00:00Z`);
  const day = friday.getUTCDay();
  const subtract = day === 6 ? 1 : day === 0 ? 2 : day === 1 ? 3 : 0;
  friday.setUTCDate(friday.getUTCDate() - subtract);
  return friday.toISOString().slice(0, 10);
}

function categoryFor(section, originalUrl) {
  const value = section.toLowerCase();
  if (/song|music|album|track/.test(value)) return "music";
  if (/audiobook/.test(value)) return "audiobook";
  if (/article|blog post/.test(value)) return "article";
  if (/book/.test(value)) return "book";
  if (/reading/.test(value)) {
    return /amazon\.|bookshop\.|goodreads\.|audible\./i.test(originalUrl ?? "") ? "book" : "article";
  }
  if (/movie|film|documentary|watching|video|series|special/.test(value)) return "video";
  if (/quote|highlight/.test(value)) return "quote";
  if (/podcast|listening/.test(value)) return "podcast";
  if (/science|research/.test(value)) return "research";
  return "other";
}

function isNewsletter(subject, markdown) {
  return /(?:\d+-Bullet (?:Friday|Saturday|Sunday)|5-BF|Mega 5-Bullet)/i.test(subject)
    && /(?:weekly dose|weekly list|5-Bullet Friday)/i.test(markdown);
}

function extractSections(markdown) {
  const heading = /^##\s+(.+?)$/gm;
  const headings = [];
  let match;
  while ((match = heading.exec(markdown))) {
    headings.push({ section: plainText(match[1]), start: match.index, end: heading.lastIndex });
  }
  if (!headings.length) {
    const setextHeading = /^(.+)\n-{3,}\s*$/gm;
    while ((match = setextHeading.exec(markdown))) {
      headings.push({ section: plainText(match[1]), start: match.index, end: setextHeading.lastIndex });
    }
  }
  if (!headings.length) {
    // Outlook exports preserve the newsletter labels as bold text rather than
    // semantic headings. A bullet label consistently ends in an em dash.
    const labelStart = "(?:Longread|Person|Music|Purchase|Junk food|New tea|If you need|Genius video|Article|Short document|Blast from|Myth|Device|Tech shortcut|Study|Poem|Book|Quote|What I|Who I|In case)";
    const boldLabels = [new RegExp(`\\*\\*(${labelStart}[^*\\n]{0,135}?\\s+[—–-])`, "g")];
    for (const boldLabel of boldLabels) while ((match = boldLabel.exec(markdown))) {
      if (!headings.some((item) => Math.abs(item.start - match.index) < 5)) headings.push({ section: plainText(match[1]), start: match.index, end: boldLabel.lastIndex });
    }
    headings.sort((a, b) => a.start - b.start);
  }
  return headings
    .map((item, index) => ({
      section: item.section,
      body: markdown.slice(item.end, headings[index + 1]?.start ?? markdown.length)
        .split(/\n(?=(?:And, as always|Have a wonderful weekend|Have a wonderful|P\.S\.|FORWARDED THIS MESSAGE|Forwarded this message))/i)[0]
        .trim(),
    }))
    .filter(({ section }) => !/^(?:P\.S\.|Deal of the Week|Forwarded this message)/i.test(section));
}

function extractBullet(section, body, position) {
  const links = [...body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gs)]
    .map((match, index) => ({ label: plainText(match[1]), type: index ? "other" : "original", url: unwrap(match[2]) }));
  const category = categoryFor(section, links[0]?.url);
  const plain = plainText(body);
  let title = links[0]?.label ?? null;
  const firstLinkEnd = links[0] ? body.indexOf(")") + 1 : 0;
  const afterTitle = firstLinkEnd > 0 ? plainText(body.slice(firstLinkEnd)) : plain;
  let creator = afterTitle.match(/^[\s“”"'.,*]*(?:\([^)]*\)\s*)?(?:also\s+)?by\s+([^.!?(]{2,100})/i)?.[1]?.trim() ?? null;
  let note = body;
  if (links[0]) note = note.slice(firstLinkEnd);
  note = note.replace(/^\s*(?:[.”"'*_—-]+\s*)?(?:by\s+\[[^\]]+\]\([^)]+\)|by\s+[^.\n]+[.]?)?/i, "").trim();
  if (category === "quote") {
    title = quoteText(plain);
    creator = title.match(/[—–―-]\s*([^([]+)/)?.[1]?.trim() ?? creator;
    note = null;
  }
  return {
    position,
    section,
    category,
    title,
    creator,
    note: note || null,
    original_url: links[0]?.url ?? null,
    links: links.map(({ type, url }) => ({ type, url })),
  };
}

const names = (await readdir(inputRoot)).filter((name) => name.toLowerCase().endsWith(".eml")).sort();
const candidates = [];
const failures = [];
const filteredSubjects = [];

for (const [index, name] of names.entries()) {
  try {
    const message = parseEml(await readFile(path.join(inputRoot, name), "utf8"));
    const subject = message.subject?.trim() ?? "";
    const markdown = unwrapMarkdown(message.html ? turndown.turndown(message.html) : (message.text ?? ""));
    if (!isNewsletter(subject, markdown)) {
      filteredSubjects.push(subject || name);
      continue;
    }
    const issueDate = normalizedFriday(message.date);
    if (!issueDate) throw new Error("missing or invalid message date");
    const sections = extractSections(markdown);
    const bullets = sections.map(({ section, body }, bulletIndex) => extractBullet(section, body, bulletIndex + 1));
    const reasons = [];
    const advertisedCount = Number(subject.match(/^(\d+)-Bullet/i)?.[1]);
    const validCount = advertisedCount > 5 ? bullets.length === advertisedCount : /^(?:Mega 5-Bullet|5-Bullet Friday — Favorite Life Advice)/i.test(subject) ? bullets.length >= 2 : bullets.length >= 4 && bullets.length <= 12;
    if (!validCount) reasons.push(`${bullets.length} sections detected`);
    if (bullets.some((bullet) => !bullet.title)) reasons.push("one or more titles missing");
    if (/(?:fourhourmail|convertkit-mail|safelinks\.protection)/.test(JSON.stringify(bullets))) reasons.push("tracking URL remains");
    candidates.push({ issueDate, subject, bullets, reasons, file: name });
  } catch (error) {
    failures.push({ file: name, error: error.message });
  }
  if ((index + 1) % 50 === 0) process.stdout.write(`\rParsed ${index + 1}/${names.length} files...`);
}
process.stdout.write(`\rParsed ${names.length}/${names.length} files.   \n`);

const byDate = new Map();
for (const candidate of candidates) {
  const current = byDate.get(candidate.issueDate);
  if (!current || candidate.reasons.length < current.reasons.length) byDate.set(candidate.issueDate, candidate);
}

let existingDates = 0;
let newDates = 0;
let written = 0;
const review = [];
for (const candidate of [...byDate.values()].sort((a, b) => a.issueDate.localeCompare(b.issueDate))) {
  const filename = path.join(issuesRoot, candidate.issueDate.slice(0, 4), `${candidate.issueDate}.json`);
  let existing;
  try {
    existing = JSON.parse(await readFile(filename, "utf8"));
    existingDates += 1;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    newDates += 1;
  }
  if (candidate.reasons.length) review.push({ issue_date: candidate.issueDate, file: candidate.file, reasons: candidate.reasons });
  if (onlyPartial && existing?.extraction_status !== "partial") continue;
  if (!write || (existing?.extraction_status === "extracted" && !force)) continue;
  const issue = {
    schema_version: 1,
    issue_date: candidate.issueDate,
    subject: candidate.subject,
    sources: [...new Set([...(existing?.sources ?? []), "hotmail"])],
    status: "email",
    extraction_status: candidate.reasons.length ? "partial" : "extracted",
    special_edition: existing?.special_edition ?? !/^5-Bullet Friday\b/i.test(candidate.subject),
    bullets: candidate.bullets,
  };
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(issue, null, 2)}\n`);
  written += 1;
}

const dates = [...byDate.keys()].sort();
const report = {
  generated_at: new Date().toISOString(),
  input_directory: path.relative(projectRoot, inputRoot),
  eml_files: names.length,
  non_newsletter_messages: filteredSubjects.length,
  newsletter_messages: candidates.length,
  unique_newsletter_dates: dates.length,
  duplicate_newsletter_messages: candidates.length - dates.length,
  earliest_issue: dates[0] ?? null,
  latest_issue: dates.at(-1) ?? null,
  dates_already_in_archive: existingDates,
  new_dates: newDates,
  files_written: written,
  parse_failures: failures,
  review,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(quiet ? {
  eml_files: report.eml_files,
  newsletter_messages: report.newsletter_messages,
  unique_newsletter_dates: report.unique_newsletter_dates,
  earliest_issue: report.earliest_issue,
  latest_issue: report.latest_issue,
  dates_already_in_archive: report.dates_already_in_archive,
  new_dates: report.new_dates,
  files_written: report.files_written,
  parse_failures: report.parse_failures.length,
  issues_requiring_review: report.review.length,
} : report, null, 2));
if (!write) console.log("Audit only. Re-run with --write to update issue files.");
