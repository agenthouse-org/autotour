import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { annotateStep } from "../../src/annotations/annotate-step.js";
import { AnnotationError, AnnotationErrorCode } from "../../src/annotations/errors.js";
import { normalizeRoleNameTarget } from "../../src/annotations/target.js";

const suiteDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(suiteDirectory, "../..");
const outputRoot = ".autotour/output/annotations-tests";
const outputDirectory = path.join(repoRoot, outputRoot);
const evidenceDirectory = path.join(repoRoot, ".agenthouse/evidence/st-03");

const SECRET_EMAIL = "secret-user@example.com";
const SECRET_TOKEN = "tok_live_do_not_leak";

/**
 * Deterministic synthetic page used instead of ST-01 fixtures.
 */
function buildSyntheticProfilePage() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Synthetic profile</title>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; background: #f5f5f5; }
      main { padding: 48px; width: 720px; }
      label { display: block; margin-bottom: 8px; }
      input { width: 280px; padding: 8px; margin-bottom: 16px; }
      button { padding: 10px 18px; }
      .token { margin-top: 24px; color: #333; }
    </style>
  </head>
  <body>
    <main>
      <h1>Profile settings</h1>
      <label for="display-name">Display name</label>
      <input id="display-name" name="displayName" value="Ada Lovelace" />
      <label for="email">Email</label>
      <input id="email" name="email" value="${SECRET_EMAIL}" />
      <button type="button">Save profile</button>
      <p class="token" data-testid="session-token">Session ${SECRET_TOKEN}</p>
    </main>
  </body>
</html>`;
}

function toDataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

test("normalizeRoleNameTarget accepts the capture-step locator contract", () => {
  assert.deepEqual(normalizeRoleNameTarget({ role: "button", name: "Save profile" }), {
    role: "button",
    name: "Save profile"
  });
  assert.throws(
    () => normalizeRoleNameTarget({ role: "button" }),
    (error) =>
      error instanceof AnnotationError && error.code === AnnotationErrorCode.INVALID_INPUT
  );
});

test("annotateStep renders deterministic annotated assets from a synthetic data-URL page", async (t) => {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(evidenceDirectory, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    t.skip(`Playwright Chromium unavailable: ${error instanceof Error ? error.message : error}`);
    return;
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  try {
    await page.goto(toDataUrl(buildSyntheticProfilePage()), { waitUntil: "domcontentloaded" });

    const first = await annotateStep({
      page,
      stepId: "save-profile",
      moduleId: "update-profile",
      target: { role: "button", name: "Save profile" },
      callout: 1,
      caption: "Save the updated profile.",
      viewport: { width: 1280, height: 720 },
      outputRoot,
      cwd: repoRoot,
      redaction: {
        selectors: ['[data-testid="session-token"]'],
        texts: [SECRET_EMAIL, SECRET_TOKEN]
      },
      keepOverlays: true
    });

    assert.equal(first.stepId, "save-profile");
    assert.equal(first.path, `${outputRoot}/update-profile/save-profile.png`);
    assert.equal(first.width, 1280);
    assert.equal(first.height, 720);
    assert.equal(first.callout, 1);
    assert.equal(typeof first.targetBox.x, "number");
    assert.equal(typeof first.targetBox.y, "number");
    assert.ok(first.targetBox.width > 0);
    assert.ok(first.targetBox.height > 0);

    const absolutePath = path.join(repoRoot, ...first.path.split("/"));
    const png = await readFile(absolutePath);
    assert.ok(png.length > 1000);
    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50);

    const pngText = png.toString("latin1");
    assert.equal(pngText.includes(SECRET_EMAIL), false);
    assert.equal(pngText.includes(SECRET_TOKEN), false);

    const highlight = page.locator("[data-autotour-highlight]");
    const callout = page.locator('[data-autotour-callout="1"]');
    const caption = page.locator("[data-autotour-caption]");
    assert.equal(await highlight.count(), 1);
    assert.equal(await callout.count(), 1);
    assert.equal(await caption.count(), 1);
    assert.match(await caption.innerText(), /Save the updated profile/);

    const pageText = await page.locator("body").innerText();
    assert.equal(pageText.includes(SECRET_EMAIL), false);
    assert.equal(pageText.includes(SECRET_TOKEN), false);

    await page.goto(toDataUrl(buildSyntheticProfilePage()), { waitUntil: "domcontentloaded" });
    const second = await annotateStep({
      page,
      stepId: "save-profile",
      moduleId: "update-profile",
      target: { role: "button", name: "Save profile" },
      callout: 1,
      caption: "Save the updated profile.",
      viewport: { width: 1280, height: 720 },
      outputRoot,
      cwd: repoRoot,
      redaction: {
        selectors: ['[data-testid="session-token"]'],
        texts: [SECRET_EMAIL, SECRET_TOKEN]
      }
    });

    assert.deepEqual(
      {
        stepId: second.stepId,
        path: second.path,
        width: second.width,
        height: second.height,
        callout: second.callout,
        targetBox: second.targetBox
      },
      {
        stepId: first.stepId,
        path: first.path,
        width: first.width,
        height: first.height,
        callout: first.callout,
        targetBox: first.targetBox
      }
    );

    // Automated checks establish metadata and redaction absence only.
    // Readability and accidental disclosure still require human visual review.
    const evidencePath = path.join(evidenceDirectory, "save-profile.png");
    await copyFile(absolutePath, evidencePath);
  } finally {
    await context.close();
    await browser.close();
  }
});

test("annotateStep returns structured safe errors when the target is missing", async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    t.skip(`Playwright Chromium unavailable: ${error instanceof Error ? error.message : error}`);
    return;
  }

  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  try {
    await page.goto(toDataUrl(buildSyntheticProfilePage()), { waitUntil: "domcontentloaded" });
    await assert.rejects(
      () =>
        annotateStep({
          page,
          stepId: "missing-action",
          moduleId: "update-profile",
          target: { role: "button", name: "Does not exist" },
          callout: 2,
          caption: "Missing control.",
          outputRoot,
          cwd: repoRoot
        }),
      (error) =>
        error instanceof AnnotationError &&
        error.code === AnnotationErrorCode.TARGET_NOT_FOUND &&
        !JSON.stringify(error.toJSON()).includes(SECRET_TOKEN)
    );
  } finally {
    await context.close();
    await browser.close();
  }
});
