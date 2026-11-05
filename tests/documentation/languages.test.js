import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { run } from "../../src/cli.js";
import { generateDocumentation } from "../../src/documentation/generate.js";
import { readDocumentationSpec, validateDocumentationSpec } from "../../src/documentation/spec.js";

function journey(id, language) {
  return {
    schemaVersion: 1,
    id,
    language,
    modules: [{ id: "profile", steps: [{ id: "read", action: "click" }], dependencies: { views: ["Manual"] } }]
  };
}

function specFor({ language, label, twin, heading, htmlPath }) {
  return {
    schemaVersion: 1,
    walkthroughId: `manual-${language}`,
    language,
    languageLabel: label,
    journey: journey(`manual-${language}`, language),
    dependencyMap: { schemaVersion: 1, rules: [{ id: "profile", files: ["src/manual/**"], dependencies: { views: ["Manual"] } }] },
    translations: [{ language: twin.language, label: twin.label, spec: twin.file }],
    targets: [{ kind: "html", path: htmlPath }],
    sections: [{
      moduleId: "profile",
      heading,
      dependencies: { views: ["Manual"] },
      blocks: [{ kind: "text", text: heading }]
    }]
  };
}

test("translation links must be relative, unique, and returned by the other specification", async () => {
  const repeated = specFor({
    language: "de",
    label: "Deutsch",
    twin: { language: "de", label: "Deutsch", file: "en.json" },
    heading: "Profil",
    htmlPath: "de/index.html"
  });
  const invalid = await validateDocumentationSpec(repeated);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.map(error => error.message).join("\n"), /repeats the current language/);

  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-lang-spec-"));
  const german = specFor({
    language: "de",
    label: "Deutsch",
    twin: { language: "en", label: "English", file: "en.json" },
    heading: "Profil",
    htmlPath: "de/index.html"
  });
  const english = specFor({
    language: "en",
    label: "English",
    twin: { language: "de", label: "Deutsch", file: "de.json" },
    heading: "Profile",
    htmlPath: "en/index.html"
  });
  const germanPath = path.join(root, "de.json");
  const englishPath = path.join(root, "en.json");
  await writeFile(englishPath, JSON.stringify(english));
  await writeFile(germanPath, JSON.stringify({ ...german, translations: [{ language: "en", label: "English", spec: "missing.json" }] }));
  await assert.rejects(readDocumentationSpec(germanPath), /could not be read: missing\.json/);
  await writeFile(germanPath, JSON.stringify(german));
  const loaded = await readDocumentationSpec(germanPath);
  assert.equal(loaded.spec.language, "de");
  english.translations = [];
  await writeFile(englishPath, JSON.stringify({ ...english, translations: undefined }));
  await assert.rejects(readDocumentationSpec(germanPath), /does not point back/);
});

test("the language switch opens the same chapter anchor in the other manual", { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-lang-html-"));
  const german = specFor({
    language: "de",
    label: "Deutsch",
    twin: { language: "en", label: "English", file: "en.json" },
    heading: "Profil",
    htmlPath: "de/index.html"
  });
  const english = specFor({
    language: "en",
    label: "English",
    twin: { language: "de", label: "Deutsch", file: "de.json" },
    heading: "Profile",
    htmlPath: "en/index.html"
  });
  const germanPath = path.join(root, "de.json");
  const englishPath = path.join(root, "en.json");
  await writeFile(germanPath, JSON.stringify(german));
  await writeFile(englishPath, JSON.stringify(english));
  await generateDocumentation({ spec: german, specPath: germanPath, walkthrough: german.journey, walkthroughFile: germanPath, outputRoot: root });
  await generateDocumentation({ spec: english, specPath: englishPath, walkthrough: english.journey, walkthroughFile: englishPath, outputRoot: root });
  const germanHtml = await readFile(path.join(root, "de/index.html"), "utf8");
  const englishHtml = await readFile(path.join(root, "en/index.html"), "utf8");
  assert.match(germanHtml, /<html lang="de">/);
  assert.match(germanHtml, /<section id="profile"><h2>Profil<\/h2>/);
  assert.match(englishHtml, /<section id="profile"><h2>Profile<\/h2>/);
  assert.doesNotMatch(germanHtml, /id="profil"/);
  assert.match(germanHtml, /href="\.\.\/en\/index\.html" lang="en" hreflang="en" data-autotour-language>English/);
  assert.match(germanHtml, /aria-current="page">Deutsch/);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pageFileUrl(path.join(root, "de/index.html")));
    await page.locator("a[href='#profile']").click();
    assert.equal(new URL(page.url()).hash, "#profile");
    await page.getByRole("link", { name: "English" }).click();
    await page.waitForURL(/en\/index\.html#profile$/);
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.locator("#profile h2").innerText(), "Profile");
  } finally {
    await browser.close();
  }
});

test("validate-docs accepts a linked language pair", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-lang-cli-"));
  const german = specFor({
    language: "de",
    label: "Deutsch",
    twin: { language: "en", label: "English", file: "en.json" },
    heading: "Profil",
    htmlPath: "de/index.html"
  });
  const english = specFor({
    language: "en",
    label: "English",
    twin: { language: "de", label: "Deutsch", file: "de.json" },
    heading: "Profile",
    htmlPath: "en/index.html"
  });
  const germanPath = path.join(root, "de.json");
  await writeFile(germanPath, JSON.stringify(german));
  await writeFile(path.join(root, "en.json"), JSON.stringify(english));
  const originalLog = console.log;
  console.log = () => {};
  try {
    assert.equal(await run(["validate-docs", germanPath]), 0);
  } finally {
    console.log = originalLog;
  }
});

function pageFileUrl(file) {
  return `file://${file.replaceAll("\\", "/")}`;
}
