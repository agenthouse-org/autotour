import { AnnotationErrorCode, createAnnotationError } from "./errors.js";

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ width: number, height: number }} Viewport
 */

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Rect}
 */
export function assertRect(value, label = "rect") {
  if (
    !value ||
    typeof value !== "object" ||
    typeof /** @type {Rect} */ (value).x !== "number" ||
    typeof /** @type {Rect} */ (value).y !== "number" ||
    typeof /** @type {Rect} */ (value).width !== "number" ||
    typeof /** @type {Rect} */ (value).height !== "number" ||
    !Number.isFinite(/** @type {Rect} */ (value).x) ||
    !Number.isFinite(/** @type {Rect} */ (value).y) ||
    !Number.isFinite(/** @type {Rect} */ (value).width) ||
    !Number.isFinite(/** @type {Rect} */ (value).height) ||
    /** @type {Rect} */ (value).width < 0 ||
    /** @type {Rect} */ (value).height < 0
  ) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      `${label} must include finite x, y, width, and height.`
    );
  }
  return /** @type {Rect} */ (value);
}

/**
 * @param {unknown} value
 * @returns {Viewport}
 */
export function assertViewport(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof /** @type {Viewport} */ (value).width !== "number" ||
    typeof /** @type {Viewport} */ (value).height !== "number" ||
    !Number.isFinite(/** @type {Viewport} */ (value).width) ||
    !Number.isFinite(/** @type {Viewport} */ (value).height) ||
    /** @type {Viewport} */ (value).width <= 0 ||
    /** @type {Viewport} */ (value).height <= 0
  ) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "viewport must include positive finite width and height.",
      {
        details: {
          viewportWidth:
            value && typeof value === "object" ? /** @type {Viewport} */ (value).width : undefined,
          viewportHeight:
            value && typeof value === "object" ? /** @type {Viewport} */ (value).height : undefined
        }
      }
    );
  }
  return /** @type {Viewport} */ (value);
}

/**
 * Clip a rectangle to the viewport. Returns null when there is no overlap.
 *
 * @param {Rect} rect
 * @param {Viewport} viewport
 * @returns {Rect | null}
 */
export function clipRectToViewport(rect, viewport) {
  const box = assertRect(rect, "rect");
  const view = assertViewport(viewport);
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const right = Math.min(view.width, box.x + box.width);
  const bottom = Math.min(view.height, box.y + box.height);
  if (right <= x || bottom <= y) {
    return null;
  }
  return roundRect({
    x,
    y,
    width: right - x,
    height: bottom - y
  });
}

/**
 * Force a rectangle fully inside the viewport by clamping position.
 *
 * @param {Rect} rect
 * @param {Viewport} viewport
 * @returns {Rect}
 */
export function clampRectToViewport(rect, viewport) {
  const box = assertRect(rect, "rect");
  const view = assertViewport(viewport);
  const width = Math.min(box.width, view.width);
  const height = Math.min(box.height, view.height);
  const x = Math.min(Math.max(0, box.x), view.width - width);
  const y = Math.min(Math.max(0, box.y), view.height - height);
  return roundRect({ x, y, width, height });
}

/**
 * Deterministic numbered-callout placement. Prefers the top-right of the target,
 * then top-left, bottom-right, bottom-left; finally clamps into the viewport.
 *
 * @param {Rect} targetBox
 * @param {Viewport} viewport
 * @param {{ size?: number }} [options]
 */
export function placeCallout(targetBox, viewport, { size = 28 } = {}) {
  const target = assertRect(targetBox, "targetBox");
  const view = assertViewport(viewport);
  if (!Number.isFinite(size) || size <= 0) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "callout size must be a positive finite number."
    );
  }

  /** @type {Array<{ id: string, x: number, y: number }>} */
  const candidates = [
    { id: "top-right", x: target.x + target.width - size / 2, y: target.y - size / 2 },
    { id: "top-left", x: target.x - size / 2, y: target.y - size / 2 },
    {
      id: "bottom-right",
      x: target.x + target.width - size / 2,
      y: target.y + target.height - size / 2
    },
    { id: "bottom-left", x: target.x - size / 2, y: target.y + target.height - size / 2 }
  ];

  for (const candidate of candidates) {
    const box = roundRect({ x: candidate.x, y: candidate.y, width: size, height: size });
    if (isFullyInside(box, view)) {
      return { ...box, placement: candidate.id };
    }
  }

  const clamped = clampRectToViewport(
    { x: target.x + target.width - size / 2, y: target.y - size / 2, width: size, height: size },
    view
  );
  return { ...clamped, placement: "clamped" };
}

