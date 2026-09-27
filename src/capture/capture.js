import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { CaptureError } from "./errors.js";
import { executeStep } from "./execute.js";
import { createProfileJourney } from "./journey.js";
import {
  buildCaptureSteps,
  buildWalkthrough,
  validateWalkthroughDocument,
  writeCaptureArtifacts
} from "./manifest.js";
import { diffObservations, observeSameOriginRequests } from "./observe.js";
import { collectSecretValues, containsSecret, redactValue } from "./redact.js";
import { openPlaywrightDomSession } from "../dom/session.js";

/**
 * @typedef {object} CaptureOptions
 * @property {string} [baseUrl]
 * @property {string} [goal]
 * @property {string} [usernameEnv]
 * @property {string} [passwordEnv]
 * @property {string} [displayName]
 * @property {string} [outputDir]
 * @property {object} [journey]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {import('playwright').Page} [page]
 * @property {() => Promise<{ page: import('playwright').Page, close?: () => Promise<void> }>} [createSession]
 * @property {false | { size?: { width: number, height: number }, viewport?: { width: number, height: number }, showActions?: object }} [recordVideo]
 * @property {false | { viewport?: { width: number, height: number } }} [recordDom]
 */

/**
 * Capture the declarative login/profile journey as a schema-valid walkthrough
 * and ST-03 capture-step records. Secrets are referenced by environment name
 * only and aggressively redacted from artifacts and errors.
 *
 * @param {CaptureOptions} options
 */
