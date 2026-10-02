import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  startServer
} from "../../fixtures/demo-app/server.js";
import {
  CaptureError,
  captureJourney,
  createProfileJourney,
  validateWalkthroughDocument
} from "../../src/capture/index.js";
import { createInvalidationPlan } from "../../src/invalidation/index.js";
import { regenerateWalkthrough } from "../../src/regeneration/index.js";
import { createFixturePageDouble } from "./fixture-page.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("screenshot failures use safe module and step diagnostics", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-screenshot-failure-"));
  const page = createFixturePageDouble();
  page.setViewportSize = async () => {};
  page.screenshot = async () => { throw new Error("renderer unavailable"); };

  await assert.rejects(
    captureJourney({
      baseUrl: "https://fixture.test",
      goal: "Open the public page.",
      outputDir,
      env: {},
      journey: {
        id: "public-page",
        title: "Public page",
        modules: [{
          id: "open-page",
          title: "Open page",
          route: "/",
          steps: [{
            id: "open-home",
            action: "goto",
            description: "Open the home page.",
            path: "/"
          }]
        }]
      },
      page,
      recordScreenshots: true
    }),
    (error) => error instanceof CaptureError &&
      error.moduleId === "open-page" &&
      error.stepId === "open-home" &&
      /renderer unavailable/.test(error.cause)
  );
  await assert.rejects(access(path.join(outputDir, "walkthrough.json")));
  assert.equal((await readdir(outputDir)).includes(".screenshots-temp"), false);
});

test("captures annotated step screenshots and selectively regenerates affected modules", {
  timeout: 60000
}, async (t) => {
  const app = await startServer({
    username: DEFAULT_USERNAME,
    password: DEFAULT_PASSWORD,
    initialDisplayName: "Initial User"
  });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-screenshots-"));
  const env = {
    AUTOTOUR_USERNAME: DEFAULT_USERNAME,
    AUTOTOUR_PASSWORD: DEFAULT_PASSWORD
  };
  const recordScreenshots = {
    viewport: { width: 960, height: 540 },
    redaction: { selectors: ["[data-autotour-sensitive]"] }
  };

  try {
    let initial;
    try {
      initial = await captureJourney({
        baseUrl: app.baseUrl,
        goal: "Show how to update a profile.",
        outputDir,
        env,
        journey: createProfileJourney({ displayName: "Initial User" }),
        recordScreenshots
      });
    } catch (error) {
      if (/browserType\.launch/.test(error instanceof Error ? error.message : String(error))) {
        t.skip(`Playwright Chromium unavailable: ${error.message}`);
        return;
      }
      throw error;
    }

    assert.equal((await validateWalkthroughDocument(initial.walkthrough)).valid, true);
    assert.deepEqual(initial.walkthrough.outputs, ["screenshots"]);
    assert.deepEqual(
      initial.walkthrough.modules.map((module) => module.assets.screenshots),
      [
        [
          "modules/sign-in/screenshots/open-login.png",
          "modules/sign-in/screenshots/enter-email.png",
          "modules/sign-in/screenshots/enter-password.png",
          "modules/sign-in/screenshots/submit-login.png"
        ],
        [
          "modules/update-profile/screenshots/open-profile.png",
          "modules/update-profile/screenshots/enter-display-name.png",
          "modules/update-profile/screenshots/save-profile.png"
        ]
      ]
    );
    assert.deepEqual(Object.keys(initial.screenshotPaths), ["sign-in", "update-profile"]);
    assert.equal(initial.screenshotPaths["sign-in"].length, 4);
    assert.equal(initial.screenshotPaths["update-profile"].length, 3);
    assert.equal(app.getProfile().displayName, "Initial User");

    for (const file of Object.values(initial.screenshotPaths).flat()) {
      const bytes = await readFile(file);
      assert.equal(bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE), true);
      assert.equal(bytes.length > 1000, true);
    }
    assert.equal((await readdir(outputDir)).includes(".screenshots-temp"), false);

    const signInBefore = await Promise.all(
      initial.screenshotPaths["sign-in"].map((file) => readFile(file))
    );
    const profileBefore = await readFile(initial.screenshotPaths["update-profile"].at(-1));
    const dependencyMap = JSON.parse(
      await readFile(path.resolve("examples/dependency-map.json"), "utf8")
    );
    const invalidationPlan = createInvalidationPlan({
      walkthrough: initial.walkthrough,
      dependencyMap,
      changedFiles: ["fixtures/demo-app/profile-content.js"]
    });

    const regenerated = await regenerateWalkthrough({
      journey: {
        ...createProfileJourney({ displayName: "Regenerated User" }),
        target: {
          baseUrl: app.baseUrl,
          goal: "Show how to update a profile."
        }
      },
      invalidationPlan,
      outputDir,
      env,
      recordScreenshots
    });

    assert.equal(regenerated.mode, "screenshots");
    assert.deepEqual(regenerated.regeneratedModules, ["update-profile"]);
    assert.deepEqual(regenerated.reusableModules, ["sign-in"]);
    assert.deepEqual(regenerated.executedModules, ["sign-in", "update-profile"]);
    assert.equal(app.getProfile().displayName, "Regenerated User");
    const finalWalkthrough = JSON.parse(
      await readFile(path.join(outputDir, "walkthrough.json"), "utf8")
    );
    const finalSignIn = finalWalkthrough.modules[0].assets.screenshots;
    for (const [index, relative] of finalSignIn.entries()) {
      assert.deepEqual(await readFile(path.join(outputDir, relative)), signInBefore[index]);
    }
    const finalProfilePath = finalWalkthrough.modules[1].assets.screenshots.at(-1);
    assert.notDeepEqual(await readFile(path.join(outputDir, finalProfilePath)), profileBefore);
  } finally {
    await app.close();
  }
});
