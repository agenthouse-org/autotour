import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const headingAnchor = (heading) => heading
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s-]/gu, "")
  .trim()
  .replace(/\s+/g, "-");

const assertHeadingIndex = (markdown, file) => {
  const headings = [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim());
  assert.ok(headings.length > 0, `${file} should contain headings`);
  assert.equal(headings[1], "Content", `${file} should begin with a Content section`);
  for (const heading of headings) {
    assert.ok(markdown.includes(`](#${headingAnchor(heading)})`), `${file} should index "${heading}"`);
  }
};

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
  const files = [
    "skills/create-autotour/SKILL.md",
    "skills/create-autotour/references/output-modes.md",
    "skills/create-autotour/references/maintenance.md",
    "skills/create-autotour/references/motion-ad.md",
    "skills/create-autotour/references/onboarding.md",
    "skills/create-autotour/references/connections.md",
    "skills/create-autotour/references/documentation-spec.md"
  ];
  const [skill, ...references] = await Promise.all(files.map((file) => readFile(file, "utf8")));
  assert.match(skill, /^---\r?\nname: create-autotour/m);
  assert.match(skill, /description:/);
  assertHeadingIndex(skill.replace(/^---[\s\S]*?---\r?\n/, ""), files[0]);
  references.forEach((reference, index) => assertHeadingIndex(reference, files[index + 1]));
});

test("the example dependency map is schema-valid", async () => {
  const { validateDependencyMapDocument } = await import("../src/invalidation/index.js");
  const dependencyMap = await readJson("examples/dependency-map.json");
  const result = await validateDependencyMapDocument(dependencyMap);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("external connections are declared and included in the package", async () => {
  const [pkg, portable, codex, mcp, apps] = await Promise.all([
    readJson("package.json"), readJson("plugin.json"), readJson(".codex-plugin/plugin.json"),
    readJson("mcp.json"), readJson(".app.json")
  ]);
  assert.equal(portable.extensions["com.openai"].apps, "./.app.json");
  assert.equal(codex.apps, "./.app.json");
  for (const file of ["mcp.json", ".app.json", "INSTALL.md"]) assert.ok(pkg.files.includes(file));
  for (const server of Object.values(mcp.mcpServers)) {
    assert.equal(server.type, "streamable-http");
    assert.equal(new URL(server.url).protocol, "https:");
    assert.equal(server.headers, undefined, "do not bundle credentials");
  }
  assert.equal(apps.apps.atlassian.required, false);
  assert.equal(apps.apps.github.required, false);
  assert.equal(mcp.mcpServers.linkedin, undefined, "no unverified LinkedIn endpoint");
});
