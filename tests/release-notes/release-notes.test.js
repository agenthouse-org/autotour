import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { run } from "../../src/cli.js";
import {
  approveReleaseNotes,
  createReleaseNotes,
  renderReleaseNotes,
  validateReleaseNotesDocument
} from "../../src/release-notes/index.js";
import { collectGitChangedFiles, createInvalidationPlan } from "../../src/invalidation/index.js";

const execFileAsync = promisify(execFile);
const pngBefore = Buffer.from("89504e470d0a1a0a6265666f7265", "hex");
const pngAfter = Buffer.from("89504e470d0a1a0a6166746572", "hex");

const walkthrough = {
  schemaVersion: 1,
  id: "update-display-name",
  title: "Update display name",
  target: { baseUrl: "https://example.test", goal: "Update a profile." },
  outputs: ["screenshots"],
  modules: [
    moduleFixture("sign-in", "Sign in", { views: ["LoginPage"] }, ["modules/sign-in/screenshots/open.png"]),
    moduleFixture("update-profile", "Update profile", { views: ["ProfileSettings"] }, ["modules/update-profile/screenshots/open.png"]),
    moduleFixture("billing", "Billing", { views: ["BillingPage"] }, ["modules/billing/screenshots/open.png"])
  ]
};

const dependencyMap = {
  schemaVersion: 1,
  rules: [
    { id: "profile", files: ["app/profile-*.js"], dependencies: { views: ["ProfileSettings"] } },
    { id: "login", files: ["app/login.js"], dependencies: { views: ["LoginPage"] } },
    { id: "billing", files: ["app/billing.js"], dependencies: { views: ["BillingPage"] } },
    { id: "tooling", files: ["tools/**"], dependencies: { backend: ["BuildTooling"] } }
  ]
};

async function fixtureRepository({ lint = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-release-notes-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "AutoTour Test");
  await git(root, "config", "user.email", "autotour@example.test");
  await git(root, "config", "commit.gpgsign", "false");
  const docs = path.join(root, "docs", "tour");
  await mkdir(path.join(docs, "modules", "update-profile", "screenshots"), { recursive: true });
  await mkdir(path.join(root, "app"), { recursive: true });
  await mkdir(path.join(root, "work"), { recursive: true });
  await writeFile(path.join(docs, "walkthrough.json"), JSON.stringify(walkthrough));
  await writeFile(path.join(root, "dependency-map.json"), JSON.stringify(dependencyMap));
  await writeFile(path.join(docs, "modules", "update-profile", "screenshots", "open.png"), pngBefore);
  await writeFile(path.join(root, "app", "profile-form.js"), "export const v = 1;\n");
  await writeFile(path.join(root, "work", "ST-7.json"), JSON.stringify({
    id: "ST-7", title: "Rename display name field", fields: { outcome: "Users see a clearer label." }
  }));
  await writeFile(path.join(root, "work", "core.json"), JSON.stringify({ id: "core", title: "Core" }));
  await git(root, "add", ".");
  await git(root, "commit", "-q", "-m", "initial");
  await git(root, "tag", "v1");

  await writeFile(path.join(root, "app", "profile-form.js"), "export const v = 2;\n");
  await git(root, "add", ".");
  await git(root, "commit", "-q", "-m", "ST-7 rename the display name label");
  await writeFile(path.join(root, "app", "billing.js"), "export const b = 1;\n");
  await git(root, "add", ".");
  await git(root, "commit", "-q", "-m", "Add billing page", "-m", "Work-Item: core");
  if (lint) {
    await mkdir(path.join(root, "tools"), { recursive: true });
    await writeFile(path.join(root, "tools", "lint.js"), "// lint\n");
    await git(root, "add", ".");
    await git(root, "commit", "-q", "-m", "Tighten lint rules");
  }
  // The new capture is left uncommitted, as after a local recapture.
  await writeFile(path.join(docs, "modules", "update-profile", "screenshots", "open.png"), pngAfter);
  return { root, docs };
}

async function draft(root, docs, extra = {}) {
  return createReleaseNotes({
    cwd: root,
    walkthrough,
    dependencyMap,
    base: "v1",
    head: "HEAD",
    outputDir: path.join(root, "out", "notes"),
    assetsDir: docs,
    workDir: path.join(root, "work"),
    ...extra
  });
}

test("range-mapping: every commit is listed with the modules invalidate assigns", async () => {
  const { root, docs } = await fixtureRepository();
  const { notes } = await draft(root, docs);

  assert.deepEqual(notes.commits.map(commit => commit.subject), [
    "ST-7 rename the display name label",
    "Add billing page",
    "Tighten lint rules"
  ]);
  assert.deepEqual(notes.commits.map(commit => commit.modules), [["update-profile"], ["billing"], []]);

  const rangePlan = createInvalidationPlan({
    walkthrough,
    dependencyMap,
    changedFiles: await collectGitChangedFiles({ cwd: root, base: "v1" })
  });
  assert.deepEqual(
    notes.modules.map(module => [module.id, module.status]),
    rangePlan.modules.map(module => [module.id, module.status])
  );
  assert.equal(notes.reviewRequired, rangePlan.reviewRequired);
});

