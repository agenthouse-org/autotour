import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

test("agent manifests share package identity", async () => {
  const [pkg, portable, codex, claude] = await Promise.all([
    readJson("package.json"),
    readJson("plugin.json"),
    readJson(".codex-plugin/plugin.json"),
    readJson(".claude-plugin/plugin.json")
  ]);

  for (const manifest of [portable, codex, claude]) {
    assert.equal(manifest.name, pkg.name);
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.license, pkg.license);
  }
});

test("the portable package contains a valid skill", async () => {
  const skill = await readFile("skills/create-autotour/SKILL.md", "utf8");
  assert.match(skill, /^---\r?\nname: create-autotour/m);
  assert.match(skill, /description:/);
});

test("the example dependency map is schema-valid", async () => {
  const { validateDependencyMapDocument } = await import("../src/invalidation/index.js");
  const dependencyMap = await readJson("examples/dependency-map.json");
  const result = await validateDependencyMapDocument(dependencyMap);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
