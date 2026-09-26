import { CaptureError } from "./errors.js";

/**
 * Resolve a Playwright locator from a role/name target contract.
 * @param {import('playwright').Page} page
 * @param {{ role: string, name: string }} target
 */
export function resolveTarget(page, target) {
  if (!target?.role || !target?.name) {
    throw new Error("target requires role and name");
  }
  return page.getByRole(target.role, { name: target.name, exact: true });
}

/**
 * Resolve a fill value from an environment reference or literal.
 * @param {object} step
 * @param {NodeJS.ProcessEnv} env
 * @param {Iterable<string>} secrets
 * @param {{ moduleId: string, stepId: string }} context
 */
export function resolveStepValue(step, env, secrets, context) {
  if (step.valueEnv) {
    const value = env[step.valueEnv];
    if (typeof value !== "string" || value.length === 0) {
      throw new CaptureError({
        message: `Missing environment variable ${step.valueEnv} for step ${context.stepId}.`,
        moduleId: context.moduleId,
        stepId: context.stepId,
        cause: `environment variable ${step.valueEnv} is unset or empty`,
        secrets
      });
    }
    return value;
  }
  if (typeof step.value === "string") {
    return step.value;
  }
  return undefined;
}

/**
 * Execute one declarative journey step against a Playwright-like page.
 * @param {object} options
 * @param {import('playwright').Page} options.page
 * @param {string} options.baseUrl
 * @param {object} options.module
 * @param {object} options.step
 * @param {NodeJS.ProcessEnv} options.env
 * @param {Iterable<string>} options.secrets
 */
export async function executeStep({ page, baseUrl, module, step, env, secrets }) {
  const context = { moduleId: module.id, stepId: step.id };
  try {
    switch (step.action) {
      case "goto": {
        const path = step.path ?? module.route;
        const url = new URL(path, baseUrl).toString();
        await page.goto(url, { waitUntil: "domcontentloaded" });
        break;
      }
      case "fill": {
        const value = resolveStepValue(step, env, secrets, context);
        if (value === undefined) {
          throw new Error("fill steps require valueEnv or value");
        }
        const locator = resolveTarget(page, step.target);
        await locator.fill(value);
        break;
      }
      case "click": {
        const locator = resolveTarget(page, step.target);
        await locator.click();
        break;
      }
      case "assert":
      case "wait":
      case "select": {
        throw new Error(`action ${step.action} is not supported by the MVP capture journey`);
      }
      default:
        throw new Error(`unknown action ${step.action}`);
    }
  } catch (error) {
    if (error instanceof CaptureError) {
      throw error;
    }
    throw new CaptureError({
      message: `Failed at module ${module.id}, step ${step.id}: ${error.message}`,
      moduleId: module.id,
      stepId: step.id,
      cause: error.message,
      secrets,
      original: error
    });
  }
}
