import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startServer, DEFAULT_PASSWORD, DEFAULT_USERNAME } from "../../fixtures/demo-app/server.js";
import { captureJourney, createProfileJourney, validateWalkthroughDocument } from "../../src/capture/index.js";

test("video capture writes one stable non-empty WebM per module with shared authentication", { timeout: 60000 }, async () => {
  const app = await startServer({
    username: DEFAULT_USERNAME,
    password: DEFAULT_PASSWORD
  });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-video-"));

  try {
    const result = await captureJourney({
      baseUrl: app.baseUrl,
      goal: "Show how to update a profile.",
      outputDir,
      env: {
        AUTOTOUR_USERNAME: DEFAULT_USERNAME,
        AUTOTOUR_PASSWORD: DEFAULT_PASSWORD
      },
      journey: createProfileJourney({ displayName: "Video User" }),
      recordVideo: {
        size: { width: 960, height: 540 },
        viewport: { width: 960, height: 540 }
      }
    });

    assert.deepEqual(Object.keys(result.videoPaths), ["sign-in", "update-profile"]);
    for (const [moduleId, videoPath] of Object.entries(result.videoPaths)) {
      const info = await stat(videoPath);
      assert.ok(info.size > 0, `${moduleId} video should not be empty`);
      assert.equal(videoPath, path.join(outputDir, "modules", moduleId, "video.webm"));
    }

    const byId = Object.fromEntries(result.walkthrough.modules.map((module) => [module.id, module]));
    assert.equal(byId["sign-in"].assets.video, "modules/sign-in/video.webm");
    assert.equal(byId["update-profile"].assets.video, "modules/update-profile/video.webm");
    assert.deepEqual(result.walkthrough.outputs, ["video"]);
    assert.equal((await validateWalkthroughDocument(result.walkthrough)).valid, true);
    assert.equal(app.getProfile().displayName, "Video User");
  } finally {
    await app.close();
  }
});