export async function captureJourney(options = {}) {
  const {
    baseUrl: requestedBaseUrl,
    goal: requestedGoal,
    usernameEnv = "AUTOTOUR_USERNAME",
    passwordEnv = "AUTOTOUR_PASSWORD",
    displayName,
    outputDir = path.resolve(".autotour", "output", "capture"),
    env = process.env,
    page: injectedPage,
    createSession,
    journey: journeyOverride,
    recordVideo = false,
    recordDom = false
  } = options;

  const journey = normalizeExecutableJourney(
    journeyOverride ?? createProfileJourney({ usernameEnv, passwordEnv, displayName })
  );
  const baseUrl = requestedBaseUrl ?? journey.target?.baseUrl;
  const goal = requestedGoal ?? journey.target?.goal;

  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new CaptureError({
      message: "capture requires a baseUrl",
      cause: "baseUrl is missing"
    });
  }
  if (typeof goal !== "string" || goal.trim() === "") {
    throw new CaptureError({
      message: "capture requires a journey goal",
      cause: "goal is missing"
    });
  }

  let parsedBase;
  try {
    parsedBase = new URL(baseUrl);
  } catch (error) {
    throw new CaptureError({
      message: `capture baseUrl is invalid: ${baseUrl}`,
      cause: error.message
    });
  }

  const environmentNames = collectEnvironmentNames(journey);
  const secrets = collectSecretValues(environmentNames.map((name) => env[name]));
  for (const name of environmentNames) {
    if (typeof env[name] !== "string" || env[name].length === 0) {
      throw new CaptureError({
        message: `Missing credential environment variable ${name}.`,
        cause: `${name} is unset or empty`,
        secrets
      });
    }
  }

  if (recordVideo && injectedPage) {
    throw new CaptureError({
      message: "Video capture cannot use an injected page.",
      cause: "Playwright video recording must be configured when the browser context is created",
      secrets
    });
  }
  if (recordVideo && createSession) {
    throw new CaptureError({
      message: "Video capture cannot use a custom single-page session.",
      cause: "module video recording requires AutoTour to own the Playwright browser context",
      secrets
    });
  }
  if (recordDom && (injectedPage || createSession)) {
    throw new CaptureError({
      message: "DOM capture requires an AutoTour-owned browser context.",
      cause: "rrweb must be installed before application scripts execute",
      secrets
    });
  }
  if (recordVideo && recordDom) {
    throw new CaptureError({
      message: "Combined DOM and video capture is not supported yet.",
      cause: "select one recorded output per capture run",
      secrets
    });
  }

  await mkdir(outputDir, { recursive: true });
  const session = await createCaptureSession({
    injectedPage,
    createSession,
    recordVideo,
    recordDom,
    secrets,
    outputDir
  });
  /** @type {object[]} */
  const capturedModules = [];
  /** @type {Record<string, string>} */
  const videoPaths = {};
  /** @type {Record<string, string>} */
  const domPaths = {};
  /** @type {Record<string, string>} */
  const domEventPaths = {};
  let captureError;

  try {
    for (const module of journey.modules) {
      const handle = await session.openModule(module);
      const page = handle.page;
      const observer = observeSameOriginRequests(page, parsedBase);
      const moduleRequests = [];
      const capturedSteps = [];

      let assets = {};
      let moduleError;
      try {
        for (const step of module.steps) {
          const before = observer.snapshot();
          await executeStep({
            page,
            baseUrl: parsedBase.toString(),
            module,
            step,
            env,
            secrets
          });
          // Allow microtasks/network handlers attached by page doubles to flush.
          await Promise.resolve();
          const observedRequests = uniquePreserve(diffObservations(before, observer.snapshot()));

          for (const entry of observedRequests) {
            if (!moduleRequests.includes(entry)) {
              moduleRequests.push(entry);
            }
          }

          capturedSteps.push({
            ...step,
            observedRequests
          });
        }
      } catch (error) {
        moduleError = error;
        throw error;
      } finally {
        observer.stop();
        try {
          assets = await handle.close();
        } catch (error) {
          if (!moduleError) throw error;
        }
      }

      if (assets.videoPath) videoPaths[module.id] = assets.videoPath;
      if (assets.domPath) domPaths[module.id] = assets.domPath;
      if (assets.domEventsPath) domEventPaths[module.id] = assets.domEventsPath;
      capturedModules.push({
        id: module.id,
        title: module.title,
        route: module.route,
        steps: capturedSteps,
        observedRequests: moduleRequests,
        dependencies: module.dependencies,
        publish: module.publish,
        assets: {
          ...(assets.video ? { video: assets.video } : {}),
          ...(assets.dom ? { dom: assets.dom } : {})
        }
      });
    }

    const walkthrough = buildWalkthrough({
      id: journey.id,
      title: journey.title,
      baseUrl: parsedBase.toString().replace(/\/$/, ""),
      goal,
      modules: capturedModules,
      outputs: recordVideo ? ["video"] : recordDom ? ["dom"] : ["screenshots"],
      publish: journey.publish,
      secrets
    });

    const validation = await validateWalkthroughDocument(walkthrough);
    if (!validation.valid) {
      throw new CaptureError({
        message: "Captured walkthrough failed schema validation.",
        cause: JSON.stringify(validation.errors),
        secrets
      });
    }

    const captureSteps = buildCaptureSteps(capturedModules, secrets);
    const paths = await writeCaptureArtifacts(outputDir, walkthrough, captureSteps);

    const result = {
      walkthrough,
      captureSteps,
      modules: redactValue(
        capturedModules.map((module) => ({
          id: module.id,
          route: module.route,
          stepIds: module.steps.map((step) => step.id),
          observedRequests: module.observedRequests
        })),
        secrets
      ),
      videoPaths,
      domPaths,
      domEventPaths,
      ...paths
    };

    if (containsSecret(result, secrets)) {
      throw new CaptureError({
        message: "Capture refused to return artifacts that still contain secrets.",
        cause: "secret residual detected after redaction",
        secrets
      });
    }

    return result;
  } catch (error) {
    captureError = error;
    throw error;
  } finally {
    try {
      await session.close();
    } catch (error) {
      if (!captureError) throw error;
    }
  }
}

