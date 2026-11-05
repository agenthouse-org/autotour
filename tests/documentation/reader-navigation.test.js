import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { generateDocumentation } from "../../src/documentation/generate.js";
import { buildContentsHtml, buildSearchIndex } from "../../src/documentation/reader.js";

function section(moduleId, heading, headingLevel, blocks) {
  return { moduleId, heading, headingLevel, dependencies: { views: ["Manual"] }, blocks };
}

const manual = [
  section("users", "Users", 1, [{ kind: "text", text: "People who use the product." }]),
  section("profile", "Profile", 2, [{ kind: "text", text: `${"Update the display name. ".repeat(80)}` }]),
  section("billing", "Billing", 2, [
    { kind: "text", text: "Review the account before the due date." },
    { kind: "screenshot", stepId: "open", sourceView: "Manual", timing: "after", alt: "Invoice list", caption: "Paid and open invoices." }
  ]),
  section("administration", "Administration", 1, [{ kind: "text", text: "People who configure the product." }])
];

test("contents follow heading depth and the search index includes captions and alt text", () => {
  const html = buildContentsHtml(manual);
  assert.match(html, /<a href="#users">Users<\/a><ol><li><a href="#profile">Profile<\/a>/);
  assert.match(html, /<a href="#billing">Billing<\/a><\/li><\/ol><\/li><li><a href="#administration">Administration<\/a>/);
  const index = buildSearchIndex(manual);
  const billing = index.find(item => item.id === "billing");
  assert.deepEqual(billing.path, ["Users", "Billing"]);
  assert.equal(billing.groupId, "users");
  assert.match(billing.text, /Paid and open invoices\./);
  assert.match(billing.text, /Invoice list/);
  assert.equal(index.find(item => item.id === "administration").groupId, "administration");
});

test("generated HTML nests the contents list and searches a chapter without another request", { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-reader-"));
  const captureDir = path.join(root, "capture");
  await mkdir(path.join(captureDir, "modules/billing/screenshots"), { recursive: true });
  await writeFile(path.join(captureDir, "modules/billing/screenshots/open.png"), "image");
  const walkthrough = {
    schemaVersion: 1,
    id: "manual",
    title: "Product manual",
    modules: manual.map(item => ({
      id: item.moduleId,
      title: item.heading,
      steps: [{ id: "open", action: "click" }],
      dependencies: { views: ["Manual"] },
      ...(item.moduleId === "billing" ? { assets: { screenshots: ["modules/billing/screenshots/open.png"] } } : {})
    }))
  };
  const spec = {
    schemaVersion: 1,
    walkthroughId: "manual",
    journey: walkthrough,
    dependencyMap: { schemaVersion: 1, rules: [] },
    targets: [{ kind: "html", path: "site/index.html" }],
    sections: manual
  };
  const walkthroughFile = path.join(captureDir, "walkthrough.json");
  await writeFile(walkthroughFile, JSON.stringify(walkthrough));
  await generateDocumentation({ spec, walkthrough, walkthroughFile, outputRoot: root });
  const file = path.join(root, "site/index.html");
  const html = await readFile(file, "utf8");
  const indexText = html.match(/<script type="application\/json" id="autotour-search-index">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(indexText, /</);
  assert.equal(JSON.parse(indexText).find(item => item.id === "billing").text.includes("open invoices."), true);
  assert.doesNotMatch(html, /<script[^>]+src=/);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
    const requests = [];
    page.on("request", request => requests.push(request.url()));
    await page.goto(pageFileUrl(file));
    const beforeSearch = requests.length;
    const nested = page.locator("nav[aria-label='Contents'] a[href='#users'] + ol a[href='#billing']");
    await assert.equal(await nested.count(), 1);
    await page.locator("nav[aria-label='Contents'] a[href='#profile']").click();
    assert.equal(new URL(page.url()).hash, "#profile");

    const search = page.getByLabel("Search this manual");
    await search.fill("open invoices");
    await page.getByRole("status").filter({ hasText: "1 chapter" }).waitFor();
    const result = page.getByRole("option", { name: /Users \/ Billing/ });
    await result.waitFor();
    assert.match(await result.innerHTML(), /<mark>open invoices<\/mark>/);
    assert.equal(await page.locator("#autotour-search-group-users").count(), 1);
    await search.press("ArrowDown");
    assert.equal(await result.getAttribute("aria-selected"), "true");
    await search.press("Enter");
    assert.equal(new URL(page.url()).hash, "#billing");
    const box = await page.locator("#billing").boundingBox();
    assert.ok(box.y >= 0 && box.y < 700);

    await search.fill("no-such-chapter");
    await page.getByRole("status").filter({ hasText: "No matching chapters." }).waitFor();
    assert.equal(await page.getByRole("option").count(), 0);
    assert.equal(requests.length, beforeSearch);
  } finally {
    await browser.close();
  }
});

test("a heading that looks like markup stays inside the search index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-reader-escape-"));
  const captureDir = path.join(root, "capture");
  const walkthrough = {
    schemaVersion: 1,
    id: "manual",
    title: "Product manual",
    modules: [{ id: "notes", steps: [], dependencies: { views: ["Manual"] } }]
  };
  const spec = {
    schemaVersion: 1,
    walkthroughId: "manual",
    journey: walkthrough,
    dependencyMap: { schemaVersion: 1, rules: [] },
    targets: [{ kind: "html", path: "index.html" }],
    sections: [section("notes", "A </script> chapter", 2, [{ kind: "text", text: "Keep this text." }])]
  };
  await generateDocumentation({ spec, walkthrough, walkthroughFile: path.join(captureDir, "walkthrough.json"), outputRoot: root });
  const html = await readFile(path.join(root, "index.html"), "utf8");
  const indexText = html.match(/<script type="application\/json" id="autotour-search-index">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(indexText)[0].heading, "A </script> chapter");
  assert.match(html, /<a href="#notes">A &lt;\/script&gt; chapter<\/a>/);
});

function pageFileUrl(file) {
  return `file://${file.replaceAll("\\", "/")}`;
}
