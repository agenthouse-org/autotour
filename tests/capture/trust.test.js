import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { annotateStep } from "../../src/annotations/annotate-step.js";
import { captureJourney } from "../../src/capture/capture.js";
import { waitForCondition } from "../../src/capture/conditions.js";
import { MAX_WAIT_MS } from "../../src/capture/limits.js";
import { validateDocumentationSpec } from "../../src/documentation/spec.js";
import { startPreview } from "../../src/preview.js";

test("the walkthrough schema and documentation validation share the wait ceiling", async () => {
  const schema = JSON.parse(await readFile(new URL("../../schemas/walkthrough.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.$defs.condition.properties.timeoutMs.maximum, MAX_WAIT_MS);
  assert.equal(schema.$defs.condition.properties.stableForMs.maximum, MAX_WAIT_MS);
  assert.equal(schema.$defs.step.properties.timeoutMs.maximum, MAX_WAIT_MS);
  const journey = {
    schemaVersion: 1,
    id: "manual",
    modules: [{
      id: "rules",
      dependencies: { views: ["Rules"] },
      steps: [{ id: "index", action: "wait", description: "Wait for indexing", until: { target: { css: "#done" }, timeoutMs: 45000 } }]
    }]
  };
  const spec = {
    schemaVersion: 1,
    walkthroughId: "manual",
    journey,
    dependencyMap: { schemaVersion: 1, rules: [] },
    sections: [{ moduleId: "rules", heading: "Rules", dependencies: { views: ["Rules"] }, blocks: [{ kind: "text", text: "Indexing can take a minute." }] }]
  };
  const accepted = await validateDocumentationSpec(spec, { journey });
  assert.equal(accepted.valid, true, JSON.stringify(accepted.errors));
  journey.modules[0].steps[0].until.timeoutMs = MAX_WAIT_MS + 1;
  const rejected = await validateDocumentationSpec(spec, { journey });
  assert.equal(rejected.valid, false);
  assert.match(JSON.stringify(rejected.errors), new RegExp(String(MAX_WAIT_MS)));
  await assert.rejects(() => waitForCondition({}, { timeoutMs: MAX_WAIT_MS + 1 }), new RegExp(String(MAX_WAIT_MS)));
});

test("an unsupported selector names the module and step", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-selector-"));
  await assert.rejects(() => captureJourney({
    baseUrl: "http://127.0.0.1:9",
    goal: "Open the folder.",
    outputDir,
    env: {},
    journey: {
      id: "tree",
      title: "Tree",
      modules: [{
        id: "files",
        title: "Files",
        route: "/",
        dependencies: {},
        assets: {},
        steps: [{ id: "open-folder", action: "click", description: "Open", selector: "#main-content table" }]
      }]
    }
  }), (error) => {
    assert.equal(error.moduleId, "files");
    assert.equal(error.stepId, "open-folder");
    assert.match(error.message, /Failed at module files, step open-folder/);
    assert.match(error.message, /Unsupported journey selector: #main-content table/);
    return true;
  });
});

test("screenshot capture uses the spec viewport before the first navigation", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "autotour-viewport-"));
  await writeFile(path.join(fixture, "index.html"), "<!doctype html><p id=\"width\"></p><script>document.getElementById('width').textContent = String(window.innerWidth)</script>");
  const preview = await startPreview(fixture);
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-viewport-out-"));
  try {
    await captureJourney({
      baseUrl: preview.url,
      goal: "Measure the viewport.",
      outputDir,
      env: {},
      recordScreenshots: { viewport: { width: 1440, height: 900 }, captionInImage: false },
      journey: {
        id: "viewport",
        title: "Viewport",
        modules: [{
          id: "open",
          title: "Open",
          route: "/",
          dependencies: { views: ["Home"] },
          assets: {},
          setup: [{ id: "open-page", action: "goto", description: "Open", path: "/" }],
          steps: [{ id: "width", action: "wait", description: "Read width", until: { selector: "css=#width", text: "1440", timeoutMs: 10000 } }]
        }]
      }
    });
  } finally {
    await preview.close();
  }
});

test("a missing target names itself and leaves a failure screenshot", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "autotour-failure-"));
  await writeFile(path.join(fixture, "index.html"), "<!doctype html><p>Ready</p>");
  const preview = await startPreview(fixture);
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-failure-out-"));
  try {
    await assert.rejects(() => captureJourney({
      baseUrl: preview.url,
      goal: "Wait for save.",
      outputDir,
      env: {},
      journey: {
        id: "save",
        title: "Save",
        modules: [{
          id: "rules",
          title: "Rules",
          route: "/",
          dependencies: { views: ["Rules"] },
          assets: {},
          setup: [{ id: "open-page", action: "goto", description: "Open", path: "/" }],
          steps: [{ id: "wait-save", action: "wait", description: "Wait for save", until: { selector: "css=#save", timeoutMs: 300 } }]
        }]
      }
    }), (error) => {
      assert.equal(error.moduleId, "rules");
      assert.equal(error.stepId, "wait-save");
      assert.match(error.message, /no element matched css selector "#save"/);
      assert.match(error.message, /Failure screenshot: modules\/rules\/failure.png/);
      return true;
    });
    const image = await readFile(path.join(outputDir, "modules/rules/failure.png"));
    assert.ok(image.length > 32);
  } finally {
    await preview.close();
  }
});

test("visual stability ignores a class change inside the target", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="box"><span class="a">Ready</span></div><script>
      let changes = 0;
      setInterval(() => {
        const child = document.querySelector("#box span");
        changes += 1;
        child.className = "state-" + changes;
      }, 20);
    </script>`);
    await waitForCondition(page, { target: { css: "#box" }, stableForMs: 200, timeoutMs: 45000 });
    await assert.rejects(
      () => waitForCondition(page, { target: { css: "#box" }, stableForMs: 200, timeoutMs: 400, stability: "content" }),
      /text or layout kept changing for css selector "#box"/
    );
  } finally {
    await browser.close();
  }
});

test("a caption that would cover the target is omitted and the screenshot is kept", async () => {
  const browser = await chromium.launch({ headless: true });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-caption-"));
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
    await page.setContent("<button style=\"position:fixed;inset:0\">Save</button>");
    const result = await annotateStep({
      page,
      moduleId: "rules",
      stepId: "dialog",
      target: { role: "button", name: "Save" },
      callout: 1,
      caption: "This caption cannot sit beside a dialog that fills the viewport.",
      viewport: { width: 320, height: 240 },
      outputRoot: "out",
      cwd: outputDir
    });
    assert.match(result.captionWarning, /Caption omitted from the image for rules\/dialog/);
    const image = await readFile(path.join(outputDir, result.path));
    assert.ok(image.length > 32);
  } finally {
    await browser.close();
  }
});
