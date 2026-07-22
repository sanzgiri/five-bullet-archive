import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const issuesRoot = path.join(root, "data/newsletters/issues");
const reportPath = path.join(root, "data/newsletters/gmail-import-report.json");

let input = process.argv[2] ? await readFile(process.argv[2], "utf8") : "";
if (!process.argv[2]) for await (const chunk of process.stdin) input += chunk;
const messages = JSON.parse(input);

function plainText(markdown = "") {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gs, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, "$1")
    .replace(/[\u200b-\u200d\u2060\u034f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrap(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "click.fourhourmail.com" || parsed.hostname.endsWith("convertkit-mail2.com")) {
      const encoded = parsed.pathname.split("/").filter(Boolean).at(-1);
      const decoded = Buffer.from(encoded, "base64url").toString("utf8");
      if (/^https?:\/\//.test(decoded)) return decoded;
    }
    if (parsed.hostname.endsWith("safelinks.protection.outlook.com")) {
      const destination = parsed.searchParams.get("url");
      return destination ? unwrap(destination) : url;
    }
  } catch {}
  return url;
}

function unwrapMarkdown(markdown) {
  return markdown.replace(/\]\((https?:\/\/[^)\s]+)\)/g, (_, url) => `](${unwrap(url)})`);
}

function friday(dateValue) {
  const date = new Date(`${dateValue}${/Z|[+-]\d\d:?\d\d$/.test(dateValue) ? "" : "Z"}`);
  if (Number.isNaN(date.valueOf())) return null;
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 6 ? 1 : day === 0 ? 2 : day === 1 ? 3 : 0));
  return date.toISOString().slice(0, 10);
}

function categoryFor(section, url) {
  const value = section.toLowerCase();
  if (/song|music|album|track/.test(value)) return "music";
  if (/audiobook/.test(value)) return "audiobook";
  if (/article|blog post/.test(value)) return "article";
  if (/book/.test(value)) return "book";
  if (/reading/.test(value)) return /amazon\.|bookshop\.|goodreads\.|audible\./i.test(url ?? "") ? "book" : "article";
  if (/movie|film|documentary|watching|video|series|special/.test(value)) return "video";
  if (/quote|highlight/.test(value)) return "quote";
  if (/podcast|listening/.test(value)) return "podcast";
  if (/science|research/.test(value)) return "research";
  return "other";
}

function sections(markdown) {
  const headings = [];
  const patterns = [
    /^#{1,3}\s+(.{3,140}?\s+—)\s*$/gm,
    /^\*\*(.{3,140}?\s+—)\*\*\s*$/gm,
    /^(.{3,140}?\s+—)\s*$/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(markdown))) headings.push({ section: plainText(match[1]), start: match.index, end: pattern.lastIndex });
    if (headings.length) break;
  }
  headings.sort((a, b) => a.start - b.start);
  return headings.map((heading, index) => {
    let body = markdown.slice(heading.end, headings[index + 1]?.start ?? markdown.length).trim();
    body = body.split(/\n(?=(?:And, as always|Have a wonderful weekend|Have an amazing weekend|P\.S\.|Want to hear more|This email was sent to))/i)[0].trim();
    return { section: heading.section, body };
  }).filter(({ section }) => !/^(?:P\.S\.|Deal of the Week|Forwarded this message)/i.test(section));
}

function bullet(section, body, position) {
  const links = [...body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gs)]
    .map((match, index) => ({ label: plainText(match[1]), type: index ? "other" : "original", url: unwrap(match[2]) }));
  const category = categoryFor(section, links[0]?.url);
  const plain = plainText(body);
  let title = links[0]?.label ?? null;
  const firstLink = links[0] ? body.indexOf(")") + 1 : 0;
  const afterTitle = firstLink ? plainText(body.slice(firstLink)) : plain;
  let creator = afterTitle.match(/^[\s“”"'.,*]*(?:\([^)]*\)\s*)?(?:also\s+)?by\s+([^.!?(]{2,100})/i)?.[1]?.trim() ?? null;
  let note = firstLink ? body.slice(firstLink) : body;
  note = note.replace(/^\s*(?:[.”"'*_—-]+\s*)?(?:by\s+\[[^\]]+\]\([^)]+\)|by\s+[^.\n]+[.]?)?/i, "").trim();
  if (category === "quote") {
    title = plain;
    creator = plain.match(/—\s*([^([]+)/)?.[1]?.trim() ?? creator;
    note = null;
  }
  return { position, section, category, title, creator, note: note || null, original_url: links[0]?.url ?? null, links: links.map(({ type, url }) => ({ type, url })) };
}

const imported = [];
const review = [];
for (const message of messages) {
  const issueDate = message.issue_date ?? friday(message.email_ts);
  if (!issueDate) throw new Error(`Invalid date for Gmail message ${message.id}`);
  // Some historical Gmail sync bodies omit a newline between a link and the
  // next section/footer even though the rendered email shows a paragraph break.
  const markdown = unwrapMarkdown(message.body ?? "")
    .replace(/\)(?=[A-Z][^\n]{2,100}\s+—)/g, ")\n")
    .replace(/\)(?=(?:And, as always|Have a wonderful weekend|Have an amazing weekend))/g, ")\n");
  const bullets = sections(markdown).map(({ section, body }, index) => bullet(section, body, index + 1));
  const reasons = [];
  if (bullets.length < 4 || bullets.length > 12) reasons.push(`${bullets.length} sections detected`);
  if (bullets.some((item) => !item.title)) reasons.push("one or more titles missing");
  if (/convertkit-mail2|click\.fourhourmail|safelinks\.protection/.test(JSON.stringify(bullets))) reasons.push("tracking URL remains");
  const filename = path.join(issuesRoot, issueDate.slice(0, 4), `${issueDate}.json`);
  let existing = {};
  try { existing = JSON.parse(await readFile(filename, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const issue = {
    schema_version: 1,
    issue_date: issueDate,
    subject: message.subject,
    sources: [...new Set([...(existing.sources ?? []), "gmail"])],
    status: "email",
    extraction_status: reasons.length ? "partial" : "extracted",
    special_edition: existing.special_edition ?? !/^5-Bullet Friday\b/i.test(message.subject),
    bullets,
  };
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(issue, null, 2)}\n`);
  imported.push({ issue_date: issueDate, gmail_message_id: message.id, bullets: bullets.length, extraction_status: issue.extraction_status });
  if (reasons.length) review.push({ issue_date: issueDate, reasons });
}

const report = { generated_at: new Date().toISOString(), messages: messages.length, imported, review };
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
