import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  startServer
} from "../../fixtures/demo-app/server.js";
import {
  buildCaptureSteps,
  buildWalkthrough,
  captureJourney,
  createProfileJourney,
  validateWalkthroughDocument
} from "../../src/capture/index.js";
import { run } from "../../src/cli.js";
import {
  RegenerationError,
  regenerateWalkthrough,
  validateRegenerationPlan
} from "../../src/regeneration/index.js";

test("plan validation requires a complete certain classification", () => {
  const { journey, walkthrough } = createDocuments();
  const valid = createPlan(walkthrough.id);
  assert.deepEqual(validateRegenerationPlan({
    journey,
    invalidationPlan: valid,
    previousWalkthrough: walkthrough
  }), {
    regenerate: ["update-profile"],
    reusable: ["sign-in"]
  });

  const review = structuredClone(valid);
  review.reviewRequired = true;
  assert.throws(
    () => validateRegenerationPlan({ journey, invalidationPlan: review, previousWalkthrough: walkthrough }),
    (error) => error instanceof RegenerationError && error.code === "AUTOTOUR_REVIEW_REQUIRED"
  );

  const incomplete = structuredClone(valid);
  incomplete.modules.pop();
  assert.throws(
    () => validateRegenerationPlan({ journey, invalidationPlan: incomplete, previousWalkthrough: walkthrough }),
    /classify every walkthrough module exactly once/
  );
});

test("selective regeneration replaces affected assets and preserves reusable files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-regenerate-"));
  const outputDir = path.join(root, "output");
  const { journey, walkthrough, captureSteps } = createDocuments();
  await writeExistingOutput(outputDir, walkthrough, captureSteps);
  const signInBefore = await readFile(path.join(outputDir, "modules/sign-in/dom/events.json"));

  const result = await regenerateWalkthrough({
    journey,
    invalidationPlan: createPlan(walkthrough.id),
    outputDir,
    capture: async (options) => {
      assert.deepEqual(options.moduleIds, ["update-profile"]);
      const updated = structuredClone(options.previousWalkthrough);
      updated.modules[1].title = "Updated profile";
      await writeFile(
        path.join(options.outputDir, "modules/update-profile/dom/events.json"),
        "updated-profile-events\n"
      );
      await writeFile(
        path.join(options.outputDir, "walkthrough.json"),
        `${JSON.stringify(updated, null, 2)}\n`
      );
      return {
        walkthrough: updated,
        executedModuleIds: ["sign-in", "update-profile"]
      };
    }
  });

  assert.equal(result.status, "regenerated");
  assert.deepEqual(result.regeneratedModules, ["update-profile"]);
  assert.deepEqual(result.reusableModules, ["sign-in"]);
  assert.deepEqual(result.executedModules, ["sign-in", "update-profile"]);
  assert.deepEqual(
    await readFile(path.join(outputDir, "modules/sign-in/dom/events.json")),
    signInBefore
  );
  assert.equal(
    await readFile(path.join(outputDir, "modules/update-profile/dom/events.json"), "utf8"),
    "updated-profile-events\n"
  );
});

test("review and no-op plans do not invoke capture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-regenerate-noop-"));
  const outputDir = path.join(root, "output");
  const { journey, walkthrough, captureSteps } = createDocuments();
  await writeExistingOutput(outputDir, walkthrough, captureSteps);
  let captureCalls = 0;
  const capture = async () => { captureCalls += 1; };

  const noOpPlan = createPlan(walkthrough.id);
  noOpPlan.modules = noOpPlan.modules.map((module) => ({ ...module, status: "reusable" }));
  const result = await regenerateWalkthrough({ journey, invalidationPlan: noOpPlan, outputDir, capture });
  assert.equal(result.status, "unchanged");

  const reviewPlan = createPlan(walkthrough.id);
  reviewPlan.reviewRequired = true;
  await assert.rejects(
    regenerateWalkthrough({ journey, invalidationPlan: reviewPlan, outputDir, capture }),
    (error) => error.code === "AUTOTOUR_REVIEW_REQUIRED"
  );
  assert.equal(captureCalls, 0);
});

