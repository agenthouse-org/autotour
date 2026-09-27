import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import {
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  startServer
} from "../../fixtures/demo-app/server.js";
import {
  captureJourney,
  createProfileJourney,
  validateWalkthroughDocument
} from "../../src/capture/index.js";

test("DOM capture produces secret-safe offline autoplay players per module", { timeout: 60000 }, async () => {
  const app = await startServer({
    username: DEFAULT_USERNAME,
    password: DEFAULT_PASSWORD
  });
  const sourceBaseUrl = app.baseUrl;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-dom-"));
  let result;

  try {
    result = await captureJourney({
      baseUrl: sourceBaseUrl,
      goal: "Show how to update a profile.",
      outputDir,
      env: {
        AUTOTOUR_USERNAME: DEFAULT_USERNAME,
        AUTOTOUR_PASSWORD: DEFAULT_PASSWORD
      },
      journey: createProfileJourney({ displayName: "Replay User" }),
      recordDom: {
        viewport: { width: 960, height: 540 }
      }
    });
  } finally {
    await app.close();
  }

  assert.deepEqual(Object.keys(result.domPaths), ["sign-in", "update-profile"]);
  assert.equal(result.domIndexPath, path.join(outputDir, "index.html"));
  assert.ok((await stat(result.domIndexPath)).size > 0);
  assert.deepEqual(result.walkthrough.outputs, ["dom"]);
  assert.equal((await validateWalkthroughDocument(result.walkthrough)).valid, true);
  assert.ok((await stat(path.join(outputDir, "runtime", "rrweb-LICENSE.txt"))).size > 0);

  const modules = Object.fromEntries(result.walkthrough.modules.map((module) => [module.id, module]));
  assert.equal(modules["sign-in"].assets.dom, "modules/sign-in/dom/index.html");
  assert.equal(modules["update-profile"].assets.dom, "modules/update-profile/dom/index.html");

  for (const moduleId of ["sign-in", "update-profile"]) {
    const playerPath = path.join(outputDir, "modules", moduleId, "dom", "index.html");
    const eventsPath = path.join(outputDir, "modules", moduleId, "dom", "events.json");
    assert.equal(result.domPaths[moduleId], playerPath);
    assert.ok((await stat(playerPath)).size > 0);
    assert.ok((await stat(eventsPath)).size > 0);

    const eventsText = await readFile(eventsPath, "utf8");
    const events = JSON.parse(eventsText);
    assert.ok(events.some((event) => event.type === 4), `${moduleId} needs a Meta event`);
    assert.ok(events.some((event) => event.type === 2), `${moduleId} needs a FullSnapshot event`);
    assert.ok(
      events.at(-1).timestamp - events[0].timestamp >= 1400,
      `${moduleId} needs readable presentation pacing`
    );
    assert.equal(eventsText.includes(DEFAULT_USERNAME), false);
    assert.equal(eventsText.includes(DEFAULT_PASSWORD), false);
  }

  const replayServer = await startStaticServer(outputDir);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ javaScriptEnabled: true });
  const page = await context.newPage();
  const requestedUrls = [];
  page.on("request", (request) => requestedUrls.push(request.url()));

  try {
    await page.goto(`${replayServer.baseUrl}/index.html`);
    await page.locator("body[data-current-module='sign-in']").waitFor();
    await page.locator("body[data-current-module='update-profile']").waitFor({ timeout: 5000 });
    assert.equal(await page.locator("#progress").innerText(), "2 / 2");
    assert.equal(
      await page.getByRole("tab", { name: "Update profile" }).getAttribute("aria-selected"),
      "true"
    );
    await page.getByRole("tab", { name: "Sign in" }).click();
    await page.locator("body[data-current-module='sign-in']").waitFor();

    await page.goto(`${replayServer.baseUrl}/modules/sign-in/dom/index.html`);
    await page.locator("body[data-autoplay='started']").waitFor();
    const replayFrame = page.locator("#replay iframe");
    await replayFrame.waitFor();
    const replayBox = await replayFrame.boundingBox();
    assert.ok(replayBox.width >= 320);
    assert.ok(replayBox.height >= 240);
    const sandbox = await replayFrame.getAttribute("sandbox");
    assert.ok(sandbox !== null);
    assert.equal(sandbox.includes("allow-scripts"), false);

    const frameBody = page.frameLocator("#replay iframe").locator("body");
    const replayHeading = frameBody.getByRole("heading", { name: /Sign in|Profile settings/ }).first();
    await replayHeading.waitFor({
      state: "visible",
      timeout: 5000
    });
    const headingBox = await replayHeading.boundingBox();
    assert.ok(headingBox.width >= 40);
    assert.ok(headingBox.height >= 20);
    const frameText = await frameBody.textContent();
    assert.match(frameText, /Sign in|Profile settings/);

    await page.getByRole("button", { name: "Pause replay" }).click();
    assert.equal(await page.locator("#status").innerText(), "Paused");
    await page.getByRole("button", { name: "Restart replay" }).click();
    assert.equal(await page.locator("#status").innerText(), "Playing");

    assert.equal(requestedUrls.some((url) => url.startsWith(sourceBaseUrl)), false);
  } finally {
    await context.close();
    await browser.close();
    await replayServer.close();
  }
});

test("DOM capture rejects invalid presentation pacing before browsing", async () => {
  await assert.rejects(
    captureJourney({
      baseUrl: "http://127.0.0.1:1",
      goal: "Reject invalid pacing.",
      outputDir: path.join(os.tmpdir(), "autotour-invalid-dom-pacing"),
      env: {
        AUTOTOUR_USERNAME: DEFAULT_USERNAME,
        AUTOTOUR_PASSWORD: DEFAULT_PASSWORD
      },
      journey: createProfileJourney(),
      recordDom: { stepDelayMs: -1 }
    }),
    /DOM step delay must be an integer between 0 and 30000 milliseconds/
  );
});

async function startStaticServer(root) {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relative = pathname.replace(/^\/+/, "") || "index.html";
      const filePath = path.resolve(root, relative);
      if (!filePath.startsWith(path.resolve(root) + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filePath);
      const extension = path.extname(filePath);
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8"
      };
      response.writeHead(200, { "Content-Type": types[extension] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

