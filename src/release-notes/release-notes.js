import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  collectGitChangedFiles,
  createInvalidationPlan,
  parseGitNameStatus,
  validateGitRef
} from "../invalidation/invalidation.js";
import { renderReleaseNotesHtml, renderReleaseNotesMarkdown } from "./render.js";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const releaseNotesSchemaPath = path.join(packageRoot, "schemas", "release-notes.schema.json");
export const NOTES_FILE = "release-notes.json";
export const MARKDOWN_FILE = "release-notes.md";
export const HTML_FILE = "release-notes.html";
const audienceKeys = ["developer", "po", "pm"];
const ticketIdPattern = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
let validatorPromise;

export class ReleaseNotesError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseNotesError";
    this.code = code;
  }
}

/**
 * Build the structured release-notes draft from already collected Git facts.
 * Pure: no filesystem or Git access, so the mapping is testable on its own.
 */
export function buildReleaseNotes({ walkthrough, dependencyMap, range, rangeFiles, commits, workItems = [] }) {
  const rangePlan = createInvalidationPlan({ walkthrough, dependencyMap, changedFiles: rangeFiles });
  const matchers = workItems.map(item => ({ item, pattern: workItemPattern(item.id) }));

  const commitEntries = commits.map(commit => {
    const plan = commit.files.length > 0
      ? createInvalidationPlan({ walkthrough, dependencyMap, changedFiles: commit.files })
      : undefined;
    const message = `${commit.subject}\n${commit.body ?? ""}`;
    return {
      sha: commit.sha,
      subject: commit.subject,
      date: commit.date,
      merge: commit.merge,
      changedFiles: plan?.changedFiles ?? [],
      modules: plan?.summary.regenerate ?? [],
      unmappedFiles: plan?.unmappedFiles ?? [],
      workItems: matchers
        .filter(({ item, pattern }) => pattern.test(message) || trailerIds(message).includes(item.id.toLowerCase()))
        .map(({ item }) => compact({ id: item.id, title: item.title, outcome: item.outcome }))
    };
  });

  const modules = rangePlan.modules.map(module => ({
    id: module.id,
    title: module.title,
    status: module.status,
    commits: commitEntries.filter(commit => commit.modules.includes(module.id)).map(commit => commit.sha),
    images: []
  }));

  return {
    schemaVersion: 1,
    walkthroughId: walkthrough.id,
    title: walkthrough.title,
    range,
    status: "draft",
    reviewRequired: rangePlan.reviewRequired,
    unmappedFiles: rangePlan.unmappedFiles,
    commits: commitEntries,
    modules,
    noVisibleChange: commitEntries.filter(commit => commit.modules.length === 0).map(commit => commit.sha),
    audiences: { developer: [], po: [], pm: [] }
  };
}

/**
 * Collect a commit range from Git and write release-notes.json, Markdown, HTML and
 * before/after images into outputDir. Never starts a browser and never writes elsewhere.
 */
export async function createReleaseNotes({
  cwd = process.cwd(),
  walkthrough,
  dependencyMap,
  base,
  head = "HEAD",
  outputDir,
  assetsDir,
  baselineDir,
  workDir
}) {
  validateGitRef(base, "base");
  validateGitRef(head, "head");
  if (!outputDir) throw new TypeError("outputDir is required");
  const output = path.resolve(outputDir);
  const range = {
    base,
    head,
    baseCommit: await resolveCommit(cwd, base),
    headCommit: await resolveCommit(cwd, head)
  };
  const [rangeFiles, commits, workItems] = await Promise.all([
    collectGitChangedFiles({ cwd, base: range.baseCommit, head: range.headCommit }),
    collectCommits(cwd, range.baseCommit, range.headCommit),
    workDir ? readWorkItems(workDir) : []
  ]);
  const notes = buildReleaseNotes({ walkthrough, dependencyMap, range, rangeFiles, commits, workItems });

  await mkdir(output, { recursive: true });
  const repositoryRoot = await gitTopLevel(cwd);
  for (const module of notes.modules) {
    if (module.status !== "regenerate") continue;
    const source = walkthrough.modules.find(entry => entry.id === module.id);
    for (const asset of source?.assets?.screenshots ?? []) {
      module.images.push(await collectImagePair({
        asset, output, assetsDir, baselineDir, repositoryRoot, baseCommit: range.baseCommit, cwd
      }));
    }
  }

  await writeReleaseNotes(output, notes);
  return { outputDir: output, notes };
}