test("failed regeneration restores the prior output and removes staging data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-regenerate-failure-"));
  const outputDir = path.join(root, "output");
  const { journey, walkthrough, captureSteps } = createDocuments();
  await writeExistingOutput(outputDir, walkthrough, captureSteps);
  const before = await snapshotFiles(outputDir);

  await assert.rejects(
    regenerateWalkthrough({
      journey,
      invalidationPlan: createPlan(walkthrough.id),
      outputDir,
      capture: async ({ outputDir: stagingDir }) => {
        await writeFile(path.join(stagingDir, "partial.txt"), "partial");
        throw new Error("capture failed");
      }
    }),
    (error) => error.code === "AUTOTOUR_REGENERATION_FAILED"
  );

  assert.deepEqual(await snapshotFiles(outputDir), before);
  assert.deepEqual(
    (await readdir(root)).filter((entry) => entry.includes("autotour-stage") || entry.includes("autotour-backup")),
    []
  );
});

test("regenerate CLI emits a machine-readable no-op result and review status", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-regenerate-cli-"));
  const outputDir = path.join(root, "output");
  const journeyFile = path.join(root, "journey.json");
  const planFile = path.join(root, "plan.json");
  const { journey, walkthrough, captureSteps } = createDocuments();
  await writeExistingOutput(outputDir, walkthrough, captureSteps);
  const noOpPlan = createPlan(walkthrough.id);
  noOpPlan.modules = noOpPlan.modules.map((module) => ({ ...module, status: "reusable" }));
  await Promise.all([
    writeFile(journeyFile, JSON.stringify(journey)),
    writeFile(planFile, JSON.stringify(noOpPlan))
  ]);

  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message) => logs.push(message);
  console.error = (message) => errors.push(message);
  try {
    assert.equal(await run([
      "regenerate", journeyFile, "--plan", planFile, "--output-dir", outputDir
    ]), 0);
    assert.equal(JSON.parse(logs[0]).status, "unchanged");

    const reviewPlan = createPlan(walkthrough.id);
    reviewPlan.reviewRequired = true;
    await writeFile(planFile, JSON.stringify(reviewPlan));
    assert.equal(await run([
      "regenerate", journeyFile, "--plan", planFile, "--output-dir", outputDir
    ]), 2);
    assert.match(errors[0], /requires review/);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test("selective capture rejects incomplete reusable capture-step history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-regenerate-steps-"));
  const outputDir = path.join(root, "output");
  const { journey, walkthrough, captureSteps } = createDocuments();
  await writeExistingOutput(
    outputDir,
    walkthrough,
    captureSteps.filter((step) => step.moduleId !== "sign-in")
  );

  await assert.rejects(
    regenerateWalkthrough({
      journey,
      invalidationPlan: createPlan(walkthrough.id),
      outputDir,
      capture: captureJourney
    }),
    (error) => error.code === "AUTOTOUR_REGENERATION_FAILED" &&
      /Previous capture steps are incomplete for reusable module sign-in/.test(error.cause?.message)
  );
});

