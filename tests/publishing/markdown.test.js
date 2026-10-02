import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { run } from "../../src/cli.js";
import { PublishingError, syncMarkdownScreenshots } from "../../src/publishing/index.js";

test("synchronizes screenshots while preserving Markdown outside managed regions", async () => {
  const fixture = await createFixture();
  const prefix = "# Profile guide\r\n\r\nHand-written introduction.\r\n";
  const suffix = "\r\nHand-written ending.\r\n";
  await writeFile(
    fixture.markdownFile,
    `${prefix}<!-- autotour:module=open-profile:start -->\r\nold image\r\n<!-- autotour:module=open-profile:end -->${suffix}`
  );
  const result = await syncMarkdownScreenshots(fixture.options);
  const markdown = await readFile(fixture.markdownFile, "utf8");
  assert.equal(result.status, "changed");
  assert.deepEqual(result.modules, ["open-profile"]);
  assert.equal(markdown.startsWith(prefix), true);
  assert.equal(markdown.endsWith(suffix), true);
  assert.match(markdown, /!\[Open profile\]\(assets\/profile-tour\/open-profile\/01-profile\.png\)/);
  assert.deepEqual(
    await readFile(path.join(fixture.assetsDir, "profile-tour/open-profile/01-profile.png")),
    Buffer.from("profile-image")
  );
  assert.equal(markdown.includes("\r\nold image\r\n"), false);
});

test("supports multiple screenshots and is idempotent", async () => {
  const fixture = await createFixture({ screenshotNames: ["profile.png", "saved.png"] });
  const first = await syncMarkdownScreenshots(fixture.options);
  const firstMarkdown = await readFile(fixture.markdownFile, "utf8");
  const second = await syncMarkdownScreenshots(fixture.options);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(await readFile(fixture.markdownFile, "utf8"), firstMarkdown);
  assert.match(firstMarkdown, /!\[Open profile 1\]/);
  assert.match(firstMarkdown, /!\[Open profile 2\]/);
});

test("dry-run reports changes without writing Markdown or assets", async () => {
  const fixture = await createFixture();
  const before = await readFile(fixture.markdownFile, "utf8");
  const result = await syncMarkdownScreenshots({ ...fixture.options, dryRun: true });
  assert.equal(result.changed, true);
  assert.equal(result.dryRun, true);
  assert.match(result.renderedMarkdown, /01-profile\.png/);
  assert.equal(await readFile(fixture.markdownFile, "utf8"), before);
  await assert.rejects(readFile(result.assets[0].destination), /ENOENT/);
});

test("requires explicit walkthrough and module publication", async () => {
  const fixture = await createFixture();
  fixture.walkthrough.publish = false;
  await assert.rejects(
    syncMarkdownScreenshots(fixture.options),
    (error) => error instanceof PublishingError && error.code === "AUTOTOUR_NOT_PUBLISHABLE"
  );
  fixture.walkthrough.publish = true;
  fixture.walkthrough.modules[0].publish = false;
  await assert.rejects(
    syncMarkdownScreenshots(fixture.options),
    (error) => error instanceof PublishingError && error.code === "AUTOTOUR_NOT_PUBLISHABLE"
  );
});

test("rejects unsafe marker structures before changing Markdown", async (t) => {
  const cases = [
    ["duplicate", markerBlock("open-profile") + markerBlock("open-profile"), "AUTOTOUR_DUPLICATE_MARKER"],
    ["nested", "<!-- autotour:module=open-profile:start -->\n<!-- autotour:module=save-profile:start -->\n", "AUTOTOUR_NESTED_MARKER"],
    ["unknown", markerBlock("missing"), "AUTOTOUR_UNKNOWN_MODULE"],
    ["unpaired", "<!-- autotour:module=open-profile:start -->\n", "AUTOTOUR_UNPAIRED_MARKER"],
    ["malformed", "<!-- autotour:module=open-profile:wat -->\n", "AUTOTOUR_INVALID_MARKER"]
  ];
  for (const [name, markdown, code] of cases) {
    await t.test(name, async () => {
      const fixture = await createFixture({ includeSecondModule: true });
      await writeFile(fixture.markdownFile, markdown);
      await assert.rejects(
        syncMarkdownScreenshots(fixture.options),
        (error) => error instanceof PublishingError && error.code === code
      );
      assert.equal(await readFile(fixture.markdownFile, "utf8"), markdown);
    });
  }
});

