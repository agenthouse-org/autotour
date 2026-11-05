import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFixturePageDouble } from "../capture/fixture-page.js";
import { captureJourney } from "../../src/capture/index.js";
import { prepareDocumentationCapture } from "../../src/documentation/spec.js";
import { recaptureDocumentationModules } from "../../src/documentation/recapture.js";
import { configureStorage, initializeProject } from "../../src/project.js";

const BASE_URL = "https://fixture.test";
const MODULES = ["home", "settings", "billing"];
const cli = path.resolve("bin/autotour.js");

test("named recapture leaves modules that do not need to run unrun", async () => {
  const { definition, outputDir } = await seedManual("published");
  const before = await snapshotManual(outputDir);
  const page = screenshotPage("recaptured");

  const result = await recaptureDocumentationModules({
    ...definition,
    outputDir,
    moduleIds: ["home"],
    env: {},
    page
  });

  assert.deepEqual(result.regeneratedModules, ["home"]);
  assert.deepEqual(result.reusableModules, ["settings", "billing"]);
  assert.deepEqual(result.executedModules, ["home"]);
  assert.deepEqual(visited(page), [`${BASE_URL}/home`]);
  const after = await snapshotManual(outputDir);
  assert.notDeepEqual(after.images.home, before.images.home);
  assert.deepEqual(after.images.settings, before.images.settings);
  assert.deepEqual(after.images.billing, before.images.billing);
  assert.deepEqual(after.modules.settings, before.modules.settings);
  assert.deepEqual(after.modules.billing, before.modules.billing);
  assert.equal(after.modules.settings.assets.screenshots[0], "modules/settings/screenshots/open.png");
  assert.equal(after.modules.billing.assets.screenshots[0], "modules/billing/screenshots/open.png");
});

test("an earlier module can run for state without replacing its image or manifest entry", async () => {
  const { definition, outputDir } = await seedManual("published");
  const before = await snapshotManual(outputDir);
  const page = screenshotPage("recaptured");

  const result = await recaptureDocumentationModules({
    ...definition,
    outputDir,
    moduleIds: ["settings"],
    env: {},
    page
  });

  assert.deepEqual(result.regeneratedModules, ["settings"]);
  assert.deepEqual(result.executedModules, ["home", "settings"]);
  assert.deepEqual(visited(page), [`${BASE_URL}/home`, `${BASE_URL}/settings`]);
  const after = await snapshotManual(outputDir);
  assert.deepEqual(after.images.home, before.images.home);
  assert.deepEqual(after.modules.home, before.modules.home);
  assert.notDeepEqual(after.images.settings, before.images.settings);
  assert.deepEqual(after.images.billing, before.images.billing);
  assert.deepEqual(after.modules.billing, before.modules.billing);
});

test("a failed module leaves previously published sibling images in place", async () => {
  const { definition, outputDir, root } = await seedManual("published");
  const before = await snapshotManual(outputDir);
  const published = path.join(root, "manual", "assets", "home.png");
  await mkdir(path.dirname(published), { recursive: true });
  await writeFile(published, "published-home-image");
  const billingPublished = path.join(root, "manual", "assets", "billing.png");
  await writeFile(billingPublished, "published-billing-image");
  const page = screenshotPage("failed");
  page.screenshot = async () => {
    throw new Error("renderer unavailable");
  };

  await assert.rejects(
    recaptureDocumentationModules({
      ...definition,
      outputDir,
      moduleIds: ["settings"],
      env: {},
      page
    }),
    (error) => error.code === "AUTOTOUR_REGENERATION_FAILED"
  );

  assert.deepEqual(visited(page), [`${BASE_URL}/home`, `${BASE_URL}/settings`]);
  assert.deepEqual(await snapshotManual(outputDir), before);
  assert.equal(await readFile(published, "utf8"), "published-home-image");
  assert.equal(await readFile(billingPublished, "utf8"), "published-billing-image");
  const residue = (await readdir(root)).filter((entry) => entry.includes("autotour-stage") || entry.includes("autotour-backup"));
  assert.deepEqual(residue, []);
});

