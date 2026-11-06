import { prepareDocumentationCapture } from "./spec.js";
import { RegenerationError, regenerateWalkthrough } from "../regeneration/index.js";

/**
 * Recapture named documentation modules into an existing capture directory.
 * Modules that do not need to run are left unrun. Their images and manifest
 * entries stay. A failed module restores the previous capture, so previously
 * published sibling images are not replaced.
 *
 * @param {object} options
 * @param {object} options.spec
 * @param {object} options.journey
 * @param {object} options.dependencyMap
 * @param {string} options.outputDir
 * @param {string[]} options.moduleIds
 */
export async function recaptureDocumentationModules({
  spec,
  journey,
  dependencyMap,
  outputDir,
  moduleIds,
  env = process.env,
  page,
  capture
} = {}) {
  const names = normalizeNamedModules(journey, moduleIds);
  const prepared = await prepareDocumentationCapture({ spec, journey, dependencyMap });
  try {
    return await regenerateWalkthrough({
      journey: prepared.journey,
      invalidationPlan: planForNamedModules(prepared.journey, names),
      outputDir,
      env,
      recordScreenshots: prepared.recordScreenshots,
      ...(page ? { page } : {}),
      ...(capture ? { capture } : {})
    });
  } catch (error) {
    if (error instanceof RegenerationError && error.message.startsWith("Could not read existing walkthrough")) {
      throw new Error(`No previous capture exists in ${outputDir}. Capture the manual once before recapturing named modules.`);
    }
    throw error;
  }
}

function normalizeNamedModules(journey, moduleIds) {
  if (!journey || !Array.isArray(journey.modules)) {
    throw new Error("Documentation recapture requires the journey.");
  }
  if (!Array.isArray(moduleIds) || moduleIds.length === 0) {
    throw new Error("Name at least one module to recapture.");
  }
  const duplicate = moduleIds.find((id, index) => moduleIds.indexOf(id) !== index);
  if (duplicate) throw new Error(`Duplicate module id: ${duplicate}.`);
  const known = new Set(journey.modules.map((module) => module.id));
  const unknown = moduleIds.find((id) => !known.has(id));
  if (unknown) throw new Error(`Unknown module: ${unknown}.`);
  return moduleIds;
}

function planForNamedModules(journey, moduleIds) {
  const selected = new Set(moduleIds);
  const modules = journey.modules.map((module) => ({
    id: module.id,
    title: module.title,
    status: selected.has(module.id) ? "regenerate" : "reusable",
    reasons: []
  }));
  return {
    schemaVersion: 1,
    walkthroughId: journey.id,
    changedFiles: [],
    reviewRequired: false,
    unmappedFiles: [],
    unmatchedDependencies: [],
    modules,
    summary: {
      regenerate: modules.filter((module) => module.status === "regenerate").map((module) => module.id),
      reusable: modules.filter((module) => module.status === "reusable").map((module) => module.id),
      review: []
    }
  };
}