function uniquePreserve(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function collectEnvironmentNames(journey) {
  return [...new Set(
    journey.modules.flatMap((module) =>
      module.steps.flatMap((step) => step.valueEnv ? [step.valueEnv] : [])
    )
  )];
}

function normalizeExecutableJourney(journey) {
  if (!journey || typeof journey !== "object" || !Array.isArray(journey.modules)) {
    throw new CaptureError({
      message: "capture requires a journey with modules",
      cause: "journey.modules is missing or invalid"
    });
  }

  return {
    ...journey,
    modules: journey.modules.map((module) => ({
      ...module,
      steps: module.steps.map((step) => ({
        ...step,
        target: step.target ?? parseSelector(step.selector)
      }))
    }))
  };
}

function parseSelector(selector) {
  if (selector === undefined) return undefined;
  if (typeof selector !== "string") {
    throw new CaptureError({
      message: "Journey selector must be a string.",
      cause: "selector is not a string"
    });
  }
  const roleMatch = /^role=([a-z][a-z0-9-]*)\[name=(.+)\]$/.exec(selector);
  const textMatch = /^text=(.+)$/.exec(selector);
  if (!roleMatch && !textMatch) {
    throw new CaptureError({
      message: `Unsupported journey selector: ${selector}`,
      cause: "expected role=<role>[name=<JSON string>] or text=<JSON string>"
    });
  }
  try {
    if (roleMatch) return { role: roleMatch[1], name: JSON.parse(roleMatch[2]) };
    return { text: JSON.parse(textMatch[1]) };
  } catch (error) {
    throw new CaptureError({
      message: `Unsupported journey selector: ${selector}`,
      cause: `selector name is not valid JSON: ${error.message}`
    });
  }
}

async function createCaptureSession({
  injectedPage,
  createSession,
  recordVideo,
  recordDom,
  secrets,
  outputDir
}) {
  if (injectedPage) return createSharedPageSession(injectedPage);
  if (createSession) {
    const custom = await createSession();
    const session = createSharedPageSession(custom.page);
    session.close = custom.close ?? session.close;
    return session;
  }
  if (recordVideo) return openPlaywrightVideoSession(recordVideo, outputDir);
  if (recordDom) return openPlaywrightDomSession(recordDom, outputDir, secrets);
  return openPlaywrightSession();
}

function createSharedPageSession(page) {
  return {
    async openModule() {
      return {
        page,
        async close() {
          return {};
        }
      };
    },
    async close() {}
  };
}

async function openPlaywrightSession() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  return {
    async openModule() {
      return {
        page,
        async close() {
          return {};
        }
      };
    },
    async close() {
      await browser.close();
    }
  };
}

async function openPlaywrightVideoSession(options, outputDir) {
  const { chromium } = await import("playwright");
  const temporaryDir = path.join(outputDir, ".video-temp");
  await mkdir(temporaryDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const recordVideo = { dir: temporaryDir };
  if (options.size) recordVideo.size = options.size;
  if (options.showActions) recordVideo.showActions = options.showActions;
  const context = await browser.newContext({
    viewport: options.viewport ?? options.size ?? { width: 1280, height: 720 },
    recordVideo,
    reducedMotion: "reduce"
  });

  return {
    async openModule(module) {
      const page = await context.newPage();
      const video = page.video();
      let closed = false;
      return {
        page,
        async close() {
          if (closed) return {};
          closed = true;
          await page.close();
          const temporaryPath = await video.path();
          const relativePath = path.posix.join("modules", module.id, "video.webm");
          const videoPath = path.join(outputDir, "modules", module.id, "video.webm");
          await mkdir(path.dirname(videoPath), { recursive: true });
          await rm(videoPath, { force: true });
          await rename(temporaryPath, videoPath);
          return { video: relativePath, videoPath };
        }
      };
    },
    async close() {
      await context.close();
      await browser.close();
      await rm(temporaryDir, { recursive: true, force: true });
    }
  };
}
