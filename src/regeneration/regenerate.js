import { cp, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { captureJourney } from "../capture/capture.js";
import { validateWalkthroughDocument } from "../capture/manifest.js";

export class RegenerationError extends Error {
  constructor(message, { code = "AUTOTOUR_REGENERATION_INVALID", cause } = {}) {
    super(message, { cause });
    this.name = "RegenerationError";
    this.code = code;
  }
}

export async function regenerateWalkthrough(options) {
  const {
    journey,
    invalidationPlan,
    outputDir: requestedOutputDir,
    env = process.env,
    recordDom,
    recordVideo,
    recordScreenshots,
    capture = captureJourney
  } = options ?? {};
  const outputDir = path.resolve(requestedOutputDir ?? "");
  if (!requestedOutputDir) {
    throw new RegenerationError("regenerateWalkthrough requires an outputDir");
  }

  const walkthroughPath = path.join(outputDir, "walkthrough.json");
  const stepsPath = path.join(outputDir, "capture-steps.json");
  const [previousWalkthrough, previousCaptureSteps] = await Promise.all([
    readJson(walkthroughPath, "existing walkthrough"),
    readJson(stepsPath, "existing capture steps")
  ]);
  const selection = validateRegenerationPlan({
    journey,
    invalidationPlan,
    previousWalkthrough
  });
  const mode = resolveCaptureMode(previousWalkthrough.outputs, {
    recordDom,
    recordVideo,
    recordScreenshots
  });

  if (selection.regenerate.length === 0) {
    return buildResult({
      status: "unchanged",
      outputDir,
      mode: mode.name,
      regenerate: selection.regenerate,
      reusable: selection.reusable,
      walkthrough: previousWalkthrough
    });
  }

  const suffix = randomUUID();
  const stagingDir = path.join(path.dirname(outputDir), `.${path.basename(outputDir)}.autotour-stage-${suffix}`);
  const backupDir = path.join(path.dirname(outputDir), `.${path.basename(outputDir)}.autotour-backup-${suffix}`);
  let originalMoved = false;

  try {
    await cp(outputDir, stagingDir, { recursive: true, errorOnExist: true, force: false });
    const captured = await capture({
      journey,
      outputDir: stagingDir,
      env,
      moduleIds: selection.regenerate,
      previousWalkthrough,
      previousCaptureSteps,
      recordDom: mode.recordDom,
      recordVideo: mode.recordVideo,
      recordScreenshots: mode.recordScreenshots
    });
    const validation = await validateWalkthroughDocument(captured.walkthrough);
    if (!validation.valid) {
      throw new RegenerationError(
        `Regenerated walkthrough is invalid: ${JSON.stringify(validation.errors)}`
      );
    }

    await rename(outputDir, backupDir);
    originalMoved = true;
    await rename(stagingDir, outputDir);
    originalMoved = false;
    await removeTemporaryDirectory(backupDir);

    return buildResult({
      status: "regenerated",
      outputDir,
      mode: mode.name,
      regenerate: selection.regenerate,
      reusable: selection.reusable,
      executed: captured.executedModuleIds,
      walkthrough: captured.walkthrough
    });
  } catch (error) {
    if (originalMoved) {
      await rm(outputDir, { recursive: true, force: true });
      await rename(backupDir, outputDir);
      originalMoved = false;
    }
    if (error instanceof RegenerationError) throw error;
    throw new RegenerationError("Selective regeneration failed; existing output was preserved.", {
      code: "AUTOTOUR_REGENERATION_FAILED",
      cause: error
    });
  } finally {
    await removeTemporaryDirectory(stagingDir);
    if (!originalMoved) await removeTemporaryDirectory(backupDir);
  }
}

export function validateRegenerationPlan({ journey, invalidationPlan, previousWalkthrough }) {
  if (!journey || !Array.isArray(journey.modules)) {
    throw new RegenerationError("Regeneration requires an executable journey with modules.");
  }
  if (!invalidationPlan || !Array.isArray(invalidationPlan.modules)) {
    throw new RegenerationError("Regeneration requires an invalidation plan with modules.");
  }
  if (invalidationPlan.reviewRequired ||
      invalidationPlan.modules.some((module) => module.status === "review")) {
    throw new RegenerationError("Invalidation plan requires review before regeneration.", {
      code: "AUTOTOUR_REVIEW_REQUIRED"
    });
  }
  if (journey.id !== previousWalkthrough?.id ||
      invalidationPlan.walkthroughId !== previousWalkthrough?.id) {
    throw new RegenerationError("Journey, plan, and existing walkthrough identities must match.");
  }

  const journeyIds = journey.modules.map((module) => module.id);
  const previousIds = previousWalkthrough.modules?.map((module) => module.id) ?? [];
  const planIds = invalidationPlan.modules.map((module) => module.id);
  if (!sameOrderedValues(journeyIds, previousIds)) {
    throw new RegenerationError("Journey modules must match the existing walkthrough in order.");
  }
  if (new Set(planIds).size !== planIds.length ||
      planIds.length !== journeyIds.length ||
      journeyIds.some((id) => !planIds.includes(id))) {
    throw new RegenerationError("Invalidation plan must classify every walkthrough module exactly once.");
  }
  if (invalidationPlan.modules.some((module) =>
    module.status !== "regenerate" && module.status !== "reusable")) {
    throw new RegenerationError("Invalidation plan contains an unsupported module status.");
  }

  return {
    regenerate: journeyIds.filter((id) =>
      invalidationPlan.modules.find((module) => module.id === id).status === "regenerate"
    ),
    reusable: journeyIds.filter((id) =>
      invalidationPlan.modules.find((module) => module.id === id).status === "reusable"
    )
  };
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new RegenerationError(`Could not read ${label} at ${file}.`, { cause: error });
  }
}