/**
 * Estimate caption box size from text using a deterministic monospace approximation.
 *
 * @param {string} caption
 * @param {{ fontSize?: number, padding?: number, maxWidth?: number, lineHeight?: number }} [options]
 */
export function estimateCaptionSize(
  caption,
  { fontSize = 14, padding = 10, maxWidth = 360, lineHeight = 1.35 } = {}
) {
  if (typeof caption !== "string" || caption.trim().length === 0) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "caption must be a non-empty string."
    );
  }
  const charWidth = fontSize * 0.6;
  const maxTextWidth = Math.max(40, maxWidth - padding * 2);
  const words = caption.trim().split(/\s+/);
  /** @type {string[]} */
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length * charWidth <= maxTextWidth) {
      current = next;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
    }
    if (word.length * charWidth <= maxTextWidth) {
      current = word;
    } else {
      // Hard-wrap very long tokens.
      let remaining = word;
      while (remaining.length * charWidth > maxTextWidth) {
        const fit = Math.max(1, Math.floor(maxTextWidth / charWidth));
        lines.push(remaining.slice(0, fit));
        remaining = remaining.slice(fit);
      }
      current = remaining;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const width = Math.min(maxWidth, Math.ceil(longest * charWidth + padding * 2));
  const height = Math.ceil(lines.length * fontSize * lineHeight + padding * 2);
  return {
    width,
    height,
    lines,
    fontSize,
    padding,
    lineHeight
  };
}

/**
 * Deterministic caption placement that stays in viewport and does not cover the target.
 * Preference order: below, above, right, left; then clamped below with reduced overlap risk.
 *
 * @param {Rect} targetBox
 * @param {Viewport} viewport
 * @param {string} caption
 * @param {{ fontSize?: number, padding?: number, maxWidth?: number, lineHeight?: number, gap?: number }} [options]
 */
export function placeCaption(targetBox, viewport, caption, options = {}) {
  const target = assertRect(targetBox, "targetBox");
  const view = assertViewport(viewport);
  const gap = options.gap ?? 12;
  const estimated = estimateCaptionSize(caption, options);
  const { width, height } = estimated;

  /** @type {Array<{ id: string, x: number, y: number }>} */
  const candidates = [
    {
      id: "below",
      x: target.x + target.width / 2 - width / 2,
      y: target.y + target.height + gap
    },
    {
      id: "above",
      x: target.x + target.width / 2 - width / 2,
      y: target.y - height - gap
    },
    {
      id: "right",
      x: target.x + target.width + gap,
      y: target.y + target.height / 2 - height / 2
    },
    {
      id: "left",
      x: target.x - width - gap,
      y: target.y + target.height / 2 - height / 2
    }
  ];

  for (const candidate of candidates) {
    const box = roundRect({ x: candidate.x, y: candidate.y, width, height });
    if (isFullyInside(box, view) && !rectsIntersect(box, target)) {
      return {
        ...box,
        placement: candidate.id,
        lines: estimated.lines,
        fontSize: estimated.fontSize,
        padding: estimated.padding,
        lineHeight: estimated.lineHeight
      };
    }
  }

  for (const candidate of candidates) {
    const clamped = clampRectToViewport(
      { x: candidate.x, y: candidate.y, width, height },
      view
    );
    if (!rectsIntersect(clamped, target)) {
      return {
        ...clamped,
        placement: `${candidate.id}-clamped`,
        lines: estimated.lines,
        fontSize: estimated.fontSize,
        padding: estimated.padding,
        lineHeight: estimated.lineHeight
      };
    }
  }

  throw createAnnotationError(
    AnnotationErrorCode.INVALID_INPUT,
    "Caption cannot be placed inside the viewport without covering the target."
  );
}

/**
 * @param {Rect} rect
 * @param {Viewport} viewport
 */
export function isFullyInside(rect, viewport) {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= viewport.width &&
    rect.y + rect.height <= viewport.height
  );
}

/**
 * @param {Rect} a
 * @param {Rect} b
 */
export function rectsIntersect(a, b) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/**
 * @param {Rect} rect
 * @returns {Rect}
 */
export function roundRect(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}
