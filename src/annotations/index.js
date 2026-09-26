export { annotateStep } from "./annotate-step.js";
export {
  AnnotationError,
  AnnotationErrorCode,
  createAnnotationError,
  sanitizeDetails
} from "./errors.js";
export {
  assertRect,
  assertViewport,
  clampRectToViewport,
  clipRectToViewport,
  estimateCaptionSize,
  isFullyInside,
  placeCallout,
  placeCaption,
  rectsIntersect,
  roundRect
} from "./geometry.js";
export { injectAnnotationOverlays, removeAnnotationOverlays, OVERLAY_ROOT_ID } from "./overlays.js";
export {
  assertKebabId,
  buildAnnotationAssetPath,
  normalizeOutputRoot,
  resolveAnnotationOutputPath
} from "./paths.js";
export { applyRedaction, normalizeRedactionConfig } from "./redaction.js";
export { locateByRoleName, normalizeRoleNameTarget } from "./target.js";