/** Validate notes.json, drop a stale approval, and re-render Markdown and HTML. */
export async function renderReleaseNotes(outputDir) {
  const output = path.resolve(outputDir);
  const notes = await readReleaseNotes(output);
  if (notes.status === "approved" && notes.approval?.digest !== contentDigest(notes)) {
    notes.status = "draft";
    delete notes.approval;
  }
  await writeReleaseNotes(output, notes);
  return notes;
}

/**
 * Record a person's approval. While modules still need review, the approver must pass
 * acceptReview so the accepted modules are recorded with the approval.
 */
export async function approveReleaseNotes(outputDir, { by, acceptReview = false, now = new Date() }) {
  if (typeof by !== "string" || by.trim().length === 0) {
    throw new ReleaseNotesError("AUTOTOUR_APPROVER_REQUIRED", "approve requires --by <name>");
  }
  const output = path.resolve(outputDir);
  const notes = await readReleaseNotes(output);
  const review = notes.modules.filter(module => module.status === "review").map(module => module.id);
  if (review.length > 0 && !acceptReview) {
    throw new ReleaseNotesError(
      "AUTOTOUR_REVIEW_REQUIRED",
      `Modules need review before approval: ${review.join(", ")}. Check them, then approve with --accept-review.`
    );
  }
  notes.status = "approved";
  notes.approval = { by: by.trim(), at: now.toISOString(), digest: contentDigest(notes) };
  if (review.length > 0) notes.approval.acceptedReview = review;
  await writeReleaseNotes(output, notes);
  return notes;
}

export async function validateReleaseNotesDocument(document) {
  const validate = await getValidator();
  const valid = Boolean(validate(document));
  const errors = valid ? [] : (validate.errors ?? []).map(error => `${error.instancePath || "/"} ${error.message}`);
  if (valid) errors.push(...unknownAudienceRefs(document));
  return { valid: errors.length === 0, errors };
}

