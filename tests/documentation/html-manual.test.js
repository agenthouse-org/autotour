import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateDocumentation } from "../../src/documentation/generate.js";
import { renderMarkdown } from "../../src/documentation/markdown.js";

test("renders manual prose and escapes author HTML", () => {
  const html = renderMarkdown([
    "## Save the profile",
    "",
    "Use **Save** and *review* the form.",
    "",
    "- Name",
    "- Email",
    "",
    "| Field | Required |",
    "| --- | --- |",
    "| Name | Yes |",
    "",
    "> [!NOTE]",
    "> Empty secret fields stay visible.",
    "",
    "<script>alert(1)</script>",
    "",
    "[docs](javascript:alert(1)) and [site](https://example.com/manual)"
  ].join("\n"));
  assert.match(html, /<h2>Save the profile<\/h2>/);
  assert.match(html, /<strong>Save<\/strong>/);
  assert.match(html, /<em>review<\/em>/);
  assert.match(html, /<ul><li>Name<\/li><li>Email<\/li><\/ul>/);
  assert.match(html, /<th>Field<\/th>.*<td>Yes<\/td>/s);
  assert.match(html, /<aside class="autotour-note" data-type="note">/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<a href="https:\/\/example.com\/manual">site<\/a>/);
});

test("site HTML links image files and single-file HTML embeds them in the declared language", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-html-manual-"));
  const captureDir = path.join(root, "capture");
  await mkdir(path.join(captureDir, "modules/profile/screenshots"), { recursive: true });
  await writeFile(path.join(captureDir, "modules/profile/screenshots/save.png"), "image");
  const walkthroughFile = path.join(captureDir, "walkthrough.json");
  const walkthrough = {
    schemaVersion: 1,
    id: "profile-docs",
    title: "Profile documentation",
    language: "en",
    modules: [{ id: "profile", title: "Profile", steps: [{ id: "save", action: "click" }], dependencies: { views: ["Profile"] }, assets: { screenshots: ["modules/profile/screenshots/save.png"] } }]
  };
  const spec = {
    schemaVersion: 1,
    walkthroughId: "profile-docs",
    language: "de",
    journey: walkthrough,
    dependencyMap: { schemaVersion: 1, rules: [{ id: "profile", files: ["src/profile/**"], dependencies: { views: ["Profile"] } }] },
    targets: [{ kind: "html", path: "site/index.html", mode: "site" }],
    sections: [{ moduleId: "profile", heading: "Profil", dependencies: { views: ["Profile"] }, blocks: [
      { kind: "text", text: "## Speichern\n\nKlicken Sie auf **Speichern**." },
      { kind: "screenshot", stepId: "save", sourceView: "Profile", timing: "after", alt: "Profil", caption: "Gespeichert." }
    ] }]
  };
  await writeFile(walkthroughFile, JSON.stringify(walkthrough));
  await generateDocumentation({ spec, specPath: path.join(root, "documentation.json"), walkthrough, walkthroughFile, outputRoot: root });
  const site = await readFile(path.join(root, "site/index.html"), "utf8");
  assert.match(site, /<html lang="de">/);
  assert.match(site, /<h2>Speichern<\/h2>/);
  assert.match(site, /<strong>Speichern<\/strong>/);
  assert.match(site, /<img src="assets\/profile\/save\.png"/);
  assert.equal(await readFile(path.join(root, "site/assets/profile/save.png"), "utf8"), "image");
  assert.match(site, /break-inside:avoid/);

  const singleSpec = { ...spec, targets: [{ kind: "html", path: "manual.html", mode: "single-file" }] };
  delete singleSpec.language;
  await generateDocumentation({ spec: singleSpec, specPath: path.join(root, "documentation.json"), walkthrough, walkthroughFile, outputRoot: root });
  const single = await readFile(path.join(root, "manual.html"), "utf8");
  assert.match(single, /<html lang="en">/);
  assert.match(single, /<img src="data:image\/png;base64,aW1hZ2U="/);
  await assert.rejects(access(path.join(root, "assets/profile/save.png")), { code: "ENOENT" });
});
