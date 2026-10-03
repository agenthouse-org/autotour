import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateDocumentationSpec, readDocumentationSpec, prepareDocumentationCapture } from "../src/documentation/spec.js";
import { syncMarkdownScreenshots } from "../src/publishing/index.js";
import { run } from "../src/cli.js";
import { chromium } from "playwright";
import { captureJourney } from "../src/capture/index.js";

const example = await readDocumentationSpec("examples/documentation.json");

test("documentation specs check source views, steps, unique sections, and dependency mappings", async () => {
  assert.equal((await validateDocumentationSpec(example.spec, example)).valid, true);
  for (const mutate of [
    spec => { spec.sections[0].moduleId = "missing-module"; },
    spec => { spec.sections[0].blocks[1].stepId = "missing-step"; },
    spec => { spec.sections[0].blocks[1].sourceView = "InventedView"; },
    spec => { spec.sections.push(structuredClone(spec.sections[0])); },
    spec => { spec.sections[0].blocks.push(structuredClone(spec.sections[0].blocks[1])); },
    spec => { spec.sections[0].blocks[0].text = "<!-- autotour:module=profile-settings:end -->"; },
    spec => { spec.sections[0].dependencies.controllers = ["UnrecordedController"]; }
  ]) {
    const spec = structuredClone(example.spec);
    mutate(spec);
    assert.equal((await validateDocumentationSpec(spec, example)).valid, false);
  }
  assert.equal((await validateDocumentationSpec(example.spec, { journey: example.journey, dependencyMap: { schemaVersion: 1, rules: [] } })).valid, false);
});

test("capture preparation applies caption, timing and independent highlight without changing actions or dependencies", async () => {
  const input = structuredClone(example);
  input.spec.sections[0].blocks[1].target = { role: "button", name: "Save profile" };
  const before = structuredClone(input.journey);
  const prepared = await prepareDocumentationCapture(input);
  const step = prepared.journey.modules[0].steps[1];
  assert.equal(step.value, "Documentation Name");
  assert.equal(step.selector, 'role=textbox[name="Display name"]');
  assert.deepEqual(step.annotation.target, { role: "button", name: "Save profile" });
  assert.equal(step.annotation.timing, "after");
  assert.equal(step.annotation.caption, input.spec.sections[0].blocks[1].caption);
  assert.deepEqual(input.journey, before);
  assert.deepEqual(prepared.journey.modules[0].dependencies, before.modules[0].dependencies);
});

