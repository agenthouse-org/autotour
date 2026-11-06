import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { run } from "../../src/cli.js";
import { generateDocumentation } from "../../src/documentation/generate.js";
import { prepareDocumentationCapture, readDocumentationSpec, validateDocumentationSpec } from "../../src/documentation/spec.js";
import { syncMarkdownScreenshots } from "../../src/publishing/index.js";

const example = await readDocumentationSpec("examples/documentation.json");

function screenshot(stepId, sourceView, alt, caption) {
  return { kind: "screenshot", stepId, sourceView, timing: "after", alt, caption };
}

test("a text chapter can exist before its journey module, and a planned screenshot need not exist yet", async () => {
  const journey = {
    schemaVersion: 1,
    id: "profile-docs",
    modules: [{ id: "profile", steps: [{ id: "save" }], dependencies: { views: ["Profile"] } }]
  };
  const dependencyMap = { schemaVersion: 1, rules: [{ id: "profile", files: ["src/profile/**"], dependencies: { views: ["Profile"] } }] };
  const text = {
    schemaVersion: 1,
    walkthroughId: "profile-docs",
    journey,
    dependencyMap,
    sections: [{
      moduleId: "reader-guide",
      heading: "Before you begin",
      status: "text",
      blocks: [{ kind: "text", text: "Read this first." }]
    }]
  };
  assert.equal((await validateDocumentationSpec(text, { journey, dependencyMap })).valid, true);

  const withShot = structuredClone(text);
  withShot.sections[0].blocks.push(screenshot("welcome", "Guide", "Welcome", "Start here."));
  const proseOnly = await validateDocumentationSpec(withShot, { journey, dependencyMap });
  assert.equal(proseOnly.valid, false);
  assert.match(proseOnly.errors.map(error => error.message).join("\n"), /reader-guide: a text chapter can only contain prose/);

  const planned = structuredClone(text);
  planned.sections.push({
    moduleId: "billing",
    heading: "Billing",
    status: "planned",
    blocks: [screenshot("open-billing", "Billing", "Billing page", "Invoices appear here.")]
  });
  assert.equal((await validateDocumentationSpec(planned, { journey, dependencyMap })).valid, true);

  const ready = structuredClone(text);
  ready.sections = [{
    moduleId: "profile",
    heading: "Profile",
    blocks: [{ kind: "text", text: "Update your profile." }]
  }];
  const missingDependency = await validateDocumentationSpec(ready, { journey, dependencyMap });
  assert.equal(missingDependency.valid, false);
  assert.match(missingDependency.errors.map(error => error.message).join("\n"), /profile: a ready chapter needs at least one recorded dependency/);

  const unknown = structuredClone(example.spec);
  unknown.sections[0].status = "draft";
  assert.equal((await validateDocumentationSpec(unknown)).valid, false);
});

test("capture preparation skips text chapters and planned steps that are not in the journey", async () => {
  const input = structuredClone(example);
  input.spec.sections.push({
    moduleId: "reader-guide",
    heading: "Before you begin",
    status: "text",
    blocks: [{ kind: "text", text: "This chapter is prose only." }]
  });
  input.spec.sections.push({
    moduleId: "billing",
    heading: "Billing",
    status: "planned",
    blocks: [screenshot("open-billing", "Billing", "Billing page", "Invoices appear here.")]
  });
  const prepared = await prepareDocumentationCapture(input);
  const saved = prepared.journey.modules[0].steps.find(step => step.id === "fill-display-name");
  assert.equal(saved.annotation.caption, input.spec.sections[0].blocks[1].caption);
  assert.equal(prepared.journey.modules.some(module => module.id === "billing" || module.id === "reader-guide"), false);

  const plannedStep = structuredClone(example);
  plannedStep.spec.sections[0].status = "planned";
  plannedStep.spec.sections[0].blocks[1].stepId = "not-captured";
  const skipped = await prepareDocumentationCapture(plannedStep);
  assert.equal(skipped.journey.modules[0].steps.every(step => step.annotation === undefined), true);
});

