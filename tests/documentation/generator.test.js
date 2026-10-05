import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateDocumentation } from "../../src/documentation/generate.js";

test("generates selected Markdown, HTML, and Confluence plan targets from one definition", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-doc-run-"));
  const captureDir = path.join(root, "capture");
  await mkdir(path.join(captureDir, "modules/profile/screenshots"), { recursive: true });
  await writeFile(path.join(captureDir, "modules/profile/screenshots/save.png"), "image");
  const walkthroughFile = path.join(captureDir, "walkthrough.json");
  const walkthrough = {
    schemaVersion: 1,
    id: "profile-docs",
    title: "Profile documentation",
    modules: [{ id: "profile", title: "Profile", steps: [{ id: "save", action: "click" }], dependencies: { views: ["Profile"] }, assets: { screenshots: ["modules/profile/screenshots/save.png"] } }]
  };
  const spec = {
    schemaVersion: 1,
    walkthroughId: "profile-docs",
    journey: walkthrough,
    dependencyMap: { schemaVersion: 1, rules: [{ id: "profile", files: ["src/profile/**"], dependencies: { views: ["Profile"] } }] },
    targets: [{ kind: "markdown", path: "docs/profile.md" }, { kind: "html", path: "site/index.html", mode: "single-file" }, { kind: "confluence", siteUrl: "https://example.atlassian.net", pageId: "42" }],
    sections: [{ moduleId: "profile", heading: "Profile", dependencies: { views: ["Profile"] }, blocks: [
      { kind: "text", text: "Update your profile." },
      { kind: "screenshot", stepId: "save", sourceView: "Profile", timing: "after", alt: "Profile form", caption: "Save the form." }
    ] }]
  };
  await writeFile(walkthroughFile, JSON.stringify(walkthrough));
  const result = await generateDocumentation({ spec, specPath: path.join(root, "documentation.json"), walkthrough, walkthroughFile, outputRoot: root });
  assert.deepEqual(result.targets.map(target => target.kind), ["markdown", "html", "confluence"]);
  assert.match(await readFile(path.join(root, "docs/profile.md"), "utf8"), /!\[Profile form\]\(assets\/autotour\/profile-docs\/profile\/save\.png\)/);
  assert.match(await readFile(path.join(root, "site/index.html"), "utf8"), /<img src="assets\/profile\/save\.png"/);
  assert.equal(JSON.parse(await readFile(path.join(root, "confluence-42.json"), "utf8")).pageId, "42");
  await writeFile(path.join(root, "docs/profile.md"), "Intro\n<!-- autotour:module=profile:start -->\nold\n<!-- autotour:module=profile:end -->\nOutro\n");
  await generateDocumentation({ spec, specPath: path.join(root, "documentation.json"), walkthrough, walkthroughFile, outputRoot: root, targets: ["markdown"], mode: "adapt" });
  const adapted = await readFile(path.join(root, "docs/profile.md"), "utf8");
  assert.match(adapted, /^Intro/);
  assert.match(adapted, /Outro/);
  assert.doesNotMatch(adapted, /\nold\n/);
});

