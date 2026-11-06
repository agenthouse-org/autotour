import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { chromium } from "playwright";
import { generateDocumentation } from "../../src/documentation/generate.js";

function section(moduleId, heading, headingLevel, blocks) {
  return { moduleId, heading, headingLevel, dependencies: { views: ["Manual"] }, blocks };
}

const sections = [
  section("users", "Users", 1, [{ kind: "text", text: "People who use the product." }]),
  section("profile", "Profile", 2, [{ kind: "text", text: `${"Update the display name. ".repeat(80)}Enter the Straße too.` }]),
  section("billing", "Billing", 2, [
    { kind: "screenshot", stepId: "open", sourceView: "Manual", timing: "after", alt: "Invoice list", caption: "Paid and open invoices." },
    { kind: "text", text: "Review the account before the due date.\n\n### Reminders\n\nReminders go out weekly." }
  ]),
  section("administration", "Administration", 1, [{ kind: "text", text: "People who configure the product." }])
];

let browserPromise;
const browser = () => (browserPromise ??= chromium.launch({ headless: true }));
after(async () => { if (browserPromise) await (await browserPromise).close(); });

let pngCache;
async function png() {
  if (pngCache) return pngCache;
  const page = await (await browser()).newPage({ viewport: { width: 640, height: 400 } });
  try {
    await page.setContent(`<body style="margin:0;background:linear-gradient(90deg,#1f5fbf,#f4f5f7)"><h1 style="font:40px system-ui;padding:40px">Invoices</h1></body>`);
    pngCache = await page.screenshot({ type: "png" });
    return pngCache;
  } finally {
    await page.close();
  }
}

