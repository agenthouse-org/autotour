import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { run } from "../../src/cli.js";
import {
  collectGitChangedFiles,
  createInvalidationPlan,
  matchesFilePattern,
  validateDependencyMapDocument
} from "../../src/invalidation/index.js";

const execFileAsync = promisify(execFile);

const walkthrough = {
  schemaVersion: 1,
  id: "update-display-name",
  title: "Update display name",
  target: { baseUrl: "https://example.test", goal: "Update a profile." },
  outputs: ["dom"],
  modules: [
    moduleFixture("sign-in", "Sign in", {
      views: ["LoginPage"],
      apiEndpoints: ["POST /api/login"]
    }),
    moduleFixture("update-profile", "Update profile", {
      views: ["ProfileSettings"],
      apiEndpoints: ["GET /api/profile", "PUT /api/profile"]
    })
  ]
};

const dependencyMap = {
  schemaVersion: 1,
  rules: [{
    id: "profile-page",
    files: ["fixtures/demo-app/profile-*.js"],
    dependencies: {
      views: ["ProfileSettings"],
      apiEndpoints: ["GET /api/profile", "PUT /api/profile"]
    }
  }]
};

test("profile-only changes regenerate update-profile and preserve sign-in", () => {
  const plan = createInvalidationPlan({
    walkthrough,
    dependencyMap,
    changedFiles: ["fixtures\\demo-app\\profile-content.js"]
  });

  assert.equal(plan.reviewRequired, false);
  assert.deepEqual(plan.summary, {
    regenerate: ["update-profile"],
    reusable: ["sign-in"],
    review: []
  });
  assert.deepEqual(plan.modules[1].reasons, [
    {
      file: "fixtures/demo-app/profile-content.js",
      ruleId: "profile-page",
      kind: "views",
      value: "ProfileSettings"
    },
    {
      file: "fixtures/demo-app/profile-content.js",
      ruleId: "profile-page",
      kind: "apiEndpoints",
      value: "GET /api/profile"
    },
    {
      file: "fixtures/demo-app/profile-content.js",
      ruleId: "profile-page",
      kind: "apiEndpoints",
      value: "PUT /api/profile"
    }
  ]);
});

test("unmapped files require review for otherwise unaffected modules", () => {
  const plan = createInvalidationPlan({
    walkthrough,
    dependencyMap,
    changedFiles: ["src/shared/theme.js"]
  });
  assert.equal(plan.reviewRequired, true);
  assert.deepEqual(plan.unmappedFiles, ["src/shared/theme.js"]);
  assert.deepEqual(plan.summary, {
    regenerate: [],
    reusable: [],
    review: ["sign-in", "update-profile"]
  });
});

test("stale dependency mappings require review", () => {
  const plan = createInvalidationPlan({
    walkthrough,
    changedFiles: ["src/removed.js"],
    dependencyMap: {
      schemaVersion: 1,
      rules: [{
        id: "removed-view",
        files: ["src/removed.js"],
        dependencies: { views: ["RemovedView"] }
      }]
    }
  });
  assert.equal(plan.reviewRequired, true);
  assert.deepEqual(plan.unmatchedDependencies, [{
    file: "src/removed.js",
    ruleId: "removed-view",
    kind: "views",
    value: "RemovedView"
  }]);
});

test("portable file patterns support exact, star, double-star, and question matching", () => {
  assert.equal(matchesFilePattern("src/profile/view.js", "src/profile/view.js"), true);
  assert.equal(matchesFilePattern("src/profile/view.js", "src/*/view.js"), true);
  assert.equal(matchesFilePattern("src/profile/forms/view.js", "src/**/view.js"), true);
  assert.equal(matchesFilePattern("src/profile/view.js", "src/**/view.js"), true);
  assert.equal(matchesFilePattern("src/profile/view.js", "src/profile/view.?s"), true);
  assert.equal(matchesFilePattern("src/profile/forms/view.js", "src/*/view.js"), false);
});

test("dependency map schema accepts the example shape and rejects empty dependencies", async () => {
  assert.equal((await validateDependencyMapDocument(dependencyMap)).valid, true);
  const invalid = structuredClone(dependencyMap);
  invalid.rules[0].dependencies = {};
  assert.equal((await validateDependencyMapDocument(invalid)).valid, false);
});

test("Git range collection returns normalized changed paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-git-"));
  await git(root, "init");
  await git(root, "config", "user.name", "AutoTour Test");
  await git(root, "config", "user.email", "autotour@example.test");
  await writeFile(path.join(root, "initial.txt"), "initial\n");
  await git(root, "add", "initial.txt");
  await git(root, "commit", "-m", "initial");
  const base = (await git(root, "rev-parse", "HEAD")).trim();
  await writeFile(path.join(root, "profile.js"), "export const profile = true;\n");
  await git(root, "add", "profile.js");
  await git(root, "commit", "-m", "profile");

  assert.deepEqual(await collectGitChangedFiles({ cwd: root, base }), ["profile.js"]);

  const beforeRename = (await git(root, "rev-parse", "HEAD")).trim();
  await mkdir(path.join(root, "src"));
  await git(root, "mv", "profile.js", "src/profile.js");
  await git(root, "commit", "-m", "move profile");
  assert.deepEqual(await collectGitChangedFiles({ cwd: root, base: beforeRename }), [
    "profile.js",
    "src/profile.js"
  ]);

  const beforeDelete = (await git(root, "rev-parse", "HEAD")).trim();
  await git(root, "rm", "src/profile.js");
  await git(root, "commit", "-m", "delete profile");
  assert.deepEqual(await collectGitChangedFiles({ cwd: root, base: beforeDelete }), [
    "src/profile.js"
  ]);
});

test("invalidate CLI writes a deterministic CI plan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-invalidate-"));
  const walkthroughFile = path.join(root, "walkthrough.json");
  const mapFile = path.join(root, "dependency-map.json");
  const outputFile = path.join(root, "invalidation-plan.json");
  await Promise.all([
    writeFile(walkthroughFile, JSON.stringify(walkthrough)),
    writeFile(mapFile, JSON.stringify(dependencyMap))
  ]);
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(message);
  try {
    const exitCode = await run([
      "invalidate",
      walkthroughFile,
      "--map", mapFile,
      "--changed-file", "fixtures/demo-app/profile-content.js",
      "--output", outputFile
    ]);
    assert.equal(exitCode, 0);
  } finally {
    console.log = originalLog;
  }
  const written = JSON.parse(await readFile(outputFile, "utf8"));
  assert.deepEqual(written.summary.regenerate, ["update-profile"]);
  assert.deepEqual(JSON.parse(messages[0]), written);
});

test("invalidate CLI returns status 2 when review is required", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-invalidate-review-"));
  const walkthroughFile = path.join(root, "walkthrough.json");
  const mapFile = path.join(root, "dependency-map.json");
  await Promise.all([
    writeFile(walkthroughFile, JSON.stringify(walkthrough)),
    writeFile(mapFile, JSON.stringify(dependencyMap))
  ]);
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(message);
  try {
    const exitCode = await run([
      "invalidate",
      walkthroughFile,
      "--map", mapFile,
      "--changed-file", "src/unmapped.js"
    ]);
    assert.equal(exitCode, 2);
  } finally {
    console.log = originalLog;
  }
  assert.equal(JSON.parse(messages[0]).reviewRequired, true);
});

function moduleFixture(id, title, dependencies) {
  return {
    id,
    title,
    route: "/",
    steps: [{ id: "open", action: "goto", description: "Open page." }],
    dependencies,
    assets: {}
  };
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return stdout;
}
