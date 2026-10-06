import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import { initializeProject, configureStorage, readStorageConfiguration } from "../src/project.js";

const defaults = { output: ".autotour/output", documentationOutput: ".autotour/output/documentation", artifacts: "local", documentation: "local", gitignore: "keep" };
const cli = path.resolve("bin/autotour.js");
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-storage-"));
  await initializeProject(root);
  return root;
}

test("initialization and unconfigured run-docs never create delivery folders or ignore files", async () => {
  const root = await fixture();
  assert.deepEqual(await readdir(root), [".autotour"]);
  assert.deepEqual((await readdir(path.join(root, ".autotour"))).sort(), ["autotour.json", "walkthroughs"]);
  await assert.rejects(readStorageConfiguration(root), /Storage choices are missing/);
  const result = spawnSync(process.execPath, [cli, "run-docs", "documentation.json"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Ask where captures and documentation should live/);
  assert.deepEqual(await readdir(root), [".autotour"]);
});

test("storage choices persist without ignore changes when permission is declined", async () => {
  const root = await fixture();
  await writeFile(path.join(root, ".gitignore"), "# user rules\ncustom/\n");
  const external = await mkdtemp(path.join(os.tmpdir(), "autotour-delivery-"));
  const saved = await configureStorage(root, { ...defaults, documentationOutput: external });
  assert.match(saved.note, /may still appear in Git/);
  const config = await readStorageConfiguration(root);
  assert.equal(config.documentationOutput, external);
  assert.equal(config.output, path.join(root, ".autotour/output"));
  assert.equal(await readFile(path.join(root, ".gitignore"), "utf8"), "# user rules\ncustom/\n");
  assert.deepEqual(await readdir(external), []);
  const schema = JSON.parse(await readFile(new URL("../schemas/project.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const raw = JSON.parse(await readFile(saved.configPath, "utf8"));
  assert.ok(validate(raw), JSON.stringify(validate.errors));
});

test("approved ignore edits are narrow, idempotent and preserve source and versioned destinations", async () => {
  const root = await fixture();
  await writeFile(path.join(root, ".gitignore"), "custom/\n");
  const choices = { ...defaults, documentationOutput: "docs/product", documentation: "versioned", gitignore: "modify" };
  await configureStorage(root, choices);
  await configureStorage(root, choices);
  assert.equal(await readFile(path.join(root, ".gitignore"), "utf8"), "custom/\n# AutoTour generated/local files\n/.autotour/output/\n");
  assert.deepEqual((await readdir(root)).sort(), [".autotour", ".gitignore"]);
  await assert.rejects(configureStorage(root, { ...defaults, documentation: "versioned" }), /versioned folder cannot/);
  await assert.rejects(configureStorage(root, { ...defaults, gitignore: undefined }), /explicit user choice/);
});

test("CLI persists choices and rejects unapproved destination overrides before capture", async () => {
  const root = await fixture();
  const configured = spawnSync(process.execPath, [cli, "configure-storage", "--output", defaults.output, "--documentation-output", defaults.documentationOutput, "--artifacts", "local", "--documentation", "local", "--gitignore", "keep"], { cwd: root, encoding: "utf8" });
  assert.equal(configured.status, 0, configured.stderr);
  for (const option of ["--output-dir", "--capture-dir"]) {
    const result = spawnSync(process.execPath, [cli, "run-docs", "missing.json", option, "docs"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Ask the user/);
  }
  assert.deepEqual(await readdir(root), [".autotour"]);
});
