import path from "node:path";
import { AnnotationErrorCode, createAnnotationError } from "./errors.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @param {string} value
 * @param {string} field
 */
export function assertKebabId(value, field) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    /** @type {Record<string, unknown>} */
    const details = {};
    if (field === "moduleId" || field === "stepId") {
      details[field] = typeof value === "string" ? value : typeof value;
    }
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      `${field} must be a lowercase kebab-case id.`,
      { details }
    );
  }
  return value;
}

/**
 * Build the deterministic relative asset path used by manifests.
 * Always uses forward slashes: `{outputRoot}/{moduleId}/{stepId}.png`.
 *
 * @param {string} moduleId
 * @param {string} stepId
 * @param {{ outputRoot?: string }} [options]
 */
export function buildAnnotationAssetPath(moduleId, stepId, { outputRoot = "output" } = {}) {
  assertKebabId(moduleId, "moduleId");
  assertKebabId(stepId, "stepId");
  const root = normalizeOutputRoot(outputRoot);
  return `${root}/${moduleId}/${stepId}.png`;
}

/**
 * Resolve a relative asset path against a filesystem root.
 *
 * @param {string} assetPath
 * @param {string} [cwd]
 */
export function resolveAnnotationOutputPath(assetPath, cwd = process.cwd()) {
  if (typeof assetPath !== "string" || assetPath.length === 0) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "assetPath must be a non-empty string."
    );
  }
  const normalized = assetPath.replace(/\\/g, "/");
  return path.resolve(cwd, ...normalized.split("/"));
}

/**
 * @param {string} outputRoot
 */
export function normalizeOutputRoot(outputRoot) {
  if (typeof outputRoot !== "string" || outputRoot.trim().length === 0) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "outputRoot must be a non-empty string."
    );
  }
  const trimmed = outputRoot.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (trimmed.length === 0 || trimmed.includes("..") || path.isAbsolute(trimmed)) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "outputRoot must be a relative path without parent segments."
    );
  }
  return trimmed;
}
