import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { captureJourney } from "../src/capture/capture.js";
import { executeStep } from "../src/capture/execute.js";
import { waitForCondition } from "../src/capture/conditions.js";
import { annotateStep } from "../src/annotations/annotate-step.js";
import { initializeProject, configureStorage } from "../src/project.js";
import { startPreview } from "../src/preview.js";

const html = `<!doctype html><html lang="de"><head><title>Fixture</title><style>
body{font:18px system-ui;margin:24px;background:#f4f6fa;color:#182235} #board{width:400px;overflow:auto;border:1px solid;padding:8px} .row{width:1400px;height:90px;display:flex;gap:30px} button{padding:12px} #result{margin-top:20px}</style></head><body>
<h1>Tour fixture</h1><aside id="popup">Welcome<button data-testid="dismiss" onclick="this.parentElement.remove()">Dismiss</button></aside>
<input aria-label="Search"><div id="board"><div class="row"><button>Duplicate</button><button>Duplicate</button><button data-testid="chosen" onclick="document.querySelector('#result').textContent='Opened'">Open item</button></div></div><div id="result">Ready</div></body></html>`;

test("stable targets, explicit ambiguity, nested scrolling and annotation geometry", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const execute = step => executeStep({ page, module: { id: "test" }, step: { id: "step", ...step }, env: {}, secrets: [] });
    await assert.rejects(execute({ action: "click", target: { role: "button", name: "Duplicate" } }), /not unique: 2/);
    await execute({ action: "scroll", target: { css: "#board" }, scroll: { mode: "to", x: 250, y: 0, durationMs: 30 } });
    assert.equal(await page.locator("#board").evaluate(el => el.scrollLeft), 250);
    assert.equal(await page.evaluate(() => window.scrollX), 0);
    await execute({ action: "click", target: { testId: "chosen" }, expect: { target: { css: "#result" }, text: "Opened", stableForMs: 80 }, pauseAfterMs: 20 });
    await assert.rejects(waitForCondition(page, { target: { css: "#result" }, count: 2, timeoutMs: 100 }), /did not settle/);
    await page.evaluate(() => { setTimeout(() => document.querySelector('#result').textContent = 'Settled', 60); });
    await waitForCondition(page, { target: { css: "#result" }, text: "Settled", stableForMs: 100, timeoutMs: 1500 });
    const result = await annotateStep({ page, moduleId: "generic", stepId: "chosen", target: { testId: "chosen" }, callout: 1, caption: "Open this item", outputRoot: ".agenthouse/evidence/generic-tour", keepOverlays: true });
    const target = await page.getByTestId("chosen").boundingBox();
    const highlight = await page.locator("[data-autotour-highlight]").boundingBox();
    for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(target[key] - highlight[key]) <= 1);
    assert.ok(result.path.endsWith("chosen.png"));
  } finally { await browser.close(); }
});