test("rejects missing and escaping screenshot sources before changing Markdown", async () => {
  const fixture = await createFixture();
  const before = await readFile(fixture.markdownFile, "utf8");
  fixture.walkthrough.modules[0].assets.screenshots = ["../outside.png"];
  await assert.rejects(
    syncMarkdownScreenshots(fixture.options),
    (error) => error.code === "AUTOTOUR_UNSAFE_ASSET_PATH"
  );
  assert.equal(await readFile(fixture.markdownFile, "utf8"), before);
  fixture.walkthrough.modules[0].assets.screenshots = ["captures/missing.png"];
  await assert.rejects(
    syncMarkdownScreenshots(fixture.options),
    (error) => error.code === "AUTOTOUR_MISSING_ASSET"
  );
  assert.equal(await readFile(fixture.markdownFile, "utf8"), before);

  fixture.walkthrough.modules[0].assets.screenshots = ["https://example.test/profile.png"];
  await assert.rejects(
    syncMarkdownScreenshots(fixture.options),
    (error) => error.code === "AUTOTOUR_UNSAFE_ASSET_PATH"
  );
  assert.equal(await readFile(fixture.markdownFile, "utf8"), before);
});

test("rejects incompatible destination entries before changing Markdown", async () => {
  const fixture = await createFixture();
  const before = await readFile(fixture.markdownFile, "utf8");
  await mkdir(fixture.assetsDir, { recursive: true });
  await writeFile(path.join(fixture.assetsDir, "profile-tour"), "not a directory");
  await assert.rejects(
    syncMarkdownScreenshots(fixture.options),
    (error) => error.code === "AUTOTOUR_UNSAFE_DESTINATION"
  );
  assert.equal(await readFile(fixture.markdownFile, "utf8"), before);
});

test("sync-markdown CLI supports CI check mode and machine-readable output", async () => {
  const fixture = await createFixture();
  await writeFile(fixture.walkthroughFile, JSON.stringify(fixture.walkthrough));
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message) => logs.push(message);
  console.error = (message) => errors.push(message);
  try {
    const args = ["sync-markdown", fixture.walkthroughFile, "--markdown", fixture.markdownFile, "--assets-dir", fixture.assetsDir];
    assert.equal(await run([...args, "--check"]), 2);
    assert.equal(JSON.parse(logs.pop()).changed, true);
    assert.equal(await run(args), 0);
    assert.equal(JSON.parse(logs.pop()).status, "changed");
    assert.equal(await run([...args, "--check"]), 0);
    assert.equal(JSON.parse(logs.pop()).changed, false);
    assert.deepEqual(errors, []);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

async function createFixture({ screenshotNames = ["profile.png"], includeSecondModule = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-markdown-"));
  const outputDir = path.join(root, "output");
  const capturesDir = path.join(outputDir, "captures");
  const docsDir = path.join(root, "docs");
  const assetsDir = path.join(docsDir, "assets");
  const walkthroughFile = path.join(outputDir, "walkthrough.json");
  const markdownFile = path.join(docsDir, "profile.md");
  await Promise.all([mkdir(capturesDir, { recursive: true }), mkdir(docsDir, { recursive: true })]);
  for (const name of screenshotNames) {
    await writeFile(path.join(capturesDir, name), name === "profile.png" ? "profile-image" : "saved-image");
  }
  const modules = [createModule("open-profile", "Open profile", screenshotNames)];
  if (includeSecondModule) modules.push(createModule("save-profile", "Save profile", ["profile.png"]));
  const walkthrough = {
    schemaVersion: 1,
    id: "profile-tour",
    title: "Profile tour",
    target: { baseUrl: "https://example.test", goal: "Update a profile." },
    publish: true,
    outputs: ["screenshots"],
    modules
  };
  await writeFile(markdownFile, `Before\n${markerBlock("open-profile")}After\n`);
  return {
    assetsDir,
    walkthroughFile,
    markdownFile,
    walkthrough,
    options: { walkthrough, walkthroughFile, markdownFile, assetsDir }
  };
}

function createModule(id, title, screenshotNames) {
  return {
    id,
    title,
    route: "/settings/profile",
    publish: true,
    steps: [{ id: "visit-profile", action: "goto", description: "Open profile." }],
    dependencies: {},
    assets: { screenshots: screenshotNames.map((name) => `captures/${name}`) }
  };
}

function markerBlock(moduleId) {
  return `<!-- autotour:module=${moduleId}:start -->\nold\n<!-- autotour:module=${moduleId}:end -->\n`;
}
