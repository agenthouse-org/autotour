import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { generateDocumentation } from "../../src/documentation/generate.js";
import { pdfPageTexts } from "../../src/documentation/pdf-text.js";

async function manual(language) {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-pdf-"));
  const captureDir = path.join(root, "capture");
  await mkdir(path.join(captureDir, "modules/profile/screenshots"), { recursive: true });
  await mkdir(path.join(captureDir, "modules/profile/stills"), { recursive: true });
  await writeFile(path.join(captureDir, "modules/profile/screenshots/save.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  await writeFile(path.join(captureDir, "modules/profile/stills/tour.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const walkthrough = {
    schemaVersion: 1,
    id: "profile-docs",
    title: "Profile documentation",
    language,
    modules: [{
      id: "profile",
      title: "Profile",
      steps: [{ id: "save", action: "click" }],
      dependencies: { views: ["Profile"] },
      assets: { screenshots: ["modules/profile/screenshots/save.png"] }
    }]
  };
  const spec = {
    schemaVersion: 1,
    walkthroughId: "profile-docs",
    journey: walkthrough,
    dependencyMap: { schemaVersion: 1, rules: [{ id: "profile", files: ["src/profile/**"], dependencies: { views: ["Profile"] } }] },
    targets: [{ kind: "html", path: "site/index.html" }, { kind: "pdf", path: "profile.pdf" }],
    sections: [{
      moduleId: "profile",
      heading: "Profile",
      dependencies: { views: ["Profile"] },
      blocks: [
        { kind: "text", text: "Update your profile before the review." },
        { kind: "screenshot", stepId: "save", sourceView: "Profile", timing: "after", alt: "Profile form", caption: "Save the form." },
        { kind: "video", path: "tour.webm", label: "Watch the tour", caption: "The tour shows the save.", still: "modules/profile/stills/tour.png" }
      ]
    }]
  };
  const walkthroughFile = path.join(captureDir, "walkthrough.json");
  await writeFile(walkthroughFile, JSON.stringify(walkthrough));
  await generateDocumentation({ spec, walkthrough, walkthroughFile, outputRoot: root });
  return root;
}

test("the PDF is printed from the HTML page", { timeout: 30000 }, async () => {
  const root = await manual("en");
  const html = await readFile(path.join(root, "site/index.html"), "utf8");
  assert.match(html, /<section id="profile"><h2>Profile<\/h2>/);
  assert.match(html, /<figcaption>Save the form\.<\/figcaption>/);
  assert.match(html, /<figure class="autotour-still"><img src="assets\/stills\/tour\.png" alt="Watch the tour"><figcaption>The tour shows the save\.<\/figcaption>/);
  assert.match(html, /<a href="#profile">Profile<\/a>/);
  const pdf = await readFile(path.join(root, "profile.pdf"));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.toString("latin1"), /\/Outlines\b/);
  const pages = pdfPageTexts(pdf);
  const text = pages.join("\n");
  assert.match(text, /Profile/);
  assert.match(text, /Save the form\./);
  assert.match(text, /Watch the tour/);
  assert.match(text, /Page \d+ of \d+/);
  const profilePage = pages.findIndex(page => page.includes("Save the form."));
  assert.ok(profilePage > 0, text);
  assert.match(pages[0], new RegExp(`Profile ${profilePage + 1}`));

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${path.join(root, "site/index.html").replaceAll("\\", "/")}`);
    await page.locator("nav[aria-label='Contents'] a[href='#profile']").click();
    assert.equal(new URL(page.url()).hash, "#profile");
    const figure = page.locator("figure", { has: page.getByRole("button", { name: "Enlarge image: Profile form" }) });
    assert.equal(await figure.locator("figcaption").innerText(), "Save the form.");
    await page.getByRole("button", { name: "Enlarge image: Watch the tour" }).waitFor();
  } finally {
    await browser.close();
  }
});

test("a German walkthrough numbers the PDF pages in German", { timeout: 30000 }, async () => {
  const root = await manual("de");
  const pages = pdfPageTexts(await readFile(path.join(root, "profile.pdf")));
  assert.match(pages.join("\n"), /Seite \d+ von \d+/);
});