export function contentDigest(notes) {
  const { status: _status, approval: _approval, ...content } = notes;
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

async function readReleaseNotes(output) {
  let notes;
  try {
    notes = JSON.parse(await readFile(path.join(output, NOTES_FILE), "utf8"));
  } catch (error) {
    throw new ReleaseNotesError("AUTOTOUR_NOTES_UNREADABLE", `Cannot read ${NOTES_FILE} in ${output}: ${error.message}`);
  }
  return notes;
}

async function writeReleaseNotes(output, notes) {
  const validation = await validateReleaseNotesDocument(notes);
  if (!validation.valid) {
    throw new ReleaseNotesError("AUTOTOUR_NOTES_INVALID", `Release notes are invalid: ${validation.errors.join("; ")}`);
  }
  await Promise.all([
    writeFile(path.join(output, NOTES_FILE), `${JSON.stringify(notes, null, 2)}\n`, "utf8"),
    writeFile(path.join(output, MARKDOWN_FILE), renderReleaseNotesMarkdown(notes), "utf8"),
    writeFile(path.join(output, HTML_FILE), renderReleaseNotesHtml(notes), "utf8")
  ]);
}

function unknownAudienceRefs(notes) {
  const known = new Set([
    ...notes.modules.map(module => module.id),
    ...notes.commits.flatMap(commit => commit.workItems.map(item => item.id.toLowerCase()))
  ]);
  const shas = notes.commits.map(commit => commit.sha);
  const errors = [];
  for (const key of audienceKeys) {
    for (const [index, entry] of notes.audiences[key].entries()) {
      for (const ref of entry.refs) {
        const isCommit = /^[a-f0-9]{7,64}$/.test(ref) && shas.filter(sha => sha.startsWith(ref)).length === 1;
        if (!isCommit && !known.has(ref.toLowerCase()) && !known.has(ref)) {
          errors.push(`/audiences/${key}/${index} refers to "${ref}", which is not a commit, module, or work item in this range`);
        }
      }
    }
  }
  return errors;
}

async function collectImagePair({ asset, output, assetsDir, baselineDir, repositoryRoot, baseCommit, cwd }) {
  const relative = safeRelative(asset);
  const pair = { asset: relative, after: null, before: null };
  const afterSource = assetsDir ? path.join(path.resolve(assetsDir), relative) : undefined;
  if (afterSource && await exists(afterSource)) {
    pair.after = await copyInto(output, ["images", "after", relative], afterSource);
  }

  if (baselineDir) {
    const beforeSource = path.join(path.resolve(baselineDir), relative);
    if (await exists(beforeSource)) {
      pair.before = await copyInto(output, ["images", "before", relative], beforeSource);
      pair.beforeSource = "baseline-dir";
      return pair;
    }
  }
  if (afterSource && repositoryRoot) {
    const inRepository = path.relative(repositoryRoot, afterSource).replaceAll("\\", "/");
    if (!inRepository.startsWith("../") && !path.isAbsolute(inRepository)) {
      const blob = await gitBlob(cwd, `${baseCommit}:${inRepository}`);
      if (blob) {
        const target = path.join(output, "images", "before", relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, blob);
        pair.before = toPosix(path.join("images", "before", relative));
        pair.beforeSource = "git";
      }
    }
  }
  return pair;
}

async function copyInto(output, segments, source) {
  const target = path.join(output, ...segments);
  if (!target.startsWith(output + path.sep)) throw new TypeError(`Image path escapes the output directory: ${segments.join("/")}`);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  return toPosix(path.join(...segments));
}

function safeRelative(asset) {
  const normalized = path.posix.normalize(String(asset).replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new TypeError(`Screenshot asset must stay within the assets directory: ${asset}`);
  }
  return normalized;
}

async function collectCommits(cwd, base, head) {
  const { stdout } = await execFileAsync(
    "git",
    ["log", "--reverse", "--format=%H%x00%P%x00%aI%x00%s%x00%b%x1e", `${base}..${head}`, "--"],
    { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 }
  );
  const commits = [];
  for (const record of stdout.split("\x1e")) {
    const trimmed = record.replace(/^\n/, "");
    if (!trimmed) continue;
    const [sha, parents, date, subject, body = ""] = trimmed.split("\0");
    const merge = parents.trim().split(/\s+/).length > 1;
    const files = merge ? [] : await commitFiles(cwd, sha);
    commits.push({ sha, subject, body: body.trim(), date: new Date(date).toISOString(), merge, files });
  }
  return commits;
}

async function commitFiles(cwd, sha) {
  const { stdout } = await execFileAsync(
    "git",
    ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", "-M", "--diff-filter=ACMRD", sha],
    { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 }
  );
  return parseGitNameStatus(stdout);
}

async function resolveCommit(cwd, ref) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd, encoding: "utf8", windowsHide: true });
    return stdout.trim();
  } catch {
    throw new ReleaseNotesError("AUTOTOUR_UNKNOWN_REF", `Git revision not found: ${ref}`);
  }
}

async function gitTopLevel(cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", windowsHide: true });
    return path.resolve(stdout.trim());
  } catch {
    return undefined;
  }
}

async function gitBlob(cwd, spec) {
  try {
    const { stdout } = await execFileAsync("git", ["cat-file", "blob", spec], {
      cwd, encoding: "buffer", windowsHide: true, maxBuffer: 256 * 1024 * 1024
    });
    return stdout;
  } catch {
    return undefined;
  }
}

async function readWorkItems(workDir) {
  let names;
  try {
    names = await readdir(workDir);
  } catch {
    return [];
  }
  const items = [];
  for (const name of names.filter(entry => entry.endsWith(".json")).sort()) {
    try {
      const record = JSON.parse(await readFile(path.join(workDir, name), "utf8"));
      if (typeof record.id === "string" && record.id) {
        items.push({ id: record.id, title: record.title, outcome: record.fields?.outcome || undefined });
      }
    } catch {
      // Skip files that are not work records.
    }
  }
  return items;
}

function workItemPattern(id) {
  if (!ticketIdPattern.test(id)) return { test: () => false };
  const escaped = id.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9])`, "i");
}

function trailerIds(message) {
  return [...message.matchAll(/^Work-Item:\s*(\S+)\s*$/gim)].map(match => match[1].toLowerCase());
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

async function getValidator() {
  if (!validatorPromise) {
    validatorPromise = (async () => {
      const schema = JSON.parse(await readFile(releaseNotesSchemaPath, "utf8"));
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      return ajv.compile(schema);
    })();
  }
  return validatorPromise;
}
