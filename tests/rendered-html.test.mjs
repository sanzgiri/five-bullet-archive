import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the finished archive shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Five Bullet Index/);
  assert.match(html, /A library of good ideas/);
  assert.match(html, /Search a title, person, idea/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("quote records do not contain newsletter footers", async () => {
  const issuesRoot = path.resolve("data/newsletters/issues");
  for (const year of await readdir(issuesRoot)) {
    for (const name of await readdir(path.join(issuesRoot, year))) {
      if (!name.endsWith(".json")) continue;
      const issue = JSON.parse(await readFile(path.join(issuesRoot, year, name), "utf8"));
      for (const bullet of issue.bullets ?? []) {
        if (bullet.category !== "quote") continue;
        assert.doesNotMatch(bullet.title ?? "", /Are you enjoying 5-Bullet|FORWARDED THIS MESSAGE|DUE TO VOLUME|Which bullet above/i, `${issue.date} quote includes footer text`);
      }
    }
  }
});
