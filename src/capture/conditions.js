import { resolveTarget } from "./execute.js";

// Scope stability checks to a meaningful region rather than unrelated background updates.
export async function waitForCondition(page, condition = {}) {
  const timeout = condition.timeoutMs ?? 10000;
  const stableFor = condition.stableForMs ?? 0;
  for (const [name, value] of Object.entries({ timeout, stableFor })) {
    if (!Number.isInteger(value) || value < (name === "timeout" ? 1 : 0) || value > 30000) {
      throw new Error(`${name} must be an integer within 0..30000 milliseconds`);
    }
  }
  for (const key of ["count", "minimumCount"]) {
    if (condition[key] !== undefined && (!Number.isInteger(condition[key]) || condition[key] < 0)) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
  if (condition.networkIdle) await page.waitForLoadState("networkidle", { timeout });
  const locator = condition.target ? resolveTarget(page, condition.target) : page.locator("body");
  if (condition.state === "hidden" || condition.state === "detached") await locator.waitFor({ state: condition.state, timeout });
  if (condition.state === "hidden" || condition.state === "detached") return;
  const deadline = Date.now() + timeout;
  let previous;
  let since = Date.now();
  while (Date.now() <= deadline) {
    const measurements = await locator.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { content: element.innerHTML, text: element.textContent,
        rect: [rect.x, rect.y, rect.width, rect.height],
        visible: !!(rect.width && rect.height) && getComputedStyle(element).visibility !== "hidden" };
    }));
    const countOK = (condition.count === undefined || measurements.length === condition.count) &&
      measurements.length >= (condition.minimumCount ?? (condition.count === 0 ? 0 : 1));
    const textOK = (condition.text === undefined || measurements.every(item => item.text === condition.text)) &&
      (condition.state !== "visible" || measurements.every(item => item.visible));
    const signature = JSON.stringify(measurements);
    if (!countOK || !textOK || signature !== previous) since = Date.now();
    previous = signature;
    if (countOK && textOK && Date.now() - since >= stableFor) return;
    await page.waitForTimeout(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`Condition did not settle within ${timeout}ms (count, text, or layout changed)`);
}
