import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AnnotationErrorCode, createAnnotationError } from "./errors.js";
import {
  assertViewport,
  clipRectToViewport,
  placeCallout,
  placeCaption,
  roundRect
} from "./geometry.js";
import { injectAnnotationOverlays, removeAnnotationOverlays } from "./overlays.js";
import { buildAnnotationAssetPath, resolveAnnotationOutputPath } from "./paths.js";
import { applyRedaction, normalizeRedactionConfig, restoreRedaction } from "./redaction.js";
import { locateByRoleName, normalizeRoleNameTarget } from "./target.js";
import { waitForCondition } from "../capture/conditions.js";
import { ensureIgnoreRules } from "../project.js";

/**
 * @typedef {{
 *   stepId: string,
 *   path: string,
 *   width: number,
 *   height: number,
 *   targetBox: { x: number, y: number, width: number, height: number },
 *   callout: number
 * }} AnnotationResult
 */

/**
 * Render an annotated walkthrough screenshot for a capture step.
 *
 * Accepts a Playwright page already showing the step UI (typically a synthetic
 * data-URL page in tests). Applies optional redaction, highlights the role/name
 * target, draws a numbered callout and caption, and writes a deterministic PNG.
 *
 * @param {{
 *   page: import('playwright').Page,
 *   stepId: string,
 *   moduleId: string,
 *   target: { role: string, name: string },
 *   callout: number,
 *   caption: string,
 *   viewport?: { width: number, height: number },
 *   outputRoot?: string,
 *   cwd?: string,
 *   redaction?: { selectors?: string[], texts?: string[] },
 *   keepOverlays?: boolean,
 *   restorePage?: boolean,
 *   subdirectory?: string
 * }} input
 * @returns {Promise<AnnotationResult>}
 */
export async function annotateStep(input) {
  validateAnnotateInput(input);

  const {
    page,
    stepId,
    moduleId,
    callout,
    caption,
    viewport,
    outputRoot = ".autotour/output/annotations",
    cwd = process.cwd(),
    keepOverlays = false,
    restorePage = false,
    subdirectory
  } = input;

  const target = normalizeRoleNameTarget(input.target);
  const redaction = normalizeRedactionConfig(input.redaction);
  const assetPath = buildAnnotationAssetPath(moduleId, stepId, { outputRoot, subdirectory });
  const absolutePath = resolveAnnotationOutputPath(assetPath, cwd);
  if (input.outputRoot === undefined && input.manageGitignore === true) {
    await ensureIgnoreRules(path.resolve(cwd, ".autotour/.gitignore"), ["/output/"]);
  }

  const resolvedViewport = viewport
    ? assertViewport(viewport)
    : assertViewport(page.viewportSize() ?? { width: 1280, height: 720 });

  if (viewport) {
    await page.setViewportSize(resolvedViewport);
  }

  await applyRedaction(page, redaction);
  let targetBox;

  try {
    const locator = await locateByRoleName(page, target, { stepId });
    await locator.scrollIntoViewIfNeeded();
    await page.evaluate(async () => {
      await Promise.race([document.fonts?.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
      for (const animation of document.getAnimations()) {
        if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) {
          try { animation.finish(); } catch { /* Non-finishable animation. */ }
        }
      }
    });
    await waitForCondition(page, { target, stableForMs: 150, timeoutMs: 5000, count: 1 });
    const rawBox = await locator.boundingBox();
    if (!rawBox) {
      throw createAnnotationError(
        AnnotationErrorCode.TARGET_OUTSIDE_VIEWPORT,
        "Target element has no visible bounding box in the viewport.",
        { details: { stepId, moduleId, role: target.role, name: target.name } }
      );
    }

    targetBox = clipRectToViewport(rawBox, resolvedViewport);
    if (!targetBox) {
      throw createAnnotationError(
        AnnotationErrorCode.TARGET_OUTSIDE_VIEWPORT,
        "Target element is outside the viewport after clipping.",
        {
          details: {
            stepId,
            moduleId,
            role: target.role,
            name: target.name,
            viewportWidth: resolvedViewport.width,
            viewportHeight: resolvedViewport.height
          }
        }
      );
    }

    const calloutBox = placeCallout(targetBox, resolvedViewport);
    const captionBox = placeCaption(targetBox, resolvedViewport, caption);
    await injectAnnotationOverlays(page, {
      targetBox,
      calloutBox,
      captionBox,
      callout
    });
    const renderedBox = await page.locator("[data-autotour-highlight]").boundingBox();
    if (!renderedBox || Object.keys(targetBox).some(key => Math.abs(targetBox[key] - renderedBox[key]) > 1)) {
      throw new Error("Annotation coordinate mismatch: overlay and target use different coordinate spaces.");
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await page.screenshot({
      path: absolutePath,
      type: "png",
      animations: "disabled",
      caret: "hide"
    });
    const currentBox = await locator.boundingBox();
    if (!currentBox || Object.keys(rawBox).some(key => Math.abs(rawBox[key] - currentBox[key]) > 1)) {
      throw new Error("Annotation target moved during screenshot capture; retry after a stable state.");
    }
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause) {
      throw cause;
    }
    throw createAnnotationError(
      AnnotationErrorCode.RENDER_FAILED,
      "Annotated screenshot rendering failed.",
      { details: { stepId, moduleId, path: assetPath }, cause }
    );
  } finally {
    if (!keepOverlays) {
      try {
        await removeAnnotationOverlays(page);
      } catch {
        // Overlay cleanup must not mask a successful write or primary error.
      }
    }
    if (restorePage) {
      try {
        await restoreRedaction(page);
      } catch {
        // Page restoration must not mask a successful write or primary error.
      }
    }
  }

  return {
    stepId,
    path: assetPath,
    width: resolvedViewport.width,
    height: resolvedViewport.height,
    targetBox: roundRect(targetBox),
    callout
  };
}

/**
 * @param {unknown} input
 */
function validateAnnotateInput(input) {
  if (!input || typeof input !== "object") {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "annotateStep input must be an object."
    );
  }
  const value = /** @type {Record<string, unknown>} */ (input);
  if (!value.page || typeof value.page !== "object") {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "annotateStep requires a Playwright page."
    );
  }
  if (typeof value.stepId !== "string") {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "stepId must be a lowercase kebab-case id."
    );
  }
  if (typeof value.moduleId !== "string") {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "moduleId must be a lowercase kebab-case id."
    );
  }
  if (typeof value.callout !== "number" || !Number.isInteger(value.callout) || value.callout < 1) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "callout must be a positive integer."
    );
  }
  if (typeof value.caption !== "string" || value.caption.trim().length === 0) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "caption must be a non-empty string."
    );
  }
}