test("draft generation keeps prose and shows a placeholder until the screenshot exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-draft-chapters-"));
  const captureDir = path.join(root, "capture");
  await mkdir(path.join(captureDir, "modules/profile/screenshots"), { recursive: true });
  await writeFile(path.join(captureDir, "modules/profile/screenshots/save.png"), "image");
  const walkthroughFile = path.join(captureDir, "walkthrough.json");
  const walkthrough = {
    schemaVersion: 1,
    id: "profile-docs",
    title: "Profile documentation",
    modules: [{
      id: "profile",
      title: "Profile",
      steps: [{ id: "save", action: "click" }],
      dependencies: { views: ["Profile"] },
      assets: { screenshots: ["modules/profile/screenshots/save.png"] }
    }]
  };
  const dependencyMap = { schemaVersion: 1, rules: [{ id: "profile", files: ["src/profile/**"], dependencies: { views: ["Profile"] } }] };
  const spec = {
    schemaVersion: 1,
    walkthroughId: "profile-docs",
    journey: walkthrough,
    dependencyMap,
    targets: [{ kind: "markdown", path: "docs/profile.md" }, { kind: "html", path: "site/index.html" }],
    sections: [
      {
        moduleId: "reader-guide",
        heading: "Before you begin",
        status: "text",
        blocks: [{ kind: "text", text: "This chapter is prose only." }]
      },
      {
        moduleId: "profile",
        heading: "Profile",
        status: "planned",
        blocks: [screenshot("save", "Profile", "Saved profile", "The profile was saved.")]
      },
      {
        moduleId: "billing",
        heading: "Billing",
        status: "planned",
        blocks: [screenshot("open-billing", "Billing", "Billing page", "Invoices appear here.")]
      }
    ]
  };
  await writeFile(walkthroughFile, JSON.stringify(walkthrough));
  await generateDocumentation({ spec, specPath: path.join(root, "documentation.json"), walkthrough, walkthroughFile, outputRoot: root });
  const markdown = await readFile(path.join(root, "docs/profile.md"), "utf8");
  const html = await readFile(path.join(root, "site/index.html"), "utf8");
  assert.match(markdown, /This chapter is prose only\./);
  assert.match(markdown, /!\[Saved profile\]\(assets\/autotour\/profile-docs\/profile\/save\.png\)/);
  assert.match(markdown, /> Screenshot not captured yet\./);
  assert.match(markdown, /> Step: open-billing/);
  assert.match(markdown, /> Billing page/);
  assert.match(markdown, /> Invoices appear here\./);
  assert.doesNotMatch(markdown, /open-billing\.png/);
  assert.match(html, /This chapter is prose only\./);
  assert.match(html, /<img src="assets\/profile\/save\.png"/);
  assert.match(html, /<figure class="autotour-placeholder"><p>Screenshot not captured yet\.<\/p><p>Step: open-billing<\/p><p>Billing page<\/p><figcaption>Invoices appear here\.<\/figcaption><\/figure>/);
  assert.equal(await readFile(path.join(root, "docs/assets/autotour/profile-docs/profile/save.png"), "utf8"), "image");
  await assert.rejects(readFile(path.join(root, "docs/assets/autotour/profile-docs/billing/open-billing.png")));

  await rm(path.join(captureDir, "modules/profile/screenshots/save.png"));
  const ready = structuredClone(spec);
  ready.sections = [{
    moduleId: "profile",
    heading: "Profile",
    dependencies: { views: ["Profile"] },
    blocks: [screenshot("save", "Profile", "Saved profile", "The profile was saved.")]
  }];
  await assert.rejects(
    generateDocumentation({ spec: ready, walkthrough, walkthroughFile, outputRoot: root }),
    /profile: screenshot for step save has not been captured \(modules\/profile\/screenshots\/save\.png\)\. Capture it, or run with --draft/
  );
  await generateDocumentation({ spec: ready, walkthrough, walkthroughFile, outputRoot: root, draft: true, targets: ["markdown"] });
  assert.match(await readFile(path.join(root, "docs/profile.md"), "utf8"), /> Screenshot not captured yet\./);

  const unknown = structuredClone(ready);
  unknown.sections[0].moduleId = "missing-module";
  await assert.rejects(
    generateDocumentation({ spec: unknown, walkthrough, walkthroughFile, outputRoot: root, draft: true }),
    /Unknown module missing-module/
  );
});

test("sync-markdown still refuses a planned chapter whose screenshot was not captured", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-draft-sync-"));
  const output = path.join(root, "output");
  const sourceDir = path.join(output, "modules/profile-settings/screenshots");
  await mkdir(sourceDir, { recursive: true });
  const walkthrough = structuredClone(example.journey);
  walkthrough.publish = true;
  walkthrough.modules[0].publish = true;
  walkthrough.modules[0].assets.screenshots = [];
  const markdownFile = path.join(root, "profile.md");
  const original = "Hand-written introduction.\n<!-- autotour:module=profile-settings:start -->\nold\n<!-- autotour:module=profile-settings:end -->\nHand-written ending.\n";
  await writeFile(markdownFile, original);
  const spec = structuredClone(example.spec);
  spec.sections[0].status = "planned";
  await assert.rejects(syncMarkdownScreenshots({
    walkthrough,
    walkthroughFile: path.join(output, "walkthrough.json"),
    markdownFile,
    assetsDir: path.join(root, "assets"),
    documentationSpec: spec,
    openApiDocuments: example.openApiDocuments
  }), /No captured screenshot for profile-settings\/fill-display-name/);
  assert.equal(await readFile(markdownFile, "utf8"), original);
  assert.doesNotMatch(original, /Screenshot not captured yet/);
});

test("run-docs accepts --draft", async () => {
  const originalError = console.error;
  let message = "";
  console.error = (value) => { message = String(value); };
  try {
    assert.equal(await run(["run-docs", "examples/documentation.json", "--draft"]), 1);
    assert.doesNotMatch(message, /Unknown run-docs option/);
    assert.match(message, /Storage choices are missing/);
  } finally {
    console.error = originalError;
  }
});
