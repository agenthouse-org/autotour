import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { chromium } from "playwright";
import { generateManual, readManual, validateManualDocument } from "../../src/documentation/manual/manual.js";
import { generateDocumentation } from "../../src/documentation/generate.js";
import { configurePresentation, initializeProject, readPresentationSettings } from "../../src/project.js";
import { run } from "../../src/cli.js";

let browserPromise;
const browser = () => (browserPromise ??= chromium.launch({ headless: true }));
after(async () => { if (browserPromise) await (await browserPromise).close(); });

let pngCache;
async function png() {
  if (pngCache) return pngCache;
  const page = await (await browser()).newPage({ viewport: { width: 480, height: 300 } });
  try {
    await page.setContent(`<body style="margin:0;background:#dde7f5"><h1 style="font:32px system-ui;padding:32px">Screen</h1></body>`);
    pngCache = await page.screenshot({ type: "png" });
    return pngCache;
  } finally {
    await page.close();
  }
}

// One captured application: a journey on its own base URL, a specification per language, and a walkthrough.
async function application(root, key, baseUrl, sections) {
  const dir = path.join(root, key);
  const capture = path.join(dir, "capture");
  const journey = {
    schemaVersion: 1,
    id: key,
    title: key,
    target: { baseUrl, goal: "Document it." },
    modules: sections.filter(item => item.status !== "text").map(item => ({
      id: item.moduleId,
      title: item.heading.en,
      route: "/",
      steps: [{ id: "open", action: "click", description: "Open" }],
      dependencies: { views: ["Main"] }
    }))
  };
  const walkthrough = structuredClone(journey);
  for (const module of walkthrough.modules) {
    await mkdir(path.join(capture, "modules", module.id, "screenshots"), { recursive: true });
    await writeFile(path.join(capture, "modules", module.id, "screenshots", "open.png"), await png());
    module.assets = { screenshots: [`modules/${module.id}/screenshots/open.png`] };
  }
  await writeFile(path.join(capture, "walkthrough.json"), JSON.stringify(walkthrough));
  for (const language of ["de", "en"]) {
    await writeFile(path.join(dir, `documentation.${language}.json`), JSON.stringify({
      schemaVersion: 1,
      walkthroughId: key,
      journey,
      dependencyMap: { schemaVersion: 1, rules: [{ id: "main", files: ["src/main.js"], dependencies: { views: ["Main"] } }] },
      language,
      sections: sections.map(item => ({
        moduleId: item.moduleId,
        heading: item.heading[language],
        ...(item.headingLevel ? { headingLevel: item.headingLevel } : {}),
        ...(item.status ? { status: item.status } : { dependencies: { views: ["Main"] } }),
        blocks: item.blocks(language)
      }))
    }));
  }
  return dir;
}

async function fixture({ aiDisclosure = { placement: "document" }, contents, languages } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-manual-"));
  await application(root, "builder", "http://builder.test/", [
    { moduleId: "model", heading: { de: "Prozess modellieren", en: "Model a process" }, blocks: language => [
      { kind: "text", text: language === "de" ? "Danach führt Kapitel 2 den Prozess aus." : "Chapter 2 then runs the process.", origin: "ai-generated" },
      { kind: "screenshot", stepId: "open", sourceView: "Main", timing: "before", alt: language === "de" ? "Modellierer" : "Modeller", caption: language === "de" ? "Der Modellierer." : "The modeller.", origin: "human" }
    ] },
    { moduleId: "glossary", heading: { de: "Glossar", en: "Glossary" }, status: "text", blocks: () => [{ kind: "text", text: "**Process** – a sequence of steps.", origin: "human" }] },
    { moduleId: "unused", heading: { de: "Nicht verwendet", en: "Unused" }, status: "text", blocks: () => [{ kind: "text", text: "Left out.", origin: "human" }] }
  ]);
  await application(root, "runtime", "http://runtime.test/", [
    { moduleId: "run", heading: { de: "Prozess ausführen", en: "Run the process" }, blocks: language => [
      { kind: "text", text: language === "de" ? "Siehe Abschnitt 1.1." : "See Section 1.1.", origin: "ai-modified" },
      { kind: "screenshot", stepId: "open", sourceView: "Main", timing: "before", alt: language === "de" ? "Aufgabenliste" : "Task list", caption: language === "de" ? "Die Aufgaben." : "The tasks." }
    ] },
    { moduleId: "tasks", heading: { de: "Aufgaben bearbeiten", en: "Work on tasks" }, headingLevel: 3, blocks: () => [{ kind: "text", text: "Open a task.", origin: "human" }] }
  ]);
  const manual = {
    schemaVersion: 1,
    id: "product-manual",
    organisation: "by-use-case",
    navigation: "sidebar",
    ...(aiDisclosure ? { aiDisclosure } : {}),
    languages: (languages ?? ["de", "en"]).map(language => ({
      language,
      label: language === "de" ? "Deutsch" : "English",
      title: language === "de" ? "Benutzerhandbuch" : "User manual",
      specs: {
        builder: { spec: `builder/documentation.${language}.json`, walkthrough: "builder/capture/walkthrough.json" },
        runtime: { spec: `runtime/documentation.${language}.json`, walkthrough: "runtime/capture/walkthrough.json" }
      },
      parts: { "use-case": language === "de" ? "Teil A – Ein Prozess von Anfang bis Ende" : "Part A – One process end to end", reference: language === "de" ? "Teil B – Nachschlagen" : "Part B – Reference" },
      targets: [
        { kind: "html", path: `${language}/manual.html`, mode: "single-file" },
        { kind: "markdown", path: `${language}/manual.md` },
        { kind: "larecipe", path: `resources/docs/${language}`, version: "1.0", assetsPath: `public/docs-assets/${language}`, assetsUrl: `/docs-assets/${language}` }
      ]
    })),
    contents: contents ?? [
      { part: "use-case" },
      { spec: "builder", section: "model" },
      { spec: "runtime", section: "run" },
      { spec: "runtime", section: "tasks" },
      { part: "reference" },
      { spec: "builder", section: "glossary" }
    ]
  };
  const manualPath = path.join(root, "manual.json");
  await writeFile(manualPath, JSON.stringify(manual));
  return { root, manualPath, manual, output: path.join(root, "out") };
}

