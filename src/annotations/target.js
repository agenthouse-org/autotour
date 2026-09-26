import { AnnotationErrorCode, createAnnotationError } from "./errors.js";

/**
 * @typedef {{ role: string, name: string }} RoleNameTarget
 */

/**
 * Normalize and validate the capture-step target locator contract.
 *
 * @param {unknown} target
 * @returns {RoleNameTarget}
 */
export function normalizeRoleNameTarget(target) {
  if (!target || typeof target !== "object") {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "target must be an object with role and name."
    );
  }
  const role = /** @type {{ role?: unknown, name?: unknown }} */ (target).role;
  const name = /** @type {{ role?: unknown, name?: unknown }} */ (target).name;
  if (typeof role !== "string" || role.trim().length === 0) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "target.role must be a non-empty string."
    );
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "target.name must be a non-empty string."
    );
  }
  return { role: role.trim(), name: name.trim() };
}

/**
 * Resolve a unique element by accessible role and name via Playwright.
 *
 * @param {import('playwright').Page} page
 * @param {RoleNameTarget} target
 * @param {{ stepId?: string }} [context]
 */
export async function locateByRoleName(page, target, context = {}) {
  const normalized = normalizeRoleNameTarget(target);
  const locator = page.getByRole(/** @type {import('playwright').ARIARole} */ (normalized.role), {
    name: normalized.name,
    exact: true
  });
  const count = await locator.count();
  if (count === 0) {
    throw createAnnotationError(
      AnnotationErrorCode.TARGET_NOT_FOUND,
      "No element matched the role/name target.",
      {
        details: {
          stepId: context.stepId,
          role: normalized.role,
          name: normalized.name
        }
      }
    );
  }
  if (count > 1) {
    throw createAnnotationError(
      AnnotationErrorCode.TARGET_AMBIGUOUS,
      "Multiple elements matched the role/name target.",
      {
        details: {
          stepId: context.stepId,
          role: normalized.role,
          name: normalized.name,
          matchCount: count
        }
      }
    );
  }
  return locator.first();
}
