/**
 * Structured annotation errors that never embed secrets or raw redaction values.
 */

export const AnnotationErrorCode = Object.freeze({
  INVALID_INPUT: "invalid_input",
  TARGET_NOT_FOUND: "target_not_found",
  TARGET_AMBIGUOUS: "target_ambiguous",
  TARGET_OUTSIDE_VIEWPORT: "target_outside_viewport",
  OUTPUT_FAILED: "output_failed",
  REDACTION_FAILED: "redaction_failed",
  RENDER_FAILED: "render_failed"
});

const SAFE_DETAIL_KEYS = new Set([
  "stepId",
  "moduleId",
  "role",
  "name",
  "path",
  "selectorCount",
  "textRuleCount",
  "matchCount",
  "viewportWidth",
  "viewportHeight"
]);

export class AnnotationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ details?: Record<string, unknown>, cause?: unknown }} [options]
   */
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AnnotationError";
    this.code = code;
    this.details = sanitizeDetails(details);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {{ details?: Record<string, unknown>, cause?: unknown }} [options]
 */
export function createAnnotationError(code, message, options = {}) {
  return new AnnotationError(code, message, options);
}

/**
 * @param {Record<string, unknown>} details
 */
export function sanitizeDetails(details = {}) {
  /** @type {Record<string, unknown>} */
  const safe = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_DETAIL_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}