test("run-docs --module rejects unknown names before it touches published images", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-recapture-cli-"));
  await initializeProject(root);
  await configureStorage(root, {
    output: ".autotour/output",
    documentationOutput: "manual",
    artifacts: "local",
    documentation: "versioned",
    gitignore: "keep"
  });
  await writeFile(path.join(root, "documentation.json"), JSON.stringify(manualDefinition().spec));
  const published = path.join(root, "manual", "assets", "home.png");
  await mkdir(path.dirname(published), { recursive: true });
  await writeFile(published, "published-home-image");
  const captureImage = path.join(root, ".autotour/output/documentation/modules/home/screenshots/open.png");
  await mkdir(path.dirname(captureImage), { recursive: true });
  await writeFile(captureImage, "capture-home-image");

  const unknown = spawnSync(process.execPath, [cli, "run-docs", "documentation.json", "--module", "missing-module"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown module: missing-module/);
  assert.equal(await readFile(published, "utf8"), "published-home-image");
  assert.equal(await readFile(captureImage, "utf8"), "capture-home-image");

  const duplicate = spawnSync(process.execPath, [
    cli, "run-docs", "documentation.json", "--module", "home", "--module", "home"
  ], { cwd: root, encoding: "utf8" });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /Duplicate module id: home/);

  const mixed = spawnSync(process.execPath, [
    cli, "run-docs", "documentation.json", "--walkthrough", "walkthrough.json", "--module", "home"
  ], { cwd: root, encoding: "utf8" });
  assert.equal(mixed.status, 1);
  assert.match(mixed.stderr, /Omit --walkthrough/);
  assert.equal(await readFile(published, "utf8"), "published-home-image");
  assert.equal(await readFile(captureImage, "utf8"), "capture-home-image");
});

function manualDefinition() {
  const journey = {
    schemaVersion: 1,
    id: "office-manual",
    title: "Office manual",
    target: { baseUrl: BASE_URL, goal: "Show the office pages." },
    modules: MODULES.map((id) => ({
      id,
      title: id,
      route: `/${id}`,
      dependencies: { views: [id] },
      steps: [{ id: "open", action: "goto", path: `/${id}`, description: `Open ${id}.` }]
    }))
  };
  const dependencyMap = {
    schemaVersion: 1,
    rules: MODULES.map((id) => ({
      id,
      files: [`src/${id}/**`],
      dependencies: { views: [id] }
    }))
  };
  const spec = {
    schemaVersion: 1,
    walkthroughId: journey.id,
    journey,
    dependencyMap,
    viewport: { width: 1280, height: 720 },
    sections: MODULES.map((id) => ({
      moduleId: id,
      heading: id,
      dependencies: { views: [id] },
      blocks: [
        { kind: "text", text: `Read the ${id} page.` },
        {
          kind: "screenshot",
          stepId: "open",
          sourceView: id,
          timing: "after",
          alt: `${id} page`,
          caption: `The ${id} page.`
        }
      ]
    }))
  };
  return { spec, journey, dependencyMap };
}

async function seedManual(label) {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-recapture-"));
  const outputDir = path.join(root, "capture");
  const definition = manualDefinition();
  const prepared = await prepareDocumentationCapture(definition);
  await captureJourney({
    ...prepared,
    outputDir,
    env: {},
    page: screenshotPage(label)
  });
  return { definition, outputDir, root };
}

async function snapshotManual(outputDir) {
  const walkthrough = JSON.parse(await readFile(path.join(outputDir, "walkthrough.json"), "utf8"));
  const modules = Object.fromEntries(walkthrough.modules.map((module) => [module.id, module]));
  const images = {};
  for (const id of MODULES) {
    images[id] = await readFile(path.join(outputDir, modules[id].assets.screenshots[0]));
  }
  return {
    manifest: await readFile(path.join(outputDir, "walkthrough.json"), "utf8"),
    modules,
    images
  };
}

function visited(page) {
  return page.actions().filter((action) => action.type === "goto").map((action) => action.url);
}

function screenshotPage(label) {
  const page = createFixturePageDouble({ baseUrl: BASE_URL });
  page.setViewportSize = async () => {};
  page.screenshot = async ({ path: file }) => {
    await writeFile(file, `png:${label}:${page.url()}`);
  };
  return page;
}