test("setup, hooks and scene markers survive capture and drive a seekable localized replay", { timeout: 30000 }, async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "autotour-scenes-"));
  await writeFile(path.join(fixture, "index.html"), html);
  const source = await startPreview(fixture);
  const outputDir = path.resolve(".agenthouse/evidence/generic-tour/replay");
  const journey = { id: "generic", title: "Generic tutorial", language: "de", target: { baseUrl: source.url, goal: "Open a uniquely identified item" }, modules: [{ id: "items", title: "Items", route: "/", setup: [
    { id: "open", action: "goto", description: "Open fixture", path: "/" },
    { id: "dismiss", action: "click", description: "Dismiss welcome", selector: "testid=dismiss", optional: true }
  ], steps: [
    { id: "settle", action: "wait", description: "Wait", instruction: "Element auswählen", until: { selector: "css=#board", stableForMs: 100, minimumCount: 1 }, pauseAfterMs: 150 },
    { id: "open-item", action: "click", description: "Open", instruction: "Element öffnen", narration: "Die Details erscheinen.", selector: "testid=chosen", expect: { selector: "css=#result", text: "Opened", stableForMs: 100 }, pauseAfterMs: 400 }
  ] }] };
  let afterSteps = 0;
  let preview;
  let browser;
  try {
    const result = await captureJourney({ journey, outputDir, recordDom: { inlineEvents: false, autoplay: false, stepDelayMs: 0 },
      fixtures: { search: "Example" }, hooks: { beforeCapture: async ({ page, fixtures }) => { await page.getByRole('textbox').fill(fixtures.search); }, afterStep: () => { afterSteps++; } } });
    assert.equal(afterSteps, 2);
    assert.equal(result.walkthrough.modules[0].steps[1].selector, "testid=chosen");
    assert.equal(result.walkthrough.modules[0].setup.length, 2);
    const events = JSON.parse(await readFile(result.domEventPaths.items, "utf8"));
    assert.equal(events.filter(e => e.type === 5 && e.data.tag === "autotour:step").length, 6);
    assert.ok(!JSON.stringify(events.find(e => e.type === 2)).includes('"id":"popup"'));
    const playerHtml = await readFile(result.domPaths.items, "utf8");
    assert.ok(playerHtml.length < 30000);
    preview = await startPreview(outputDir);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(preview.url);
    const player = page.frameLocator("#module-frame");
    await player.locator('body[data-autoplay="disabled"]').waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "de");
    await player.getByRole("button", { name: "Nächster Schritt" }).click();
    assert.match(await player.locator("#step-caption").textContent(), /Element öffnen/);
    await player.getByRole("button", { name: "Vorheriger Schritt" }).click();
    assert.match(await player.locator("#step-caption").textContent(), /Element auswählen/);
    await page.screenshot({ path: path.resolve(".agenthouse/evidence/generic-tour/player-desktop.png") });
    await page.setViewportSize({ width: 390, height: 700 });
    await page.screenshot({ path: path.resolve(".agenthouse/evidence/generic-tour/player-mobile.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await player.locator("#natural-size").click();
    await player.locator('body[data-natural-size="true"]').waitFor();
    assert.equal(await player.locator("#natural-size").getAttribute("aria-pressed"), "true");
    await page.waitForTimeout(100);
    assert.ok(await player.locator("main").evaluate(el => el.scrollWidth > el.clientWidth));
    await player.locator("#natural-size").click();
    const report = JSON.parse(await readFile(path.join(outputDir, "modules/items/dom/capture-report.json"), "utf8"));
    assert.equal(report.eventCount, events.length);
    assert.match(report.moduleHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(errors, []);
    await player.getByRole("button", { name: "Abspielen" }).click();
    await player.locator("#status").filter({ hasText: "Abgeschlossen" }).waitFor();
  } finally { await browser?.close(); await preview?.close(); await source.close(); }
});

test("consumer initialization preserves ignore rules and keeps sources trackable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "autotour-ignore-"));
  execFileSync("git", ["init", directory]);
  await mkdir(path.join(directory, ".autotour"));
  await writeFile(path.join(directory, ".autotour/.gitignore"), "custom-local/\n");
  await initializeProject(directory);
  const choices = { output: ".autotour/output", documentationOutput: ".autotour/output/documentation", artifacts: "local", documentation: "local", gitignore: "modify" };
  await configureStorage(directory, choices);
  await configureStorage(directory, choices);
  const ignore = await readFile(path.join(directory, ".autotour/.gitignore"), "utf8");
  const rootIgnore = await readFile(path.join(directory, ".gitignore"), "utf8");
  assert.equal(rootIgnore.match(/\/\.autotour\/output\//g).length, 2);
  assert.ok(ignore.startsWith("custom-local/"));
  assert.match(execFileSync("git", ["check-ignore", ".autotour/output/tour.html"], { cwd: directory, encoding: "utf8" }), /tour.html/);
  assert.throws(() => execFileSync("git", ["check-ignore", ".autotour/autotour.json"], { cwd: directory }));
});

test("preview serves files but blocks hidden files and external symlinks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "autotour-preview-"));
  await writeFile(path.join(directory, "index.html"), "ok");
  await writeFile(path.join(directory, ".secret"), "secret");
  const outside = await mkdtemp(path.join(os.tmpdir(), "autotour-outside-"));
  await writeFile(path.join(outside, "index.html"), "outside");
  await symlink(outside, path.join(directory, "escape"), process.platform === "win32" ? "junction" : "dir");
  const preview = await startPreview(directory);
  try {
    assert.equal(await (await fetch(preview.url)).text(), "ok");
    assert.equal((await fetch(preview.url + ".secret")).status, 403);
    assert.equal((await fetch(preview.url, { method: "POST" })).status, 405);
    assert.equal((await fetch(preview.url + "escape/index.html")).status, 403);
  } finally { await preview.close(); }
});
