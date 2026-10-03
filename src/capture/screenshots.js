import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { annotateStep } from "../annotations/annotate-step.js";
import {
  applyRedaction,
  normalizeRedactionConfig,
  restoreRedaction
} from "../annotations/redaction.js";
import { buildAnnotationAssetPath } from "../annotations/paths.js";
import { CaptureError } from "./errors.js";

export function normalizeScreenshotOptions(value, secrets = []) {
  if (!value) return false;
  if (value !== true && typeof value !== "object") {
    throw new CaptureError({
      message: "recordScreenshots must be true or an options object.",
      cause: "recordScreenshots is invalid",
      secrets
    });
  }
  const options = value === true ? {} : value;
  const viewport = options.viewport ?? { width: 1280, height: 720 };
  if (!Number.isInteger(viewport.width) || viewport.width < 320 ||
      !Number.isInteger(viewport.height) || viewport.height < 240) {
    throw new CaptureError({
      message: "Screenshot viewport must have integer width >= 320 and height >= 240.",
      cause: "recordScreenshots.viewport is invalid",
      secrets
    });
  }
  let redaction;
  try {
    redaction = normalizeRedactionConfig(options.redaction);
  } catch (error) {
    throw new CaptureError({
      message: "Screenshot redaction configuration is invalid.",
      cause: error instanceof Error ? error.message : String(error),
      secrets,
      original: error instanceof Error ? error : undefined
    });
  }
  return {
    viewport,
    redaction: {
      selectors: redaction.selectors,
      texts: [...new Set([...redaction.texts, ...secrets])]
    }
  };
}

export function hasAnnotatableTarget(step) {
  const target = step.annotation?.target ?? step.target;
  return typeof target?.role === "string" && typeof target?.name === "string";
}

export async function prepareStepScreenshot({
  page,
  module,
  step,
  outputDir,
  options,
  secrets
}) {
  const finalRelativePath = buildAnnotationAssetPath(module.id, step.id, {
    outputRoot: "modules",
    subdirectory: "screenshots"
  });
  const temporaryRelativePath = buildAnnotationAssetPath(module.id, step.id, {
    outputRoot: ".screenshots-temp",
    subdirectory: "screenshots"
  });
  const temporaryPath = path.resolve(outputDir, ...temporaryRelativePath.split("/"));
  const finalPath = path.resolve(outputDir, ...finalRelativePath.split("/"));

  try {
    if (hasAnnotatableTarget(step)) {
      await annotateStep({
        page,
        stepId: step.id,
        moduleId: module.id,
        target: step.annotation?.target ?? step.target,
        callout: step.annotation?.callout ?? 1,
        caption: step.annotation?.caption ?? step.description,
        viewport: options.viewport,
        outputRoot: ".screenshots-temp",
        subdirectory: "screenshots",
        cwd: outputDir,
        redaction: options.redaction,
        restorePage: true
      });
    } else {
      await page.setViewportSize(options.viewport);
      try {
        await applyRedaction(page, options.redaction);
        await mkdir(path.dirname(temporaryPath), { recursive: true });
        await page.screenshot({
          path: temporaryPath,
          type: "png",
          animations: "disabled",
          caret: "hide"
        });
      } finally {
        await restoreRedaction(page);
      }
    }
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (error instanceof CaptureError) throw error;
    throw new CaptureError({
      message: `Failed to capture screenshot for module ${module.id}, step ${step.id}.`,
      moduleId: module.id,
      stepId: step.id,
      cause: error instanceof Error ? error.message : String(error),
      secrets,
      original: error instanceof Error ? error : undefined
    });
  }

  return {
    relativePath: finalRelativePath,
    absolutePath: finalPath,
    async commit() {
      await mkdir(path.dirname(finalPath), { recursive: true });
      await rm(finalPath, { force: true });
      await rename(temporaryPath, finalPath);
    },
    async discard() {
      await rm(temporaryPath, { force: true });
    }
  };
}

export async function removeScreenshotTemporaryDirectory(outputDir) {
  await rm(path.join(outputDir, ".screenshots-temp"), { recursive: true, force: true });
}