test("spec-driven Markdown selects screenshots and renders ordered text/captions idempotently", async () => {
  const fixture = await publishingFixture();
  const first = await syncMarkdownScreenshots({ ...fixture.options, dryRun: true });
  assert.equal(first.assets.length, 1);
  assert.equal(first.changed, true);
  assert.equal(await readFile(fixture.markdownFile, "utf8"), fixture.original);
  const remote = structuredClone(example.spec);
  remote.destination = { kind: "confluence", siteUrl: "https://example.atlassian.net", pageId: "12345" };
  await assert.rejects(syncMarkdownScreenshots({ ...fixture.options, documentationSpec: remote }), /connected tools/);
  assert.match(first.renderedMarkdown, /## Profile Settings/);
  assert.match(first.renderedMarkdown, /display name field highlighted/);
  assert.match(first.renderedMarkdown, /01-fill-display-name\.png/);
  assert.doesNotMatch(first.renderedMarkdown, /open-profile\.png|save-profile\.png/);
  assert.ok(first.renderedMarkdown.indexOf("Enter your new") < first.renderedMarkdown.indexOf("!["));
  assert.ok(first.renderedMarkdown.indexOf("ready to save") < first.renderedMarkdown.indexOf("take effect"));
  await syncMarkdownScreenshots(fixture.options);
  const second = await syncMarkdownScreenshots(fixture.options);
  assert.equal(second.changed, false);
  assert.ok(second.renderedMarkdown.startsWith("Hand-written introduction.\n"));
  assert.ok(second.renderedMarkdown.endsWith("Hand-written ending.\n"));
  assert.deepEqual(await readFile(second.assets[0].destination), Buffer.from("selected-image"));
});

test("missing captured screenshot or incorrect section prevents publication without modifying files", async () => {
  const fixture = await publishingFixture();
  const broken = structuredClone(fixture.options.walkthrough);
  broken.modules[0].assets.screenshots = [];
  await assert.rejects(syncMarkdownScreenshots({ ...fixture.options, walkthrough: broken }), /No captured screenshot/);
  assert.equal(await readFile(fixture.markdownFile, "utf8"), fixture.original);
  const spec = structuredClone(example.spec);
  spec.sections[0].moduleId = "unknown";
  await assert.rejects(syncMarkdownScreenshots({ ...fixture.options, documentationSpec: spec }));
  assert.equal(await readFile(fixture.markdownFile, "utf8"), fixture.original);
});

test("validate-docs and sync-markdown --spec use linked files and check mode", async () => {
  const fixture = await publishingFixture();
  const root = path.dirname(fixture.markdownFile);
  const specPath = path.join(root, "documentation.json");
  const spec = structuredClone(example.spec);
  spec.destination.path = "profile.md";
  await Promise.all([
    writeFile(specPath, JSON.stringify(spec)),
    writeFile(path.join(root, spec.journey), JSON.stringify(example.journey)),
    writeFile(path.join(root, spec.dependencyMap), JSON.stringify(example.dependencyMap)),
    writeFile(fixture.options.walkthroughFile, JSON.stringify(fixture.options.walkthrough))
  ]);
  const originalLog = console.log;
  console.log = () => {};
  try {
    assert.equal(await run(["validate-docs", specPath]), 0);
    const args = ["sync-markdown", fixture.options.walkthroughFile, "--markdown", fixture.markdownFile,
      "--assets-dir", fixture.options.assetsDir, "--spec", specPath];
    assert.equal(await run([...args, "--check"]), 2);
    assert.equal(await run(args), 0);
    assert.equal(await run([...args, "--check"]), 0);
  } finally {
    console.log = originalLog;
  }
});

test("a real screenshot follows the requested action timing and independent UI target", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<label>Display name<input value="Original"></label><button>Save profile</button>');
    const input = structuredClone(example);
    input.journey.modules[0].steps = [input.journey.modules[0].steps[1]];
    input.spec.sections[0].blocks[1].target = { role: "button", name: "Save profile" };
    const prepared = await prepareDocumentationCapture(input);
    const originalScreenshot = page.screenshot.bind(page);
    const values = [];
    page.screenshot = async options => {
      values.push(await page.getByRole("textbox", { name: "Display name" }).inputValue());
      return originalScreenshot(options);
    };
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-doc-timing-"));
    const result = await captureJourney({ ...prepared, page, outputDir, env: {} });
    assert.deepEqual(values, ["Documentation Name"]);
    await page.getByRole("textbox", { name: "Display name" }).fill("Original");
    input.spec.sections[0].blocks[1].timing = "before";
    await captureJourney({ ...(await prepareDocumentationCapture(input)), page,
      outputDir: await mkdtemp(path.join(os.tmpdir(), "autotour-doc-before-")), env: {} });
    assert.deepEqual(values, ["Documentation Name", "Original"]);
    const history = JSON.parse(await readFile(path.join(outputDir, "capture-steps.json"), "utf8"));
    assert.equal(history[0].target.role, "textbox");
    assert.equal(history[0].annotation.target.role, "button");
    assert.equal(history[0].annotation.timing, "after");
    assert.deepEqual((await readFile(result.screenshotPaths["profile-settings"][0])).subarray(0, 8),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } finally {
    await browser.close();
  }
});

async function publishingFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-doc-spec-"));
  const output = path.join(root, "output");
  const sourceDir = path.join(output, "modules/profile-settings/screenshots");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "fill-display-name.png"), "selected-image");
  await writeFile(path.join(sourceDir, "open-profile.png"), "unselected-image");
  await writeFile(path.join(sourceDir, "save-profile.png"), "unselected-image");
  const walkthrough = structuredClone(example.journey);
  walkthrough.publish = true;
  walkthrough.modules[0].publish = true;
  walkthrough.modules[0].assets.screenshots = ["open-profile", "fill-display-name", "save-profile"]
    .map(step => `modules/profile-settings/screenshots/${step}.png`);
  const markdownFile = path.join(root, "profile.md");
  const original = "Hand-written introduction.\n<!-- autotour:module=profile-settings:start -->\nold\n<!-- autotour:module=profile-settings:end -->\nHand-written ending.\n";
  await writeFile(markdownFile, original);
  return { markdownFile, original, options: {
    walkthrough, walkthroughFile: path.join(output, "walkthrough.json"), markdownFile,
    assetsDir: path.join(root, "assets"), documentationSpec: example.spec
  } };
}
