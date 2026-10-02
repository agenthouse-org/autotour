import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export async function renderDomReplayVideo({
  playerPath,
  outputPath,
  size = { width: 1440, height: 900 },
  timeoutMs = 120000,
  tailMs = 500
}) {
  validateRenderOptions({ playerPath, outputPath, size, timeoutMs, tailMs });
  const absolutePlayerPath = path.resolve(playerPath);
  const absoluteOutputPath = path.resolve(outputPath);
  const temporaryDir = path.join(path.dirname(absoluteOutputPath), ".render-temp");
  await mkdir(temporaryDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: size,
    reducedMotion: "no-preference",
    recordVideo: { dir: temporaryDir, size }
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    const url = new URL(pathToFileURL(absolutePlayerPath));
    url.searchParams.set("render", "1");
    await page.goto(url.href);
    await page.locator("body[data-autoplay='started']").waitFor({ timeout: timeoutMs });
    await page.locator("#status").filter({ hasText: "Complete" }).waitFor({
      state: "attached",
      timeout: timeoutMs
    });
    if (tailMs > 0) await page.waitForTimeout(tailMs);
    await page.close();
    const temporaryPath = await video.path();
    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await rm(absoluteOutputPath, { force: true });
    await rename(temporaryPath, absoluteOutputPath);
    return absoluteOutputPath;
  } finally {
    if (!page.isClosed()) await page.close();
    await context.close();
    await browser.close();
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

function validateRenderOptions({ playerPath, outputPath, size, timeoutMs, tailMs }) {
  if (typeof playerPath !== "string" || playerPath.length === 0) {
    throw new TypeError("playerPath is required.");
  }
  if (typeof outputPath !== "string" || !outputPath.toLowerCase().endsWith(".webm")) {
    throw new TypeError("outputPath must be a .webm path.");
  }
  if (!Number.isInteger(size?.width) || size.width < 320 ||
      !Number.isInteger(size?.height) || size.height < 240) {
    throw new TypeError("size must have integer width >= 320 and height >= 240.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
    throw new TypeError("timeoutMs must be an integer of at least 1000 milliseconds.");
  }
  if (!Number.isInteger(tailMs) || tailMs < 0 || tailMs > 10000) {
    throw new TypeError("tailMs must be an integer from 0 to 10000 milliseconds.");
  }
}