function resolveCaptureMode(outputs, overrides) {
  if (!Array.isArray(outputs) || outputs.length !== 1 ||
      !["dom", "video", "screenshots"].includes(outputs[0])) {
    throw new RegenerationError(
      "Selective regeneration supports one screenshot, DOM, or video output."
    );
  }
  if (outputs[0] === "dom") {
    if (overrides.recordVideo || overrides.recordScreenshots) {
      throw new RegenerationError("Existing DOM output cannot be regenerated in another mode.");
    }
    return {
      name: "dom",
      recordDom: overrides.recordDom === undefined ? {} : overrides.recordDom,
      recordVideo: false,
      recordScreenshots: false
    };
  }
  if (outputs[0] === "video") {
    if (overrides.recordDom || overrides.recordScreenshots) {
      throw new RegenerationError("Existing video output cannot be regenerated in another mode.");
    }
    return {
      name: "video",
      recordDom: false,
      recordVideo: overrides.recordVideo === undefined ? {} : overrides.recordVideo,
      recordScreenshots: false
    };
  }
  if (overrides.recordDom || overrides.recordVideo) {
    throw new RegenerationError("Existing screenshot output cannot be regenerated in another mode.");
  }
  return {
    name: "screenshots",
    recordDom: false,
    recordVideo: false,
    recordScreenshots: overrides.recordScreenshots === undefined ? {} : overrides.recordScreenshots
  };
}

function buildResult({ status, outputDir, mode, regenerate, reusable, executed = [], walkthrough }) {
  return {
    status,
    walkthroughId: walkthrough.id,
    mode,
    regeneratedModules: [...regenerate],
    reusableModules: [...reusable],
    executedModules: [...executed],
    outputDir,
    walkthroughPath: path.join(outputDir, "walkthrough.json"),
    captureStepsPath: path.join(outputDir, "capture-steps.json"),
    ...(mode === "dom" ? { domIndexPath: path.join(outputDir, "index.html") } : {})
  };
}

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function removeTemporaryDirectory(directory) {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch {
    // Cleanup residue must not turn a successfully committed output into a reported capture failure.
  }
}
