import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { captureJourney } from "../../src/capture/capture.js";
import { waitForCondition } from "../../src/capture/conditions.js";
import { executeStep } from "../../src/capture/execute.js";
import { prepareDocumentationCapture } from "../../src/documentation/spec.js";
import { startPreview } from "../../src/preview.js";

// ST-31: capture fixes from the 0.7.0 plan, phase 3. Each test failed on 0.6.0.

async function withFixture(html, run) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "autotour-st31-"));
  await writeFile(path.join(fixture, "index.html"), html);
  const preview = await startPreview(fixture);
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-st31-out-"));
  try {
    return await run({ baseUrl: preview.url, outputDir });
  } finally {
    await preview.close();
  }
}

function journeyWith(steps) {
  return {
    id: "fixes",
    title: "Fixes",
    modules: [{
      id: "panel",
      title: "Panel",
      route: "/",
      dependencies: { views: ["Panel"] },
      assets: {},
      setup: [{ id: "open-page", action: "goto", description: "Open", path: "/" }],
      steps
    }]
  };
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function withPage(html, run) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    return await run(page);
  } finally {
    await browser.close();
  }
}

test("an optional step whose target is absent is skipped without a screenshot", async () => {
  await withFixture("<!doctype html><button>Close panel</button>", async ({ baseUrl, outputDir }) => {
    const result = await captureJourney({
      baseUrl,
      goal: "Open the panel if it is closed.",
      outputDir,
      env: {},
      recordScreenshots: { viewport: { width: 800, height: 600 }, captionInImage: false },
      journey: journeyWith([
        { id: "open-panel", action: "click", optional: true, description: "Open the panel", target: { role: "button", name: "Open panel" } },
        { id: "close-panel", action: "click", description: "Close the panel", target: { role: "button", name: "Close panel" } }
      ])
    });
    assert.equal(await exists(path.join(outputDir, "modules/panel/screenshots/open-panel.png")), false);
    assert.equal(await exists(path.join(outputDir, "modules/panel/screenshots/close-panel.png")), true);
    assert.ok(result.warnings.some(warning => /panel\/open-panel/.test(warning) && /skipped/.test(warning)), JSON.stringify(result.warnings));
  });
});

test("an after-screenshot annotates expect.target when the step target is gone", async () => {
  const html = `<!doctype html><main><button onclick="this.remove(); document.querySelector('main').insertAdjacentHTML('beforeend', '<h1>Documents</h1>')">Open list</button></main>`;
  await withFixture(html, async ({ baseUrl, outputDir }) => {
    const result = await captureJourney({
      baseUrl,
      goal: "Open the list.",
      outputDir,
      env: {},
      recordScreenshots: { viewport: { width: 800, height: 600 }, captionInImage: false },
      journey: journeyWith([{
        id: "open-list",
        action: "click",
        description: "Open the list",
        target: { role: "button", name: "Open list" },
        expect: { target: { role: "heading", name: "Documents" } },
        annotation: { timing: "after", caption: "The list opens." }
      }])
    });
    assert.equal(await exists(path.join(outputDir, "modules/panel/screenshots/open-list.png")), true);
    assert.ok(result.warnings.some(warning => /panel\/open-list/.test(warning) && /expect\.target/.test(warning)), JSON.stringify(result.warnings));
  });
});

test("the documentation spec's captionInImage reaches every screenshot step", async () => {
  const journey = {
    schemaVersion: 1,
    id: "fixes",
    modules: [{
      id: "panel",
      dependencies: { views: ["Panel"] },
      steps: [{ id: "save", action: "click", description: "Save", target: { role: "button", name: "Save" } }]
    }]
  };
  const spec = {
    schemaVersion: 1,
    walkthroughId: "fixes",
    journey,
    dependencyMap: { schemaVersion: 1, rules: [{ id: "panel", files: ["src/panel/**"], dependencies: { views: ["Panel"] } }] },
    sections: [{
      moduleId: "panel",
      heading: "Panel",
      dependencies: { views: ["Panel"] },
      blocks: [{ kind: "screenshot", stepId: "save", sourceView: "Panel", alt: "Save", caption: "Save the panel.", timing: "before" }]
    }]
  };
  const withoutSetting = await prepareDocumentationCapture({ spec, journey, dependencyMap: spec.dependencyMap });
  assert.equal(withoutSetting.journey.modules[0].steps[0].annotation.captionInImage, undefined, "an unset block must not override recordScreenshots.captionInImage");
  const off = await prepareDocumentationCapture({ spec: { ...spec, captionInImage: false }, journey, dependencyMap: spec.dependencyMap });
  assert.equal(off.journey.modules[0].steps[0].annotation.captionInImage, false);
  const blockWins = structuredClone(spec);
  blockWins.captionInImage = false;
  blockWins.sections[0].blocks[0].captionInImage = true;
  const block = await prepareDocumentationCapture({ spec: blockWins, journey, dependencyMap: spec.dependencyMap });
  assert.equal(block.journey.modules[0].steps[0].annotation.captionInImage, true);
});

