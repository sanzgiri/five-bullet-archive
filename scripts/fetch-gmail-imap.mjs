import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ImapFlow } from "imapflow";

const address = process.env.GMAIL_ADDRESS;
const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
const sender = process.env.NEWSLETTER_SENDER ?? "tim@fourhourbody.com";
const outputDirectory = process.env.GMAIL_IMPORT_DIR ?? ".cache/gmail-import";
const lookbackDays = Number(process.env.GMAIL_LOOKBACK_DAYS ?? 14);

if (!address || !appPassword) {
  throw new Error("Set GMAIL_ADDRESS and GMAIL_APP_PASSWORD to fetch newsletter messages from Gmail over IMAP.");
}
if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
  throw new Error("GMAIL_LOOKBACK_DAYS must be an integer between 1 and 90.");
}

const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: { user: address, pass: appPassword },
  logger: false,
});

await mkdir(outputDirectory, { recursive: true });
let fetched = 0;
const lock = await client.connect().then(() => client.getMailboxLock("INBOX"));
try {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  const uids = await client.search({ since, from: sender }, { uid: true });
  if (uids.length) {
    for await (const message of client.fetch(uids, { source: true }, { uid: true })) {
      if (!message.source) continue;
      const filename = path.join(outputDirectory, `gmail-${message.uid}.eml`);
      await writeFile(filename, message.source);
      fetched += 1;
    }
  }
} finally {
  lock.release();
  await client.logout();
}

console.log(`Downloaded ${fetched} recent message(s) from ${sender} to ${outputDirectory}.`);
