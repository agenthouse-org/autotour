import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readStorageConfiguration } from "../project.js";
import { validateWalkthroughDocument } from "../capture/manifest.js";
import { captureJourney } from "../capture/capture.js";
import { regenerateWalkthrough } from "../regeneration/regenerate.js";
import { writeWalkthroughReplay } from "../dom/walkthrough-player.js";
import { copyTree, digest, filesIn, html, readJson, safePath, saveJson, within } from "./files.js";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function text(value, name, max = 4000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} must be non-empty text (up to ${max} characters).`);
  return value.trim();
}
function storageSnapshot(config) {
  return { output: config.output, documentationOutput: config.documentationOutput, policy: config.storage };
}
function planDigest(state) {
  // Wording is reviewable without changing the authorized actions or environment.
  const journey = structuredClone(state.journey);
  for (const module of journey.modules) {
    delete module.title;
    for (const step of [...(module.setup ?? []), ...module.steps]) {
      delete step.description; delete step.instruction; delete step.narration;
      if (step.annotation) delete step.annotation.caption;
    }
  }
  return digest({ journey, brief: state.brief, storage: state.storage, mode: state.mode });
}

export async function createTourReview({ root = process.cwd(), journey, brief, mode = "screenshots" }) {
  const config = await readStorageConfiguration(root);
  const validation = await validateWalkthroughDocument(journey);
  if (!validation.valid) throw new Error(`Invalid journey: ${JSON.stringify(validation.errors)}`);
  if (!idPattern.test(journey.id) || new Set(journey.modules.map(m => m.id)).size !== journey.modules.length) throw new Error("Journey and scene IDs must be unique stable IDs.");
  if (!["screenshots", "dom", "video"].includes(mode)) throw new Error("Choose screenshots, dom, or video.");
  const url = new URL(journey.target.baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP(S) application URL without credentials.");
  const cleanBrief = {};
  for (const key of ["audience", "outcome", "privacy", "testDataEffects"]) cleanBrief[key] = text(brief?.[key], key);
  for (const module of journey.modules) {
    if (!(module.setup?.length || module.steps[0]?.action === "goto")) throw new Error(`Scene ${module.id} needs explicit setup or initial navigation.`);
    if (!module.steps.some(s => s.expect || s.action === "assert" || (s.action === "wait" && s.until))) throw new Error(`Scene ${module.id} needs an expected-state check.`);
    if (new Set(module.steps.map(s => s.id)).size !== module.steps.length) throw new Error(`Scene ${module.id} contains duplicate step IDs.`);
  }
  const directory = await safePath(config.output, `reviews/${journey.id}`);
  const state = { schemaVersion: 1, version: 1, createdAt: new Date().toISOString(), journey: structuredClone(journey), brief: cleanBrief,
    mode, storage: storageSnapshot(config), planApproval: null, capture: null, checks: null, failure: null,
    scenes: Object.fromEntries(journey.modules.map(m => [m.id, { revision: 0, sourceHash: null, assetHash: null, approval: null, excluded: false }])),
    metrics: { corrections: 0, captureAttempts: 0, firstApprovedAt: null, trials: [] }, history: [] };
  await mkdir(directory, { recursive: true });
  const file = await safePath(directory, "review.json");
  await writeFile(file, JSON.stringify(state, null, 2) + "\n", { flag: "wx" });
  return { directory, file };
}

export async function openTourReview({ root = process.cwd(), id }) {
  if (!idPattern.test(id ?? "")) throw new Error("A stable tour ID is required.");
  const config = await readStorageConfiguration(root);
  const directory = await safePath(config.output, `reviews/${id}`);
  const file = await safePath(directory, "review.json");
  const state = await readJson(file);
  if (state.schemaVersion !== 1 || state.journey.id !== id) throw new Error("Invalid review record.");
  return { root: path.resolve(root), directory, file, state };
}

async function assertStorage(review) {
  const current = storageSnapshot(await readStorageConfiguration(review.root));
  if (digest(current) !== digest(review.state.storage)) throw new Error("Storage configuration changed. Restore the approved settings or create a new tour plan; no capture or delivery was written.");
  await safePath(review.directory);
}

async function captureRoot(review) {
  if (!review.state.capture) throw new Error("Capture the approved plan first.");
  return safePath(review.directory, review.state.capture);
}

async function sceneAssetHash(root, module) {
  const all = await filesIn(root, `modules/${module.id}`);
  const assets = [module.assets?.dom, module.assets?.video, ...(module.assets?.screenshots ?? [])].filter(Boolean);
  if (!assets.length) throw new Error(`Scene ${module.id} has no captured media.`);
  for (const asset of assets) if (!all.includes(asset)) throw new Error(`Scene ${module.id} references missing or unsafe media.`);
  // Runtime changes also invalidate DOM approvals. Capture reports contain timestamps, not media.
  if (module.assets?.dom) all.push(...await filesIn(root, "runtime"));
  const hashes = [];
  for (const name of all.filter(n => !n.endsWith("capture-report.json"))) {
    const bytes = await readFile(await safePath(root, name));
    if (!bytes.length) throw new Error(`Scene ${module.id} contains an empty asset.`);
    hashes.push([name, digest(bytes)]);
  }
  return digest(hashes);
}

export async function tourReport(review) {
  const state = review.state;
  const checks = [];
  let storageOK = true;
  try { await assertStorage(review); } catch { storageOK = false; }
  checks.push({ name: "Approved output folders", status: storageOK ? "passed" : "failed" });
  let manifest;
  try { manifest = await readJson(path.join(await captureRoot(review), "walkthrough.json")); } catch { /* report missing capture */ }
  const scenes = [];
  for (const module of state.journey.modules) {
    const saved = state.scenes[module.id];
    let mediaOK = false;
    try { mediaOK = saved.assetHash === await sceneAssetHash(await captureRoot(review), manifest.modules.find(m => m.id === module.id)); } catch { /* damaged/absent capture */ }
    const fresh = mediaOK && saved.sourceHash === digest(module);
    const approved = fresh && saved.approval?.assetHash === saved.assetHash && saved.approval?.sourceHash === saved.sourceHash;
    scenes.push({ id: module.id, title: module.title, revision: saved.revision, excluded: saved.excluded,
      status: saved.excluded ? "excluded" : !fresh ? "needs-capture" : approved ? "approved" : "needs-review",
      approval: approved ? saved.approval : null, mediaOK });
  }
  const included = scenes.filter(s => !s.excluded);
  checks.push({ name: "Capture bytes and current scene revisions", status: included.length && included.every(s => s.mediaOK && s.status !== "needs-capture") ? "passed" : "failed" });
  checks.push({ name: "Annotation alignment / clipping", status: "human-review", detail: "Capture validates overlay geometry where annotations exist. Final visual readability must be reviewed." });
  checks.push({ name: "Replay playback", status: state.mode === "dom" ? "human-review" : "not-applicable", detail: "Review playback at the checkpoints; file integrity alone does not prove playback fidelity." });
  checks.push({ name: "Sensitive content", status: "human-review", detail: "Known credential checks are not complete anonymization. DOM inputs are masked; inspect all images, text and playback before sharing." });
  const ready = storageOK && !!state.planApproval && state.planApproval.digest === planDigest(state) && included.length > 0 && included.every(s => s.status === "approved");
  return { ready, checks, scenes, metrics: { ...state.metrics,
    timeToFirstApprovalMs: state.metrics.firstApprovedAt ? Date.parse(state.metrics.firstApprovedAt) - Date.parse(state.createdAt) : null },
    note: "Local reviewer attestations, not authenticated identities or governance approval. Preparation never publishes externally." };
}

function expectedResult(step) {
  if (!step.expect) return step.action === "assert" ? "The scene’s assertion must pass." : "Check the expected result for this scene.";
  const expected = step.expect;
  const parts = [];
  if (expected.text !== undefined) parts.push(`Show “${expected.text}”.`);
  if (expected.count !== undefined) parts.push(`Find ${expected.count} matching items.`);
  if (expected.state) parts.push(`The target must be ${expected.state}.`);
  if (expected.url) parts.push(`Reach ${expected.url}.`);
  if (expected.stableForMs) parts.push(`Remain stable for ${expected.stableForMs} ms.`);
  return parts.join(" ") || "The configured expected-state check must pass.";
}

export async function reviewView(review) {
  const state = review.state;
  const report = await tourReport(review);
  let manifest;
  try { manifest = await readJson(path.join(await captureRoot(review), "walkthrough.json")); } catch { /* no capture yet */ }
  return { version: state.version, id: state.journey.id, title: state.journey.title, brief: state.brief, mode: state.mode,
    storage: state.storage, planApproved: state.planApproval?.digest === planDigest(state), failure: state.failure, delivery: state.delivery ?? null, report,
    scenes: state.journey.modules.map(module => ({ ...report.scenes.find(s => s.id === module.id),
      steps: module.steps.map(step => ({ id: step.id, instruction: step.instruction ?? step.description, narration: step.narration ?? "", expected: expectedResult(step) })),
      assets: manifest?.modules.find(m => m.id === module.id)?.assets ?? {}, capture: state.capture })) };
}

export async function applyReviewAction(review, action, { capture = captureJourney, regenerate = regenerateWalkthrough } = {}) {
  await assertStorage(review);
  if (action.version !== review.state.version) throw new Error("This view is stale. Reload before saving; another action changed the tour.");
  const state = review.state;
  const now = () => new Date().toISOString();
  const module = state.journey.modules.find(m => m.id === action.sceneId);
  const saved = module && state.scenes[module.id];
  const requireScene = () => { if (!saved) throw new Error("Unknown scene."); };
  if (action.type === "approve-plan") {
    const reviewer = text(action.reviewer, "Reviewer", 120);
    if (action.consent !== true) throw new Error("Explicit approval of this plan and test-data effects is required.");
    state.planApproval = { digest: planDigest(state), reviewer, at: now() };
  } else if (action.type === "wording") {
    requireScene();
    const step = module.steps.find(s => s.id === action.stepId);
    if (!step) throw new Error("Unknown checkpoint.");
    const instruction = text(action.instruction, "Instruction");
    if (typeof action.narration !== "string" || action.narration.length > 4000) throw new Error("Narration must be text up to 4000 characters.");
    if (instruction !== (step.instruction ?? step.description) || action.narration !== (step.narration ?? "")) {
      step.instruction = instruction; step.description = instruction; step.narration = action.narration;
      if (step.annotation) step.annotation.caption = instruction;
      saved.approval = null; state.metrics.corrections++;
    }
  } else if (action.type === "exclude") {
    requireScene();
    if (typeof action.excluded !== "boolean") throw new Error("Exclusion must be explicit.");
    saved.excluded = action.excluded; saved.approval = null;
  } else if (action.type === "approve-scene") {
    requireScene();
    const report = await tourReport(review);
    const scene = report.scenes.find(s => s.id === module.id);
    if (!["needs-review", "approved"].includes(scene.status)) throw new Error("Capture the current revision and include this scene before approving it.");
    if (!["readable", "accurate", "private", "playback"].every(key => action.checks?.[key] === true)) throw new Error("Confirm readability, accuracy, privacy and media playback before approval.");
    saved.approval = { reviewer: text(action.reviewer, "Reviewer", 120), at: now(), assetHash: saved.assetHash, sourceHash: saved.sourceHash, checks: Object.fromEntries(["readable", "accurate", "private", "playback"].map(key => [key, true])) };
  } else if (action.type === "capture" || action.type === "recapture") {
    if (state.planApproval?.digest !== planDigest(state)) throw new Error("Approve the current plan before capture.");
    if (action.consent !== true) throw new Error("Explicit consent is required: setup and test-data actions may run again.");
    if (action.type === "recapture") requireScene();
    const selected = action.type === "recapture" ? [module.id] : state.journey.modules.map(m => m.id);
    if (action.type === "recapture" && !state.capture) throw new Error("Complete the initial capture before selective recapture.");
    const relative = `captures/${randomUUID()}`;
    const destination = await safePath(review.directory, relative);
    const modes = { recordScreenshots: state.mode === "screenshots", recordDom: state.mode === "dom" ? { autoplay: false, inlineEvents: true } : false, recordVideo: state.mode === "video" };
    state.metrics.captureAttempts++;
    try {
      if (action.type === "recapture") {
        await copyTree(await captureRoot(review), destination);
        await regenerate({ journey: state.journey, outputDir: destination, ...modes,
          invalidationPlan: { walkthroughId: state.journey.id, reviewRequired: false, modules: state.journey.modules.map(m => ({ id: m.id, status: selected.includes(m.id) ? "regenerate" : "reusable" })) } });
      } else await capture({ journey: state.journey, outputDir: destination, ...modes });
      const manifest = await readJson(path.join(destination, "walkthrough.json"));
      const hashes = Object.fromEntries(await Promise.all(manifest.modules.map(async m => [m.id, await sceneAssetHash(destination, m)])));
      state.capture = relative; state.failure = null;
      for (const m of state.journey.modules) if (selected.includes(m.id)) {
        const scene = state.scenes[m.id];
        scene.revision++; scene.assetHash = hashes[m.id]; scene.sourceHash = digest(m); scene.approval = null;
      }
      if (action.type === "recapture") {
        const index = state.journey.modules.findIndex(m => m.id === module.id);
        for (const later of state.journey.modules.slice(index + 1)) state.scenes[later.id].approval = null;
      }
    } catch (error) {
      // Do not serialize arbitrary exception text (URLs, page content or credential values).
      const failedId = state.journey.modules.some(m => m.id === error.moduleId) ? error.moduleId : module?.id ?? null;
      const reason = String(error.cause?.message ?? error.cause ?? error.message);
      const diagnosis = /not unique|ambiguous|multiple elements/i.test(reason) ? "A target matched multiple controls. Scope it to a unique control." : /protected value|credential/i.test(reason) ? "A credential or protected-value check failed. Review secure test access and redaction." : /timeout|did not settle/i.test(reason) ? "The expected target or state did not become ready in time." : "Check target uniqueness, the expected state and permitted test access.";
      state.failure = { sceneId: failedId, at: now(), message: "Capture did not complete. The previous capture is preserved.",
        advice: diagnosis + " Correct the source journey in a new plan if execution must change. Retry only after reviewing test-data effects." };
      state.version++;
      await saveJson(review.file, state);
      throw new Error(state.failure.message + " " + state.failure.advice);
    }
  } else if (action.type === "trial") {
    if (![true, false].includes(action.completed) || ![true, false].includes(action.unexpectedWrites) || ![true, false].includes(action.disclosure)) throw new Error("Trial outcomes must be explicit true/false observations.");
    if (!["dashboard", "form", "content", "other"].includes(action.applicationType)) throw new Error("Choose a trial application type.");
    state.metrics.trials.push({ at: now(), participant: text(action.participant, "Participant alias", 120), applicationType: action.applicationType, completed: action.completed, unexpectedWrites: action.unexpectedWrites, disclosure: action.disclosure });
  } else if (action.type === "deliver") {
    const report = await tourReport(review);
    if (!report.ready) throw new Error("Delivery is blocked until every included scene has current human approval and intact media.");
    if (action.consent !== true) throw new Error("Confirm preparation in the saved delivery folder.");
    state.delivery = await prepareDelivery(review, report);
  } else throw new Error("Unknown review action.");
  if (!state.metrics.firstApprovedAt && (await tourReport(review)).ready) state.metrics.firstApprovedAt = now();
  state.history.push({ action: action.type, sceneId: module?.id ?? null, at: now() });
  state.version++;
  await saveJson(review.file, state);
  return reviewView(review);
}

async function prepareDelivery(review, report) {
  const { state } = review;
  const source = await captureRoot(review);
  const destination = await safePath(state.storage.documentationOutput, `${state.journey.id}/${randomUUID()}`);
  if (within(source, destination)) throw new Error("Delivery cannot be placed inside a capture.");
  const manifest = await readJson(path.join(source, "walkthrough.json"));
  manifest.modules = manifest.modules.filter(m => !state.scenes[m.id].excluded);
  await mkdir(destination, { recursive: true });
  for (const module of manifest.modules) await copyTree(path.join(source, "modules", module.id), path.join(destination, "modules", module.id));
  if (state.mode === "dom") {
    await copyTree(path.join(source, "runtime"), path.join(destination, "runtime"));
    await writeWalkthroughReplay(destination, manifest);
  } else {
    const content = manifest.modules.map(module => `<section><h2>${html(module.title)}</h2>${state.mode === "video" ? `<video controls src="${html(module.assets.video)}"></video>` : module.steps.map(step => {
      const asset = module.assets.screenshots?.find(a => a.endsWith(`/${step.id}.png`));
      return `<figure><figcaption>${html(step.instruction ?? step.description)}</figcaption>${asset ? `<img src="${html(asset)}" alt="${html(step.instruction ?? step.description)}">` : ""}</figure>`;
    }).join("")}</section>`).join("");
    await writeFile(path.join(destination, "index.html"), `<!doctype html><html lang="${html(manifest.language ?? "en")}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${html(manifest.title)}</title><style>body{max-width:1100px;margin:32px auto;padding:16px;font:18px/1.5 system-ui}img,video{max-width:100%}figure{margin:24px 0}figcaption{margin-bottom:12px}</style><h1>${html(manifest.title)}</h1>${content}</html>`);
  }
  await saveJson(path.join(destination, "delivery-report.json"), { ...report, preparedAt: new Date().toISOString(), includedScenes: manifest.modules.map(m => m.id), publication: "not-published" });
  return { path: destination, at: new Date().toISOString(), status: "prepared-locally" };
}
