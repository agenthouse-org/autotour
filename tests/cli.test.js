import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject, validateWalkthrough } from "../src/project.js";

test("initializes a project without embedding credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-"));
  const configPath = await initializeProject(root);
  const config = JSON.parse(await readFile(configPath, "utf8"));

  assert.equal(config.auth.usernameEnv, "AUTOTOUR_USERNAME");
  assert.equal(config.auth.passwordEnv, "AUTOTOUR_PASSWORD");
  assert.equal(JSON.stringify(config).includes("password\":"), false);
});

test("does not overwrite project configuration unless forced", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-"));
  await initializeProject(root);
  await assert.rejects(() => initializeProject(root), { code: "EEXIST" });
});

test("validates the example modular walkthrough", async () => {
  const file = path.resolve("examples", "walkthrough.json");
  const result = await validateWalkthrough(file);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
