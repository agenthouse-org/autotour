import { redactString, redactValue } from "./redact.js";

/**
 * Structured capture failure that never embeds credential values.
 */
export class CaptureError extends Error {
  /**
   * @param {object} options
   * @param {string} options.message
   * @param {string} [options.moduleId]
   * @param {string} [options.stepId]
   * @param {string} [options.cause]
   * @param {Iterable<string>} [options.secrets]
   * @param {Error} [options.original]
   */
  constructor({ message, moduleId, stepId, cause, secrets = [], original } = {}) {
    const safeMessage = redactString(message ?? "capture failed", secrets);
    super(safeMessage);
    this.name = "CaptureError";
    this.moduleId = moduleId ?? null;
    this.stepId = stepId ?? null;
    this.cause = cause ? redactString(String(cause), secrets) : safeMessage;
    this.details = redactValue(
      {
        moduleId: this.moduleId,
        stepId: this.stepId,
        cause: this.cause
      },
      secrets
    );
    if (original?.stack) {
      this.stack = redactString(original.stack, secrets);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      ...this.details
    };
  }
}