test("a manual mixes sections of two applications into one numbered HTML file per language", async () => {
  const { manualPath, output } = await fixture();
  const result = await generateManual({ manualFile: manualPath, outputRoot: output });
  assert.deepEqual(result.targets.map(target => `${target.language}:${target.kind}`), ["de:html", "de:markdown", "de:larecipe", "en:html", "en:markdown", "en:larecipe"]);
  assert.match(result.warnings.join("\n"), /sections of builder not in the manual: unused/);
  const html = await readFile(path.join(output, "de/manual.html"), "utf8");
  assert.match(html, /<html lang="de">/);
  assert.match(html, /<div class="autotour-part" id="part-use-case"><p class="autotour-part-label">Teil A – Ein Prozess von Anfang bis Ende<\/p><\/div>/);
  assert.match(html, /<section id="model"><h2><span class="autotour-number">1<\/span>Prozess modellieren<\/h2>/);
  assert.match(html, /<section id="run"><h2><span class="autotour-number">2<\/span>Prozess ausführen<\/h2>/);
  assert.match(html, /<section id="tasks"><h3><span class="autotour-number">2\.1<\/span>Aufgaben bearbeiten<\/h3>/);
  assert.match(html, /<section id="glossary"><h2><span class="autotour-number">3<\/span>Glossar<\/h2>/);
  assert.match(html, /<a class="autotour-ref" href="#run">Kapitel 2<\/a>/);
  assert.doesNotMatch(html, /href="#[^"]*">Abschnitt 1\.1/);
  assert.match(html, /<li class="autotour-contents-part"><a href="#part-use-case">Teil A/);
  assert.match(html, /<img src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /Nicht verwendet/);
  // Document placement: a short note at the start and a closing section listing AI content.
  assert.match(html, /<p class="autotour-ai-note">Teile dieses Handbuchs wurden mit KI erstellt oder bearbeitet\. <a href="#autotour-ai-content">Details<\/a><\/p>/);
  assert.match(html, /<section id="autotour-ai-content" class="autotour-ai-content"><h2>Hinweis zu KI-Inhalten<\/h2>/);
  assert.match(html, /<li><a href="#model">1 Prozess modellieren<\/a>: Text \(KI-generiert\)<\/li>/);
  assert.match(html, /<li><a href="#run">2 Prozess ausführen<\/a>: Text \(KI-bearbeitet\)<\/li>/);
  assert.match(html, /<a href="#autotour-ai-content">Hinweis zu KI-Inhalten<\/a>/);
  assert.match(html, /href="\.\.\/en\/manual\.html" lang="en" hreflang="en" data-autotour-language>English/);

  const context = await (await browser()).newContext();
  try {
    const page = await context.newPage();
    await page.goto(`file://${path.join(output, "de/manual.html")}#run`);
    await page.getByRole("link", { name: "English" }).click();
    await page.waitForURL(/en\/manual\.html#run$/);
    assert.equal(await page.locator("#run h2").innerText(), "2Run the process");
  } finally {
    await context.close();
  }

  const markdown = await readFile(path.join(output, "en/manual.md"), "utf8");
  assert.match(markdown, /^# User manual\n\n\*Parts of this manual were created or edited with AI\.\*/);
  assert.match(markdown, /\*\*Part A – One process end to end\*\*/);
  assert.match(markdown, /## About AI-generated content/);
});

test("the LaRecipe target writes a page per chapter, a sidebar with parts, and public images", async () => {
  const { manualPath, output } = await fixture();
  await generateManual({ manualFile: manualPath, outputRoot: output, languages: ["en"], targets: ["larecipe"] });
  const docs = path.join(output, "resources/docs/en/1.0");
  const sidebar = await readFile(path.join(docs, "index.md"), "utf8");
  assert.equal(sidebar, [
    "- ## Part A – One process end to end",
    "    - [1 Model a process](/{{route}}/{{version}}/model)",
    "    - [2 Run the process](/{{route}}/{{version}}/run)",
    "",
    "- ## Part B – Reference",
    "    - [3 Glossary](/{{route}}/{{version}}/glossary)",
    "    - [About AI-generated content](/{{route}}/{{version}}/ai-content)",
    ""
  ].join("\n"));
  const run = await readFile(path.join(docs, "run.md"), "utf8");
  assert.match(run, /^# 2 Run the process/);
  assert.match(run, /<a name="tasks"><\/a>\n\n## 2\.1 Work on tasks/);
  assert.match(run, /!\[Task list\]\(\/docs-assets\/en\/1\.0\/run\/open\.png\)/);
  const model = await readFile(path.join(docs, "model.md"), "utf8");
  assert.match(model, /<small>Parts of this manual were created or edited with AI\. <a href="\/\{\{route\}\}\/\{\{version\}\}\/ai-content">Details<\/a><\/small>/);
  assert.match(model, /<a class="autotour-ref" href="\/\{\{route\}\}\/\{\{version\}\}\/run">Chapter 2<\/a>/);
  assert.equal((await readFile(path.join(output, "public/docs-assets/en/1.0/run/open.png"))).length, (await png()).length);
  assert.match(await readFile(path.join(docs, "ai-content.md"), "utf8"), /- \[2 Run the process\]\(\/\{\{route\}\}\/\{\{version\}\}\/run\): Text \(AI-modified\)/);
});

test("manual validation catches clashing anchors, missing part labels, and unknown specifications", async () => {
  const { manual } = await fixture();
  const missingPart = structuredClone(manual);
  delete missingPart.languages[1].parts.reference;
  assert.match(JSON.stringify((await validateManualDocument(missingPart)).errors), /en: part reference needs a label/);
  const unknown = structuredClone(manual);
  unknown.contents.push({ spec: "billing" });
  assert.match(JSON.stringify((await validateManualDocument(unknown)).errors), /unknown specification billing/);

  const twice = await fixture({ contents: [{ spec: "builder", section: "model" }, { spec: "builder" }] });
  await assert.rejects(readManual(twice.manualPath), /section builder\/model appears twice/);
  const clash = await fixture({ contents: [{ spec: "builder", section: "model" }, { spec: "runtime", section: "run", anchor: "model" }] });
  await assert.rejects(readManual(clash.manualPath), /anchor model is used twice/);
});

test("a draft manual builds before capture, and the CLI validates manuals with warnings", async () => {
  const { root, manualPath, manual } = await fixture({ aiDisclosure: null, languages: ["en"] });
  for (const language of manual.languages) for (const reference of Object.values(language.specs)) delete reference.walkthrough;
  await writeFile(manualPath, JSON.stringify(manual));
  await assert.rejects(readManual(manualPath), /no walkthrough is named/);
  const draft = await generateManual({ manualFile: manualPath, outputRoot: path.join(root, "draft"), draft: true, targets: ["html"] });
  const html = await readFile(draft.targets[0].path, "utf8");
  assert.match(html, /<div class="autotour-draft" role="note">Draft<\/div>/);
  assert.match(html, /Screenshot not captured yet\./);
  assert.match(draft.warnings.join("\n"), /aiDisclosure\.placement is not set/);

  const errors = [];
  const original = console.error;
  const log = console.log;
  console.error = message => errors.push(String(message));
  console.log = () => {};
  try {
    assert.equal(await run(["validate-docs", manualPath]), 0);
  } finally {
    console.error = original;
    console.log = log;
  }
  assert.match(errors.join("\n"), /Warning: .*aiDisclosure\.placement is not set/);
});

test("the navigation flavour is saved in the project configuration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-presentation-"));
  assert.deepEqual(await readPresentationSettings(root), {});
  await initializeProject(root);
  await assert.rejects(configurePresentation(root, { navigation: "carousel" }), /sidebar, topbar, or minimal/);
  await configurePresentation(root, { navigation: "topbar" });
  assert.deepEqual(await readPresentationSettings(root), { navigation: "topbar" });
});

test("chapter and item placement label AI content, and an embed shows its still until it reports ready", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-ai-"));
  await writeFile(path.join(root, "still.png"), await png());
  await writeFile(path.join(root, "motion.html"), `<!doctype html><body style="margin:0;background:#123"><script>setTimeout(() => parent.postMessage({ motionAd: "ready" }, "*"), 50)</script></body>`);
  const walkthrough = { schemaVersion: 1, id: "manual", title: "Manual", modules: [] };
  const spec = (placement) => ({
    schemaVersion: 1,
    walkthroughId: "manual",
    journey: walkthrough,
    dependencyMap: { schemaVersion: 1, rules: [] },
    navigation: "minimal",
    aiDisclosure: { placement },
    targets: [{ kind: "html", path: `${placement}.html`, mode: "single-file" }, { kind: "markdown", path: `${placement}.md` }],
    sections: [
      { moduleId: "intro", heading: "Introduction", status: "text", blocks: [
        { kind: "text", text: "Hello.", origin: "ai-generated" },
        { kind: "embed", path: "motion.html", still: "still.png", label: "Product animation", caption: "How it works.", readyMessage: { motionAd: "ready" }, origin: "ai-generated" }
      ] },
      { moduleId: "notes", heading: "Notes", status: "text", blocks: [{ kind: "text", text: "Written by hand.", origin: "human" }] }
    ]
  });
  const specPath = path.join(root, "documentation.json");
  for (const placement of ["chapter", "item"]) {
    await writeFile(specPath, JSON.stringify(spec(placement)));
    const result = await generateDocumentation({ spec: spec(placement), specPath, walkthrough, outputRoot: root });
    assert.equal(result.warnings, undefined);
  }
  const chapter = await readFile(path.join(root, "chapter.html"), "utf8");
  assert.match(chapter, /<h2>Introduction <span class="autotour-ai">AI-generated<\/span><\/h2>/);
  assert.match(chapter, /<h2>Notes<\/h2>/);
  assert.match(chapter, /<footer class="autotour-footer"><p>Parts of this manual were created or edited with AI\.<\/p><\/footer>/);
  assert.match(await readFile(path.join(root, "chapter.md"), "utf8"), /## Introduction \*\(AI-generated\)\*/);
  const item = await readFile(path.join(root, "item.html"), "utf8");
  assert.match(item, /<p>Hello\.<\/p><p class="autotour-ai">AI-generated<\/p>/);
  assert.match(item, /<figcaption>How it works\. <span class="autotour-ai">AI-generated<\/span><\/figcaption>/);
  assert.doesNotMatch(item, /Written by hand\.<\/p><p class="autotour-ai">/);
  assert.match(await readFile(path.join(root, "item.md"), "utf8"), /Hello\.\n\n\*AI-generated\*/);

  const context = await (await browser()).newContext();
  try {
    const page = await context.newPage();
    await page.goto(`file://${path.join(root, "item.html")}`);
    const figure = page.locator("figure.autotour-embed");
    await page.waitForFunction(() => document.querySelector("figure.autotour-embed").classList.contains("autotour-embed-ready"));
    assert.equal(await figure.locator("iframe").evaluate(element => getComputedStyle(element).opacity), "1");
    assert.equal(await page.getByRole("button", { name: /Enlarge image: Product animation/ }).count(), 0);
    await page.emulateMedia({ media: "print" });
    assert.equal(await figure.locator("iframe").isHidden(), true);
    assert.equal(await figure.locator("img").isVisible(), true);
  } finally {
    await context.close();
  }

  const unmarked = spec("document");
  unmarked.sections[1].blocks[0] = { kind: "text", text: "Origin unknown." };
  delete unmarked.navigation;
  const warned = await generateDocumentation({ spec: unmarked, specPath, walkthrough, outputRoot: root, targets: ["html"] });
  assert.match(warned.warnings.join("\n"), /1 block\(s\) have no declared origin \(human, ai-generated, ai-modified\): notes\/text/);
  assert.match(warned.warnings.join("\n"), /no navigation flavour was chosen/);
  const chosen = await generateDocumentation({ spec: unmarked, specPath, walkthrough, outputRoot: root, targets: ["html"], presentation: { navigation: "topbar" } });
  assert.doesNotMatch(chosen.warnings.join("\n"), /navigation flavour/);
});
