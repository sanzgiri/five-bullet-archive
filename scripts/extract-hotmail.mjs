import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { PublicClientApplication } from "@azure/msal-node";
import TurndownService from "turndown";

const projectRoot = process.cwd();
const archiveRoot = path.join(projectRoot, "data/newsletters");
const issuesRoot = path.join(archiveRoot, "issues");
const cachePath = path.join(projectRoot, ".cache/microsoft-msal-cache.json");
const reportPath = path.join(archiveRoot, "extraction-report.json");
const clientId = process.env.MICROSOFT_CLIENT_ID;
const sender = process.env.NEWSLETTER_SENDER ?? "tim@fourhourbody.com";
const args = new Set(process.argv.slice(2));
const valueAfter = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const start = valueAfter("--start", "2015-01-01");
const end = valueAfter("--end", new Date().toISOString().slice(0, 10));
const dryRun = args.has("--dry-run");
const force = args.has("--force");

if (!clientId) {
  console.error(`
MICROSOFT_CLIENT_ID is required.

Create a Microsoft Entra app registration:
1. Open https://entra.microsoft.com/ and choose App registrations > New registration.
2. Select "Accounts in any organizational directory and personal Microsoft accounts."
3. Under Authentication, enable "Allow public client flows."
4. Under API permissions, add Microsoft Graph delegated permission Mail.Read.
5. Copy the Application (client) ID and run:

   MICROSOFT_CLIENT_ID="<client-id>" npm run archive:extract-hotmail

Do not create or paste a client secret. This command uses device-code login.
`.trim());
  process.exit(2);
}

