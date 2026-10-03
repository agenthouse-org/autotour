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
import { renderDomReplayVideo } from "../../src/dom/video.js";
import { normalizeDomPresentation } from "../../src/dom/presentation.js";

test("DOM capture produces secret-safe offline autoplay players per module", { timeout: 90000 }, async () => {
  const app = await startServer({
    username: DEFAULT_USERNAME,
    password: DEFAULT_PASSWORD
  });
  const sourceBaseUrl = app.baseUrl;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-dom-"));
  const replayJourney = createProfileJourney({ displayName: "Replay User" });
  const signInSteps = replayJourney.modules[0].steps;
  signInSteps.splice(1, 0, {
    id: "focus-email",
    action: "click",
    description: "Focus the email field.",
    target: { role: "textbox", name: "Email" }
  });
  signInSteps.splice(3, 0, {
    id: "focus-password",
    action: "click",
    description: "Focus the password field.",
    target: { role: "textbox", name: "Password" }
  });
  signInSteps.push({
    id: "hold-login-focus",
    action: "wait",
    description: "Hold the focused login result.",
    durationMs: 3500
  });
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
      journey: replayJourney,
      recordDom: {
        viewport: { width: 960, height: 540 },
        presentation: {
          cursor: { visible: true, scale: 1.7, moveDurationMs: 850, clickPulse: true, clickDurationMs: 800 },
          focus: { mode: "clicks", scale: 1.25, durationMs: 180, holdMs: 2400 },
          motion: { mode: "showcase", perspective: 1500, rotateX: 3, rotateY: -6, driftX: 20, driftY: -12, scale: 0.94, durationMs: 10000 },
          frame: { mode: "window", title: "AutoTour demo" },
          background: { mode: "gradient", from: "#111815", to: "#26342b" },
          padding: 32
        }
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
    if (moduleId === "sign-in") {
      assert.match(eventsText, /rr_dataURL/);
      assert.match(eventsText, /data:image\/png;base64/);
    }
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
    await page.locator("body[data-current-module='update-profile']").waitFor({ timeout: 10000 });
    assert.equal(await page.locator("#progress").innerText(), "2 / 2");
    assert.equal(
      await page.getByRole("tab", { name: "Update profile" }).getAttribute("aria-selected"),
      "true"
    );
    await page.getByRole("tab", { name: "Sign in" }).click();
    await page.locator("body[data-current-module='sign-in']").waitFor();

    await page.goto(`${replayServer.baseUrl}/modules/sign-in/dom/index.html`);
    await page.locator("body[data-autoplay='started']").waitFor();
    assert.equal(await page.locator("body").getAttribute("data-frame-mode"), "window");
    assert.equal(await page.locator("body").getAttribute("data-cursor-visible"), "true");
    assert.equal(await page.locator("body").getAttribute("data-motion-mode"), "showcase");
    assert.equal(await page.locator("#window-title").innerText(), "AutoTour demo");
    assert.match(await page.locator("#canvas").evaluate((element) => element.style.background), /linear-gradient/);
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
    const replayLogo = frameBody.getByRole("img", { name: "AutoTour" });
    await replayLogo.waitFor({ state: "visible", timeout: 2000 });
    assert.ok(await replayLogo.evaluate((image) => image.complete && image.naturalWidth > 0));

    await page.locator("body[data-focus-active='true']").waitFor({ timeout: 5000 });
    const firstFocusPoint = await page.locator("body").getAttribute("data-focus-point");
    const firstTransform = await page.locator("#replay").evaluate((element) => element.style.transform);
    assert.match(firstTransform, /translate\(.+\) scale\(1\.25\)/);
    await page.waitForFunction(
      (point) => document.body.dataset.focusActive === "true" &&
        document.body.dataset.focusPoint !== point,
      firstFocusPoint,
      { timeout: 5000 }
    );
    const secondTransform = await page.locator("#replay").evaluate((element) => element.style.transform);
    assert.notEqual(secondTransform, firstTransform);
    assert.equal(await page.locator("body").getAttribute("data-focus-active"), "true");
    const cursorBackground = await page.locator(".replayer-mouse").evaluate(
      (element) => getComputedStyle(element).backgroundImage
    );
    assert.match(cursorBackground, /data:image\/svg\+xml/);
    assert.match(cursorBackground, /fff|255/);
    const cursorMotion = await page.locator(".replayer-mouse").evaluate((element) => {
      const style = getComputedStyle(element);
      return { property: style.transitionProperty, duration: style.transitionDuration };
    });
    assert.match(cursorMotion.property, /left/);
    assert.match(cursorMotion.property, /top/);
    assert.match(cursorMotion.duration, /0\.85s/);
    await page.locator(".replayer-mouse.active").waitFor({ timeout: 5000 });
    const clickEmphasis = await page.locator(".replayer-mouse.active", { timeout: 5000 }).evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return { name: style.animationName, duration: style.animationDuration, border: style.borderTopWidth };
    });
    assert.equal(clickEmphasis.name, "autotour-click");
    assert.equal(clickEmphasis.duration, "0.8s");
    assert.equal(clickEmphasis.border, "3px");
    const showcaseMotion = await page.locator("#browser-frame").evaluate((element) => {
      const style = getComputedStyle(element);
      return { name: style.animationName, duration: style.animationDuration, transform: style.transform };
    });
    assert.equal(showcaseMotion.name, "autotour-showcase");
    assert.equal(showcaseMotion.duration, "10s");
    assert.notEqual(showcaseMotion.transform, "none");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedShowcaseMotion = await page.locator("#browser-frame").evaluate((element) => {
      const style = getComputedStyle(element);
      return { name: style.animationName, transform: style.transform };
    });
    assert.equal(reducedShowcaseMotion.name, "none");
    assert.notEqual(reducedShowcaseMotion.transform, "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator("body[data-focus-active='false']").waitFor({ timeout: 5000 });
    assert.equal(
      await page.locator("#replay").evaluate((element) => element.style.transform),
      "translate(0px, 0px) scale(1)"
    );

    await page.getByRole("button", { name: "Pause replay" }).click();
    assert.equal(await page.locator("#status").innerText(), "Paused");
    assert.equal(await page.locator("body").getAttribute("data-focus-active"), "false");
    await page.getByRole("button", { name: "Restart replay" }).click();
    assert.equal(await page.locator("#status").innerText(), "Playing");

    await page.setViewportSize({ width: 360, height: 640 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    assert.equal(requestedUrls.some((url) => url.startsWith(sourceBaseUrl)), false);

    const renderedVideo = path.join(outputDir, "presented-sign-in.webm");
    await renderDomReplayVideo({
      playerPath: result.domPaths["sign-in"],
      outputPath: renderedVideo,
      size: { width: 960, height: 540 },
      tailMs: 0,
      durationMs: 1000
    });
    assert.ok((await stat(renderedVideo)).size > 0);
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

test("DOM capture rejects invalid presentation profiles before browsing", async () => {
  await assert.rejects(
    captureJourney({
      baseUrl: "http://127.0.0.1:1",
      goal: "Reject invalid presentation.",
      outputDir: path.join(os.tmpdir(), "autotour-invalid-dom-presentation"),
      env: {
        AUTOTOUR_USERNAME: DEFAULT_USERNAME,
        AUTOTOUR_PASSWORD: DEFAULT_PASSWORD
      },
      journey: createProfileJourney(),
      recordDom: { presentation: { frame: { mode: "television" } } }
    }),
    /DOM presentation configuration is invalid/
  );
});

test("DOM video rendering rejects invalid fixed durations", async () => {
  await assert.rejects(
    renderDomReplayVideo({
      playerPath: "replay.html",
      outputPath: "replay.webm",
      durationMs: 99
    }),
    /durationMs must be an integer from 100 to 300000 milliseconds/
  );
});

test("DOM presentation supports passive cursor-free showcases", () => {
  const presentation = normalizeDomPresentation({
    cursor: { visible: false },
    motion: { mode: "showcase", rotateX: 4, rotateY: -8, durationMs: 10000 }
  });
  assert.equal(presentation.cursor.visible, false);
  assert.equal(presentation.motion.mode, "showcase");
  assert.equal(presentation.motion.rotateX, 4);
  assert.equal(presentation.motion.rotateY, -8);
  assert.equal(presentation.motion.durationMs, 10000);
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