test("unmapped-commits: commits without a module are kept under no user-visible change", async () => {
  const { root, docs } = await fixtureRepository();
  const { notes } = await draft(root, docs);
  const lint = notes.commits.find(commit => commit.subject === "Tighten lint rules");
  assert.deepEqual(notes.noVisibleChange, [lint.sha]);
  const markdown = await readFile(path.join(root, "out", "notes", "release-notes.md"), "utf8");
  const section = markdown.split("## No user-visible change detected")[1];
  assert.match(section, /Tighten lint rules/);
});

test("work-item-link: commits referencing a work item show its title and outcome", async () => {
  const { root, docs } = await fixtureRepository();
  const { notes } = await draft(root, docs);
  const [rename, billing, lint] = notes.commits;
  assert.deepEqual(rename.workItems, [{ id: "ST-7", title: "Rename display name field", outcome: "Users see a clearer label." }]);
  assert.deepEqual(billing.workItems, [{ id: "core", title: "Core" }], "Work-Item trailer links non-ticket ids");
  assert.deepEqual(lint.workItems, []);
  const markdown = await readFile(path.join(root, "out", "notes", "release-notes.md"), "utf8");
  assert.match(markdown, /ST-7: Rename display name field \(Users see a clearer label\.\)/);
});

test("schema-render: output validates and Markdown/HTML are generated from it", async () => {
  const { root, docs } = await fixtureRepository();
  await draft(root, docs);
  const out = path.join(root, "out", "notes");
  const notes = JSON.parse(await readFile(path.join(out, "release-notes.json"), "utf8"));
  assert.deepEqual(await validateReleaseNotesDocument(notes), { valid: true, errors: [] });
  assert.equal((await validateReleaseNotesDocument({ ...notes, status: "published" })).valid, false);

  const html = await readFile(path.join(out, "release-notes.html"), "utf8");
  assert.match(html, /<title>Release notes: Update display name<\/title>/);
  for (const commit of notes.commits) assert.ok(html.includes(commit.sha.slice(0, 7)));

  notes.commits[0].subject = "Edited <b>subject</b>";
  await writeFile(path.join(out, "release-notes.json"), JSON.stringify(notes));
  await renderReleaseNotes(out);
  const rerendered = await readFile(path.join(out, "release-notes.html"), "utf8");
  assert.match(rerendered, /Edited &lt;b&gt;subject&lt;\/b&gt;/);
  assert.match(await readFile(path.join(out, "release-notes.md"), "utf8"), /Edited &lt;b&gt;subject&lt;\/b&gt;/);
});