test("a caption that would cover the target is reported as a capture warning", async () => {
  await withFixture("<!doctype html><button style=\"position:fixed;inset:0\">Save</button>", async ({ baseUrl, outputDir }) => {
    const result = await captureJourney({
      baseUrl,
      goal: "Save.",
      outputDir,
      env: {},
      recordScreenshots: { viewport: { width: 320, height: 240 } },
      journey: journeyWith([{
        id: "save",
        action: "click",
        description: "Save",
        target: { role: "button", name: "Save" },
        annotation: { caption: "This caption cannot sit beside a button that fills the viewport." }
      }])
    });
    assert.equal(await exists(path.join(outputDir, "modules/panel/screenshots/save.png")), true);
    assert.ok(result.warnings.some(warning => /Caption omitted from the image for panel\/save/.test(warning)), JSON.stringify(result.warnings));
  });
});

test("expect.text without a target matches text contained in the page", async () => {
  await withPage("<main><h1>Rules</h1><p role=\"status\">Saved successfully</p></main>", async (page) => {
    await waitForCondition(page, { text: "Saved successfully", timeoutMs: 2000 });
    await assert.rejects(() => waitForCondition(page, { text: "Not on the page", timeoutMs: 200 }), /text/);
  });
});

test("condition measurement retries when a navigation destroys the execution context", async () => {
  let calls = 0;
  const locator = {
    async evaluateAll() {
      calls += 1;
      if (calls === 1) throw new Error("locator.evaluateAll: Execution context was destroyed, most likely because of a navigation");
      return [{ content: "Done", text: "Done", rect: [0, 0, 10, 10], visible: true }];
    }
  };
  const page = {
    locator: () => locator,
    getByText: () => locator,
    async waitForLoadState() {},
    async waitForTimeout(ms) { await new Promise(resolve => setTimeout(resolve, ms)); }
  };
  await waitForCondition(page, { target: { text: "Done" }, timeoutMs: 2000 });
  assert.ok(calls >= 2);
});

test("an assert without its own target uses expect.target", async () => {
  await withPage("<p id=\"done\" hidden>Done</p><script>setTimeout(() => document.getElementById('done').hidden = false, 100)</script>", async (page) => {
    await executeStep({
      page,
      baseUrl: "http://127.0.0.1/",
      module: { id: "panel" },
      step: { id: "saved", action: "assert", description: "Saved", expect: { target: { css: "#done" }, state: "visible", timeoutMs: 3000 } },
      env: {},
      secrets: []
    });
    assert.equal(await page.locator("#done").isVisible(), true);
  });
});

test("stableForMs on a hidden wait means absent for that long", async () => {
  const html = `<div id="slot"></div><script>
    window.overlayGone = false;
    setTimeout(() => { document.getElementById('slot').innerHTML = '<p id="busy">Loading…</p>'; }, 150);
    setTimeout(() => { document.getElementById('busy').remove(); window.overlayGone = true; }, 450);
  </script>`;
  await withPage(html, async (page) => {
    await waitForCondition(page, { target: { css: "#busy" }, state: "hidden", stableForMs: 400, timeoutMs: 5000 });
    assert.equal(await page.evaluate(() => window.overlayGone), true, "the wait returned before the overlay appeared and went away");
    await waitForCondition(page, { target: { css: "#busy" }, state: "detached", stableForMs: 100, timeoutMs: 2000 });
  });
});
