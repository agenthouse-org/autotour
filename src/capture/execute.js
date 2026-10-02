import { CaptureError } from "./errors.js";

/**
 * Resolve a Playwright locator from a role/name target contract.
 * @param {import('playwright').Page} page
 * @param {{ role?: string, name?: string, text?: string, index?: number }} target
 */
export function resolveTarget(page, target) {
  let locator;
  if (typeof target?.text === "string" && target.text.length > 0) {
    locator = page.getByText(target.text, { exact: true });
  } else if (target?.role && target?.name) {
    locator = page.getByRole(target.role, { name: target.name, exact: true });
  } else {
    throw new Error("target requires role/name or exact text");
  }
  if (target.index === undefined) return locator;
  if (!Number.isInteger(target.index) || target.index < 0) {
    throw new Error("target index must be a non-negative integer");
  }
  return locator.nth(target.index);
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
        await navigateToStableUrl(page, url);
        break;
      }
      case "fill": {
        const value = resolveStepValue(step, env, secrets, context);
        if (value === undefined) {
          throw new Error("fill steps require valueEnv or value");
        }
        const locator = resolveTarget(page, step.target);
        if (step.valueEnv && typeof locator.evaluate === "function") {
          await locator.evaluate((element) => {
            element.style.setProperty("-webkit-text-security", "disc");
            element.setAttribute("data-autotour-sensitive", "true");
          });
        }
        await locator.fill(value);
        break;
      }
      case "click": {
        const locator = resolveTarget(page, step.target);
        const timeoutMs = normalizeDuration(step.timeoutMs ?? 10000, "click timeoutMs", {
          minimum: 1
        });
        const beforeUrl = typeof page.url === "function" ? page.url() : undefined;
        try {
          await locator.click({ timeout: timeoutMs });
        } catch (error) {
          const afterUrl = typeof page.url === "function" ? page.url() : undefined;
          if (!isCompletedNavigationTimeout(error, beforeUrl, afterUrl)) throw error;
        }
        break;
      }
      case "select": {
        const value = resolveStepValue(step, env, secrets, context);
        if (value === undefined) {
          throw new Error("select steps require valueEnv or value");
        }
        const locator = resolveTarget(page, step.target);
        await locator.selectOption(value);
        break;
      }
      case "scroll": {
        const scroll = normalizeScroll(step.scroll);
        await page.evaluate(async ({ mode, x, y, durationMs }) => {
          const startX = window.scrollX;
          const startY = window.scrollY;
          const targetX = mode === "by" ? startX + x : x;
          const targetY = mode === "by" ? startY + y : y;

          if (durationMs === 0) {
            window.scrollTo(targetX, targetY);
            return;
          }

          await new Promise((resolve) => {
            const started = performance.now();
            const tick = (now) => {
              const progress = Math.min(1, (now - started) / durationMs);
              const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
              window.scrollTo(
                startX + (targetX - startX) * eased,
                startY + (targetY - startY) * eased
              );
              if (progress < 1) requestAnimationFrame(tick);
              else resolve();
            };
            requestAnimationFrame(tick);
          });
        }, scroll);
        break;
      }
      case "wait": {
        if (step.target) {
          const timeoutMs = normalizeDuration(step.timeoutMs ?? 5000, "wait timeoutMs", {
            minimum: 1
          });
          const locator = resolveTarget(page, step.target);
          await locator.waitFor({
            state: step.state ?? "visible",
            timeout: timeoutMs
          });
        } else {
          const durationMs = normalizeDuration(step.durationMs, "wait durationMs", {
            minimum: 0
          });
          await page.waitForTimeout(durationMs);
        }
        break;
      }
      case "assert": {
        const timeoutMs = normalizeDuration(step.timeoutMs ?? 5000, "assert timeoutMs", {
          minimum: 1
        });
        if (step.url) {
          const expectedUrl = new URL(step.url, baseUrl).toString();
          await page.waitForURL(expectedUrl, { timeout: timeoutMs });
          break;
        }
        if (step.target) {
          const locator = resolveTarget(page, step.target);
          await locator.waitFor({
            state: step.state ?? "visible",
            timeout: timeoutMs
          });
          break;
        }
        throw new Error("assert steps require url or target");
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

function isCompletedNavigationTimeout(error, beforeUrl, afterUrl) {
  return error instanceof Error &&
    /timeout/i.test(error.message) &&
    typeof beforeUrl === "string" &&
    typeof afterUrl === "string" &&
    beforeUrl !== afterUrl;
}

async function navigateToStableUrl(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    if (!(error instanceof Error) ||
        !/net::ERR_ABORTED|is interrupted by another navigation/i.test(error.message)) {
      throw error;
    }
    if (typeof page.waitForURL === "function") {
      try {
        await page.waitForURL(url, { waitUntil: "domcontentloaded", timeout: 5000 });
        return;
      } catch {
        // The competing navigation did not reach the requested URL; retry below.
      }
    }
    if (typeof page.waitForLoadState === "function") {
      await page.waitForLoadState("domcontentloaded");
    }
    if (samePageUrl(page.url?.(), url)) return;
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
}

function samePageUrl(current, expected) {
  if (typeof current !== "string") return false;
  try {
    const left = new URL(current);
    const right = new URL(expected);
    return left.origin === right.origin &&
      left.pathname === right.pathname &&
      left.search === right.search;
  } catch {
    return false;
  }
}

function normalizeScroll(value) {
  if (!value || typeof value !== "object") {
    throw new Error("scroll steps require a scroll object");
  }
  const mode = value.mode ?? "by";
  if (mode !== "by" && mode !== "to") {
    throw new Error('scroll mode must be "by" or "to"');
  }
  const x = normalizeCoordinate(value.x ?? 0, "scroll x");
  const y = normalizeCoordinate(value.y ?? 0, "scroll y");
  const durationMs = normalizeDuration(value.durationMs ?? 0, "scroll durationMs", {
    minimum: 0
  });
  return { mode, x, y, durationMs };
}

function normalizeCoordinate(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function normalizeDuration(value, label, { minimum }) {
  if (!Number.isInteger(value) || value < minimum || value > 30000) {
    throw new Error(`${label} must be an integer between ${minimum} and 30000`);
  }
  return value;
}