async function manual(overrides = {}, { language, mode = "site", files = {}, draft = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-reader-"));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
  const captureDir = path.join(root, "capture");
  await mkdir(path.join(captureDir, "modules/billing/screenshots"), { recursive: true });
  await writeFile(path.join(captureDir, "modules/billing/screenshots/open.png"), await png());
  const list = overrides.sections ?? sections;
  const walkthrough = {
    schemaVersion: 1,
    id: "manual",
    title: "Product manual",
    modules: list.map(item => ({
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
    targets: [{ kind: "html", path: "site/index.html", mode }],
    ...(language ? { language } : {}),
    navigation: "sidebar",
    ...overrides,
    sections: list
  };
  const walkthroughFile = path.join(captureDir, "walkthrough.json");
  await writeFile(walkthroughFile, JSON.stringify(walkthrough));
  const specPath = path.join(root, "documentation.json");
  await writeFile(specPath, JSON.stringify(spec));
  const result = await generateDocumentation({ spec, specPath, walkthrough, walkthroughFile, outputRoot: root, draft });
  const file = path.join(root, "site/index.html");
  return { root, file, html: await readFile(file, "utf8"), result, specPath };
}

async function withPage(file, run, viewport = { width: 1100, height: 700 }) {
  const context = await (await browser()).newContext({ viewport });
  try {
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on("request", request => requests.push(request.url()));
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`file://${file.replaceAll("\\", "/")}`);
    await run(page, requests);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

test("contents follow heading depth and keep markup-like headings as text", async () => {
  const { html } = await manual();
  assert.match(html, /<a href="#users">Users<\/a><ol><li><a href="#profile">Profile<\/a>/);
  assert.match(html, /<a href="#billing">Billing<\/a><\/li><\/ol><\/li><li><a href="#administration">Administration<\/a>/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  const escaped = await manual({ sections: [section("notes", "A </script> chapter", 2, [{ kind: "text", text: "Keep this text." }])] });
  assert.match(escaped.html, /<a href="#notes">A &lt;\/script&gt; chapter<\/a>/);
});

test("search matches every word, folds accents and ß, marks hits and replaces the contents", async () => {
  const { file } = await manual();
  await withPage(file, async (page, requests) => {
    const before = requests.length;
    const search = page.getByLabel("Search this manual");
    const contents = page.locator("nav.autotour-contents");
    await search.fill("open invoices");
    await page.getByRole("status").filter({ hasText: "1 result" }).waitFor();
    const result = page.locator("#autotour-search-results a").first();
    assert.equal(await result.getAttribute("href"), "#billing");
    assert.match(await result.innerHTML(), /<mark>open<\/mark> <mark>invoices<\/mark>/);
    assert.equal(await contents.isHidden(), true);

    await search.fill("weekly reminders");
    await page.getByRole("status").filter({ hasText: "1 result" }).waitFor();
    assert.match(await page.locator("#autotour-search-results a").first().getAttribute("href"), /^#autotour-h-\d+$/);

    await search.fill("strasse");
    await page.getByRole("status").filter({ hasText: "1 result" }).waitFor();
    assert.match(await page.locator("#autotour-search-results mark").first().innerText(), /Straße/);

    await search.fill("product people");
    await page.getByRole("status").filter({ hasText: "2 results" }).waitFor();
    const order = await page.locator("#autotour-search-results a").evaluateAll(links => links.map(link => link.getAttribute("href")));
    assert.deepEqual(order, ["#users", "#administration"]);

    await search.fill("invoice nowhere");
    await page.getByRole("status").filter({ hasText: "No results." }).waitFor();

    await search.press("Escape");
    assert.equal(await search.inputValue(), "");
    assert.equal(await contents.isVisible(), true);

    await search.fill("due date");
    await search.press("Enter");
    assert.equal(new URL(page.url()).hash, "#billing");
    assert.equal(await contents.isVisible(), true);
    assert.equal(requests.length, before);
  });
});

test("labels follow the manual language", async () => {
  const { file, html } = await manual({}, { language: "de" });
  assert.match(html, /<html lang="de">/);
  assert.match(html, /aria-label="Inhalt"/);
  assert.match(html, /↑ Nach oben/);
  await withPage(file, async (page) => {
    await page.getByLabel("Handbuch durchsuchen").fill("rechnung invoices");
    await page.getByRole("status").filter({ hasText: "Keine Treffer." }).waitFor();
    await page.getByLabel("Handbuch durchsuchen").fill("invoices");
    await page.getByRole("status").filter({ hasText: "1 Treffer" }).waitFor();
  });
});

test("screenshots open in a dialog from mouse and keyboard, and focus returns", async () => {
  const { file } = await manual({}, { mode: "single-file" });
  await withPage(file, async (page) => {
    const image = page.getByRole("button", { name: "Enlarge image: Invoice list" });
    await image.click();
    const dialog = page.locator("#autotour-dialog");
    await dialog.waitFor({ state: "visible" });
    assert.equal(await dialog.locator("figcaption").innerText(), "Paid and open invoices.");
    assert.match(await dialog.locator("img").getAttribute("src"), /^data:image\/png;base64,/);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await image.evaluate(element => element === document.activeElement), true);
    await image.press("Enter");
    await dialog.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "hidden" });
    await image.press(" ");
    await dialog.waitFor({ state: "visible" });
    await dialog.locator("img").click();
    await dialog.waitFor({ state: "hidden" });
  });
});

test("back to top appears after one screen, the current section is marked, and print hides navigation", async () => {
  const { file } = await manual();
  await withPage(file, async (page) => {
    const top = page.locator("#autotour-top");
    assert.equal(await top.evaluate(element => getComputedStyle(element).opacity), "0");
    await page.locator("#billing").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.querySelector("#billing").offsetTop));
    await page.waitForFunction(() => document.querySelector("#autotour-top").classList.contains("autotour-visible"));
    await page.waitForFunction(() => document.querySelector(".autotour-contents a[aria-current=location]")?.getAttribute("href") === "#billing");
    await top.click();
    await page.waitForFunction(() => window.scrollY === 0);
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator(".autotour-nav-panel").isHidden(), true);
    assert.equal(await top.isHidden(), true);
  });
});

test("each navigation flavour works on narrow and wide screens", async () => {
  for (const navigation of ["sidebar", "topbar", "minimal"]) {
    const { file, html } = await manual({ navigation });
    assert.match(html, new RegExp(`class="autotour-nav-${navigation}"`));
    await withPage(file, async (page) => {
      const search = page.getByLabel("Search this manual");
      if (navigation === "minimal") {
        assert.equal(await page.locator("#autotour-menu-button").count(), 0);
        assert.equal(await search.isVisible(), true);
        return;
      }
      const button = page.locator("#autotour-menu-button");
      assert.equal(await search.isVisible(), false);
      await button.click();
      assert.equal(await button.getAttribute("aria-expanded"), "true");
      assert.equal(await search.isVisible(), true);
      await page.locator(".autotour-contents a[href='#billing']").click();
      assert.equal(await button.getAttribute("aria-expanded"), "false");
      assert.equal(new URL(page.url()).hash, "#billing");
    }, { width: 600, height: 700 });
  }
  const { file } = await manual({ navigation: "sidebar" });
  await withPage(file, async (page) => {
    assert.equal(await page.getByLabel("Search this manual").isVisible(), true);
    assert.equal(await page.locator("#autotour-menu-button").isVisible(), false);
  });
});

test("numbered chapters link number references in prose", async () => {
  const numbered = [
    section("intro", "Introduction", 2, [{ kind: "text", text: "See Chapter 2 and Section 2.1, but not Chapter 9. `Chapter 2` stays code." }]),
    section("setup", "Setup", 2, [{ kind: "text", text: "Install it." }]),
    section("accounts", "Accounts", 3, [{ kind: "text", text: "Back to Chapter 1." }])
  ];
  const { html } = await manual({ sections: numbered, numbering: true });
  assert.match(html, /<section id="setup"><h2><span class="autotour-number">2<\/span>Setup<\/h2>/);
  assert.match(html, /<section id="accounts"><h3><span class="autotour-number">2\.1<\/span>Accounts<\/h3>/);
  assert.match(html, /<a class="autotour-ref" href="#setup">Chapter 2<\/a>/);
  assert.match(html, /<a class="autotour-ref" href="#accounts">Section 2\.1<\/a>/);
  assert.match(html, /<a class="autotour-ref" href="#intro">Chapter 1<\/a>/);
  assert.match(html, /not Chapter 9\./);
  assert.match(html, /<code>Chapter 2<\/code>/);
  assert.match(html, /<a href="#accounts">2\.1 Accounts<\/a>/);
});

test("single-file images can be re-encoded as WebP", async () => {
  const { html } = await manual({ images: { format: "webp", quality: 70 } }, { mode: "single-file" });
  assert.match(html, /<img src="data:image\/webp;base64,/);
});

test("branding sets colours, font and logo, and a draft shows a banner", async () => {
  const branding = { colors: { accent: "#aa0055" }, fontFamily: "Georgia, serif", logo: "logo.svg", logoAlt: "Brand" };
  const files = { "logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>` };
  const draft = await manual({ branding }, { mode: "single-file", files, draft: true });
  assert.match(draft.html, /--autotour-accent:#aa0055/);
  assert.match(draft.html, /--autotour-font:Georgia, serif/);
  assert.match(draft.html, /<img class="autotour-logo" src="data:image\/svg\+xml;base64,[^"]+" alt="Brand">/);
  assert.match(draft.html, /<div class="autotour-draft" role="note">Draft<\/div>/);
  const release = await manual({ branding }, { mode: "site", files });
  assert.doesNotMatch(release.html, /autotour-draft"/);
  assert.match(release.html, /<img class="autotour-logo" src="assets\/branding\/logo\.svg"/);
});