test("real DOM regeneration executes sign-in but replaces only update-profile", { timeout: 60000 }, async () => {
  const app = await startServer({ username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-regenerate-dom-"));
  const env = {
    AUTOTOUR_USERNAME: DEFAULT_USERNAME,
    AUTOTOUR_PASSWORD: DEFAULT_PASSWORD
  };
  try {
    const initial = await captureJourney({
      baseUrl: app.baseUrl,
      goal: "Show how to update a profile.",
      outputDir,
      env,
      journey: createProfileJourney({ displayName: "Initial User" }),
      recordDom: { viewport: { width: 960, height: 540 }, stepDelayMs: 10 }
    });
    const signInPath = path.join(outputDir, "modules/sign-in/dom/events.json");
    const profilePath = path.join(outputDir, "modules/update-profile/dom/events.json");
    const signInBefore = await readFile(signInPath);
    const profileBefore = await readFile(profilePath);
    const signInManifestBefore = structuredClone(initial.walkthrough.modules[0]);

    const result = await regenerateWalkthrough({
      journey: {
        ...createProfileJourney({ displayName: "Regenerated User" }),
        target: { baseUrl: app.baseUrl, goal: "Show how to update a profile." }
      },
      invalidationPlan: createPlan(initial.walkthrough.id),
      outputDir,
      env,
      recordDom: { viewport: { width: 960, height: 540 }, stepDelayMs: 10 }
    });

    assert.deepEqual(result.executedModules, ["sign-in", "update-profile"]);
    assert.deepEqual(await readFile(signInPath), signInBefore);
    assert.notDeepEqual(await readFile(profilePath), profileBefore);
    const assembled = JSON.parse(await readFile(path.join(outputDir, "walkthrough.json"), "utf8"));
    assert.deepEqual(assembled.modules[0], signInManifestBefore);
    assert.equal((await validateWalkthroughDocument(assembled)).valid, true);
    assert.equal(app.getProfile().displayName, "Regenerated User");
  } finally {
    await app.close();
  }
});

test("real video regeneration preserves the reusable module recording", { timeout: 60000 }, async () => {
  const app = await startServer({ username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-regenerate-video-"));
  const env = {
    AUTOTOUR_USERNAME: DEFAULT_USERNAME,
    AUTOTOUR_PASSWORD: DEFAULT_PASSWORD
  };
  const videoOptions = {
    size: { width: 960, height: 540 },
    viewport: { width: 960, height: 540 }
  };
  try {
    const initial = await captureJourney({
      baseUrl: app.baseUrl,
      goal: "Show how to update a profile.",
      outputDir,
      env,
      journey: createProfileJourney({ displayName: "Initial Video User" }),
      recordVideo: videoOptions
    });
    const signInPath = path.join(outputDir, "modules/sign-in/video.webm");
    const profilePath = path.join(outputDir, "modules/update-profile/video.webm");
    const signInBefore = await readFile(signInPath);
    const profileBefore = await readFile(profilePath);

    const result = await regenerateWalkthrough({
      journey: {
        ...createProfileJourney({ displayName: "Regenerated Video User" }),
        target: { baseUrl: app.baseUrl, goal: "Show how to update a profile." }
      },
      invalidationPlan: createPlan(initial.walkthrough.id),
      outputDir,
      env,
      recordVideo: videoOptions
    });

    assert.equal(result.mode, "video");
    assert.deepEqual(result.executedModules, ["sign-in", "update-profile"]);
    assert.deepEqual(await readFile(signInPath), signInBefore);
    assert.notDeepEqual(await readFile(profilePath), profileBefore);
    assert.equal(app.getProfile().displayName, "Regenerated Video User");
  } finally {
    await app.close();
  }
});

function createDocuments() {
  const journey = {
    ...createProfileJourney({ displayName: "Fixture User" }),
    target: {
      baseUrl: "https://example.test",
      goal: "Show how to update a profile."
    }
  };
  const modules = journey.modules.map((module) => ({
    ...module,
    observedRequests: [],
    assets: { dom: `modules/${module.id}/dom/index.html` }
  }));
  const walkthrough = buildWalkthrough({
    id: journey.id,
    title: journey.title,
    baseUrl: journey.target.baseUrl,
    goal: journey.target.goal,
    modules,
    outputs: ["dom"]
  });
  return { journey, walkthrough, captureSteps: buildCaptureSteps(modules) };
}

function createPlan(walkthroughId) {
  return {
    schemaVersion: 1,
    walkthroughId,
    reviewRequired: false,
    modules: [
      { id: "sign-in", title: "Sign in", status: "reusable", reasons: [] },
      { id: "update-profile", title: "Update profile", status: "regenerate", reasons: [] }
    ]
  };
}

async function writeExistingOutput(outputDir, walkthrough, captureSteps) {
  for (const module of walkthrough.modules) {
    const directory = path.join(outputDir, "modules", module.id, "dom");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "index.html"), `${module.id} player\n`);
    await writeFile(path.join(directory, "events.json"), `${module.id} events\n`);
  }
  await Promise.all([
    writeFile(path.join(outputDir, "walkthrough.json"), `${JSON.stringify(walkthrough, null, 2)}\n`),
    writeFile(path.join(outputDir, "capture-steps.json"), `${JSON.stringify(captureSteps, null, 2)}\n`),
    writeFile(path.join(outputDir, "index.html"), "walkthrough player\n")
  ]);
}

async function snapshotFiles(root) {
  const entries = [];
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else entries.push([relative, await readFile(absolute, "base64")]);
    }
  }
  await visit(root);
  return entries.sort(([left], [right]) => left.localeCompare(right));
}
