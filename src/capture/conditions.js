import { describeTarget, resolveTarget } from "./execute.js";
import { MAX_WAIT_MS } from "./limits.js";

// Scope stability checks to a meaningful region rather than unrelated background updates.
export async function waitForCondition(page, condition = {}) {
  const timeout = condition.timeoutMs ?? 10000;
  const stableFor = condition.stableForMs ?? 0;
  const stability = condition.stability === "content" ? "content" : "visual";
  for (const [name, value] of Object.entries({ timeout, stableFor })) {
    if (!Number.isInteger(value) || value < (name === "timeout" ? 1 : 0) || value > MAX_WAIT_MS) {
      throw new Error(`${name} must be an integer within 0..${MAX_WAIT_MS} milliseconds`);
    }
  }
  for (const key of ["count", "minimumCount"]) {
    if (condition[key] !== undefined && (!Number.isInteger(condition[key]) || condition[key] < 0)) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
  if (condition.networkIdle) await page.waitForLoadState("networkidle", { timeout });
  const locator = condition.target ? resolveTarget(page, condition.target) : page.locator("body");
  const absent = condition.state === "hidden" || condition.state === "detached";
  // Without a target, `text` means "this text is on the page", not "the body text equals it".
  const containsText = !condition.target && condition.text !== undefined;
  const deadline = Date.now() + timeout;
  let previous;
  let since = Date.now();
  let measurements = [];
  let countOK = false;
  let textOK = false;
  while (Date.now() <= deadline) {
    try {
      measurements = await measure(locator);
    } catch (error) {
      if (!isNavigationError(error)) throw error;
      // The page navigated while we measured it; wait for the next document and measure again.
      await page.waitForLoadState?.("domcontentloaded").catch(() => {});
      previous = undefined;
      since = Date.now();
      continue;
    }
    if (absent) {
      // "Absent for stableForMs": every match is invisible (hidden) or there is no match (detached).
      const ok = condition.state === "detached"
        ? measurements.length === 0
        : measurements.every(item => !item.visible);
      if (!ok) since = Date.now();
      if (ok && Date.now() - since >= stableFor) return;
      await page.waitForTimeout(Math.min(50, Math.max(1, deadline - Date.now())));
      continue;
    }
    countOK = (condition.count === undefined || measurements.length === condition.count) &&
      measurements.length >= (condition.minimumCount ?? (condition.count === 0 ? 0 : 1));
    textOK = (condition.text === undefined || (containsText
      ? measurements.some(item => normalizeText(item.visibleText ?? item.text).includes(normalizeText(condition.text)))
      : measurements.every(item => item.text === condition.text))) &&
      (condition.state !== "visible" || measurements.every(item => item.visible));
    const signature = JSON.stringify(measurements.map(item => stability === "content"
      ? item
      : { text: item.text, rect: item.rect, visible: item.visible }));
    if (!countOK || !textOK || signature !== previous) since = Date.now();
    previous = signature;
    if (countOK && textOK && Date.now() - since >= stableFor) return;
    await page.waitForTimeout(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  if (absent) {
    const target = condition.target ? describeTarget(condition.target) : "the page body";
    throw new Error(`${target} did not stay ${condition.state} for ${stableFor}ms within ${timeout}ms`);
  }
  throw new Error(conditionFailure(condition, measurements, countOK, textOK, timeout));
}

function measure(locator) {
  return locator.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { content: element.innerHTML, text: element.textContent, visibleText: element.innerText ?? element.textContent,
      rect: [rect.x, rect.y, rect.width, rect.height],
      visible: !!(rect.width && rect.height) && getComputedStyle(element).visibility !== "hidden" };
  }));
}

function isNavigationError(error) {
  return error instanceof Error &&
    /Execution context was destroyed|Cannot find context with specified id|frame was detached|navigat(ing|ion) .*interrupted/i.test(error.message);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function conditionFailure(condition, measurements, countOK, textOK, timeout) {
  if (!condition.target && condition.text !== undefined && countOK && !textOK) {
    return `the page does not contain the text ${JSON.stringify(condition.text)}`;
  }
  const target = condition.target ? describeTarget(condition.target) : "the page body";
  if (!countOK) {
    const expected = condition.count !== undefined ? condition.count : (condition.minimumCount ?? 1);
    if (measurements.length === 0 && expected !== 0) return `no element matched ${target}`;
    return `count was ${measurements.length} for ${target}; expected ${condition.count !== undefined ? condition.count : `at least ${expected}`}`;
  }
  if (!textOK) return `text or visibility did not match ${target}`;
  return `Condition did not settle within ${timeout}ms because text or layout kept changing for ${target}`;
}