await mkdir(path.dirname(cachePath), { recursive: true });
const cachePlugin = {
  beforeCacheAccess: async (context) => {
    try {
      context.tokenCache.deserialize(await readFile(cachePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  },
  afterCacheAccess: async (context) => {
    if (!context.cacheHasChanged) return;
    await writeFile(cachePath, context.tokenCache.serialize(), { mode: 0o600 });
    await chmod(cachePath, 0o600);
  },
};

const auth = new PublicClientApplication({
  auth: {
    clientId,
    authority: "https://login.microsoftonline.com/consumers",
  },
  cache: { cachePlugin },
});
const scopes = ["Mail.Read"];
const accounts = await auth.getTokenCache().getAllAccounts();
let token;
if (accounts.length) {
  try {
    token = await auth.acquireTokenSilent({ account: accounts[0], scopes });
  } catch {
    token = null;
  }
}
token ??= await auth.acquireTokenByDeviceCode({
  scopes,
  deviceCodeCallback: ({ message }) => console.log(message),
});
if (!token?.accessToken) throw new Error("Microsoft authentication did not return an access token.");

const turndown = new TurndownService({
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
});
turndown.remove(["script", "style", "img"]);

function unwrap(url) {
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

function unwrapMarkdown(markdown) {
  return markdown.replace(/\]\((https?:\/\/[^)\s]+)\)/g, (_, url) => `](${unwrap(url)})`);
}

function text(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gs, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, "$1")
    .replace(/[\u200b-\u200d\u2060\u034f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedFriday(receivedDateTime) {
  const date = new Date(receivedDateTime);
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

function categoryFor(section) {
  const value = section.toLowerCase();
  if (/song|music|album/.test(value)) return "music";
  if (/audiobook/.test(value)) return "audiobook";
  if (/book|reading/.test(value)) return "book";
  if (/movie|film|documentary|watching|video|series|special/.test(value)) return "video";
  if (/quote|highlight/.test(value)) return "quote";
  if (/podcast|listening/.test(value)) return "podcast";
  if (/article|blog post/.test(value)) return "article";
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
    headings.push({ section: text(match[1]), start: match.index, end: heading.lastIndex });
  }
  return headings
    .map((item, index) => ({
      section: item.section,
      body: markdown.slice(item.end, headings[index + 1]?.start ?? markdown.length).trim(),
    }))
    .filter(({ section }) => !/^(?:P\.S\.|Deal of the Week|Forwarded this message)/i.test(section));
}

function extractBullet(section, body, position) {
  const links = [...body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gs)]
    .map((match, index) => ({
      label: text(match[1]),
      type: index === 0 ? "original" : "other",
      url: unwrap(match[2]),
    }));
  const category = categoryFor(section);
  let title = links[0]?.label ?? null;
  let creator = null;
  const plain = text(body);
  const creatorMatch = plain.match(/\bby\s+([^.!?]{2,100})/i);
  if (creatorMatch) creator = creatorMatch[1].replace(/\s*\(.*/, "").trim();

  let note = body;
  if (links[0]) {
    const firstLinkEnd = note.indexOf(links[0].url) >= 0
      ? note.indexOf(links[0].url) + links[0].url.length + 1
      : note.indexOf(")") + 1;
    if (firstLinkEnd > 0) note = note.slice(firstLinkEnd);
  }
  note = note
    .replace(/^\s*(?:[.”"'*_—-]+\s*)?(?:by\s+\[[^\]]+\]\([^)]+\)|by\s+[^.\n]+[.]?)?/i, "")
    .trim();

  if (category === "quote") {
    title = plain;
    note = null;
    creator = plain.match(/—\s*([^([]+)/)?.[1]?.trim() ?? creator;
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

async function graphPages(initialUrl) {
  const messages = [];
  let url = initialUrl;
  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        Prefer: 'outlook.body-content-type="html"',
      },
    });
    if (!response.ok) throw new Error(`Graph request failed (${response.status}): ${await response.text()}`);
    const page = await response.json();
    messages.push(...page.value);
    url = page["@odata.nextLink"] ?? null;
    process.stdout.write(`\rDownloaded ${messages.length} candidate messages...`);
  }
  process.stdout.write("\n");
  return messages;
}

const filter = [
  `receivedDateTime ge ${start}T00:00:00Z`,
  `receivedDateTime lt ${end}T23:59:59Z`,
  `from/emailAddress/address eq '${sender.replaceAll("'", "''")}'`,
].join(" and ");
const params = new URLSearchParams({
  "$select": "subject,receivedDateTime,from,body",
  "$filter": filter,
  "$orderby": "receivedDateTime asc",
  "$top": "100",
});
const messages = await graphPages(`https://graph.microsoft.com/v1.0/me/messages?${params}`);
const byDate = new Map();
const review = [];

for (const message of messages) {
  const markdown = unwrapMarkdown(turndown.turndown(message.body?.content ?? ""));
  if (!isNewsletter(message.subject ?? "", markdown)) continue;
  const issueDate = normalizedFriday(message.receivedDateTime);
  if (byDate.has(issueDate)) continue;
  const sections = extractSections(markdown);
  const bullets = sections.map(({ section, body }, index) => extractBullet(section, body, index + 1));
  const reasons = [];
  if (bullets.length < 4) reasons.push(`only ${bullets.length} sections detected`);
  if (bullets.some((bullet) => !bullet.title)) reasons.push("one or more titles missing");
  if (bullets.some((bullet) => /click\.fourhourmail|safelinks\.protection/.test(JSON.stringify(bullet)))) {
    reasons.push("tracking URL remains");
  }
  if (sections.some(({ section }) => /^Quotes\b/i.test(section))) reasons.push("multi-quote section requires splitting");

  const filename = path.join(issuesRoot, issueDate.slice(0, 4), `${issueDate}.json`);
  let existing;
  try {
    existing = JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing?.extraction_status === "extracted" && !force) continue;
  const issue = {
    schema_version: 1,
    issue_date: issueDate,
    subject: message.subject,
    sources: [...new Set([...(existing?.sources ?? []), "hotmail"])],
    status: "email",
    extraction_status: "partial",
    special_edition: existing?.special_edition ?? !/^5-Bullet Friday\b/i.test(message.subject),
    bullets,
  };
  byDate.set(issueDate, { filename, issue });
  if (reasons.length) review.push({ issue_date: issueDate, reasons });
}

if (!dryRun) {
  for (const { filename, issue } of byDate.values()) {
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, `${JSON.stringify(issue, null, 2)}\n`);
  }
}
const report = {
  generated_at: new Date().toISOString(),
  range: { start, end },
  sender,
  dry_run: dryRun,
  messages_scanned: messages.length,
  issues_written: dryRun ? 0 : byDate.size,
  issues_parsed: byDate.size,
  review,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