test("before-after: baselines give before/after pairs and missing baselines are labelled", async () => {
  const { root, docs } = await fixtureRepository();
  await mkdir(path.join(docs, "modules", "billing", "screenshots"), { recursive: true });
  await writeFile(path.join(docs, "modules", "billing", "screenshots", "open.png"), pngAfter);
  const { notes } = await draft(root, docs);
  const out = path.join(root, "out", "notes");

  const profile = notes.modules.find(module => module.id === "update-profile");
  assert.deepEqual(profile.images, [{
    asset: "modules/update-profile/screenshots/open.png",
    after: "images/after/modules/update-profile/screenshots/open.png",
    before: "images/before/modules/update-profile/screenshots/open.png",
    beforeSource: "git"
  }]);
  assert.deepEqual(await readFile(path.join(out, profile.images[0].before)), pngBefore);
  assert.deepEqual(await readFile(path.join(out, profile.images[0].after)), pngAfter);

  const billing = notes.modules.find(module => module.id === "billing");
  assert.equal(billing.images[0].before, null);
  assert.match(await readFile(path.join(out, "release-notes.md"), "utf8"), /\| no previous capture \| !\[After/);
  assert.match(await readFile(path.join(out, "release-notes.html"), "utf8"), /class="missing">no previous capture/);

  const baseline = path.join(root, "baseline");
  await mkdir(path.join(baseline, "modules", "billing", "screenshots"), { recursive: true });
  await writeFile(path.join(baseline, "modules", "billing", "screenshots", "open.png"), pngBefore);
  const withBaseline = await draft(root, docs, { baselineDir: baseline });
  const billingWithBaseline = withBaseline.notes.modules.find(module => module.id === "billing");
  assert.equal(billingWithBaseline.images[0].beforeSource, "baseline-dir");
  assert.equal(withBaseline.notes.modules.find(module => module.id === "sign-in").images.length, 0);
});

test("persona-sections: audience entries must refer to facts in the draft", async () => {
  const { root, docs } = await fixtureRepository();
  const { notes } = await draft(root, docs);
  const out = path.join(root, "out", "notes");
  notes.audiences.pm = [{ text: "Display name label is clearer.", refs: ["ST-7"] }];
  notes.audiences.po = [{ text: "Billing page added.", refs: ["billing", notes.commits[1].sha.slice(0, 7)] }];
  notes.audiences.developer = [{ text: "Profile form updated.", refs: ["update-profile"] }];
  await writeFile(path.join(out, "release-notes.json"), JSON.stringify(notes));
  await renderReleaseNotes(out);
  const markdown = await readFile(path.join(out, "release-notes.md"), "utf8");
  assert.match(markdown, /## For product managers\n\n- Display name label is clearer\./);
  assert.match(markdown, /## For product owners\n\n- Billing page added\./);

  notes.audiences.pm.push({ text: "Dark mode ships.", refs: ["dark-mode"] });
  await writeFile(path.join(out, "release-notes.json"), JSON.stringify(notes));
  await assert.rejects(renderReleaseNotes(out), /refers to "dark-mode", which is not a commit, module, or work item/);
});

test("review-gate: draft until approved; --check and approval gate modules needing review", async () => {
  const clean = await fixtureRepository({ lint: false });
  const { notes } = await draft(clean.root, clean.docs);
  const out = path.join(clean.root, "out", "notes");
  assert.equal(notes.status, "draft");
  assert.equal(notes.reviewRequired, false);
  assert.match(await readFile(path.join(out, "release-notes.md"), "utf8"), /\*\*Draft\.\*\*/);

  const approved = await approveReleaseNotes(out, { by: "Release Owner", now: new Date("2026-11-06T10:00:00Z") });
  assert.equal(approved.status, "approved");
  assert.equal(approved.approval.acceptedReview, undefined);
  assert.match(await readFile(path.join(out, "release-notes.html"), "utf8"), /Approved by Release Owner/);

  const edited = JSON.parse(await readFile(path.join(out, "release-notes.json"), "utf8"));
  edited.audiences.pm = [{ text: "Changed after approval.", refs: ["ST-7"] }];
  await writeFile(path.join(out, "release-notes.json"), JSON.stringify(edited));
  assert.equal((await renderReleaseNotes(out)).status, "draft", "editing approved content returns it to draft");

  const risky = await fixtureRepository();
  const riskyOut = path.join(risky.root, "out");
  const args = [
    "release-notes", path.join(risky.docs, "walkthrough.json"),
    "--map", path.join(risky.root, "dependency-map.json"),
    "--base", "v1", "--output", riskyOut,
    "--work-dir", path.join(risky.root, "work")
  ];
  const cwd = process.cwd();
  try {
    process.chdir(clean.root);
    assert.equal(await quiet(() => run([
      "release-notes", path.join(clean.docs, "walkthrough.json"),
      "--map", path.join(clean.root, "dependency-map.json"),
      "--base", "v1", "--output", path.join(clean.root, "out", "cli"), "--check"
    ])), 0);

    process.chdir(risky.root);
    assert.equal(await quiet(() => run([...args, "--check"])), 2);
    assert.equal(await quiet(() => run(args)), 0);
    assert.equal(await quiet(() => run(["release-notes", "approve", riskyOut, "--by", "Release Owner"])), 2);
    let riskyNotes = JSON.parse(await readFile(path.join(riskyOut, "release-notes.json"), "utf8"));
    assert.equal(riskyNotes.status, "draft");
    assert.deepEqual(riskyNotes.modules.filter(module => module.status === "review").map(module => module.id), ["sign-in"]);

    assert.equal(await quiet(() => run(["release-notes", "approve", riskyOut, "--by", "Release Owner", "--accept-review"])), 0);
    riskyNotes = JSON.parse(await readFile(path.join(riskyOut, "release-notes.json"), "utf8"));
    assert.equal(riskyNotes.status, "approved");
    assert.deepEqual(riskyNotes.approval.acceptedReview, ["sign-in"]);
  } finally {
    process.chdir(cwd);
  }
});

test("no-side-effects: no browser is started and nothing is written outside --output", async () => {
  const { root, docs } = await fixtureRepository();
  const before = await snapshot(root);
  const status = await git(root, "status", "--porcelain");
  const playwright = await import("playwright");
  const original = playwright.chromium.launch;
  let launched = false;
  playwright.chromium.launch = async (...args) => { launched = true; return original.apply(playwright.chromium, args); };
  try {
    await draft(root, docs);
  } finally {
    playwright.chromium.launch = original;
  }
  assert.equal(launched, false);
  const after = await snapshot(root);
  const added = after.filter(file => !before.includes(file));
  assert.ok(added.length > 0);
  assert.ok(added.every(file => file.startsWith("out/notes/")), `unexpected writes: ${added.join(", ")}`);
  assert.equal((await git(root, "status", "--porcelain")).replace(/^\?\? out\/\n/m, ""), status);
});

function moduleFixture(id, title, dependencies, screenshots) {
  return {
    id,
    title,
    route: "/",
    steps: [{ id: "open", action: "goto", description: "Open page." }],
    dependencies,
    assets: { screenshots }
  };
}

async function snapshot(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await snapshot(root, relative));
    else files.push(relative);
  }
  return files.sort();
}

async function quiet(action) {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await action();
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return stdout;
}
