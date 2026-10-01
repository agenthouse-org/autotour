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
import { writeWalkthroughReplay } from "../dom/walkthrough-player.js";

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
 * @property {false | { viewport?: { width: number, height: number }, stepDelayMs?: number }} [recordDom]
 * @property {string[]} [moduleIds]
 * @property {object} [previousWalkthrough]
 * @property {object[]} [previousCaptureSteps]
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
    recordDom = false,
    moduleIds,
    previousWalkthrough,
    previousCaptureSteps
  } = options;

  const journey = normalizeExecutableJourney(
    journeyOverride ?? createProfileJourney({ usernameEnv, passwordEnv, displayName })
  );
  const selection = normalizeModuleSelection({
    journey,
    moduleIds,
    previousWalkthrough,
    previousCaptureSteps
  });
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
  const domStepDelayMs = normalizeDomStepDelay(recordDom, secrets);

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
    for (const module of selection.modulesToExecute) {
      const shouldCapture = selection.selectedIds.has(module.id);
      const handle = await session.openModule(module, { capture: shouldCapture });
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
          if (domStepDelayMs > 0 && shouldCapture) {
            await page.waitForTimeout(domStepDelayMs);
            await addDomPacingEvent(page);
          }
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

    const generatedWalkthrough = buildWalkthrough({
      id: journey.id,
      title: journey.title,
      baseUrl: parsedBase.toString().replace(/\/$/, ""),
      goal,
      modules: capturedModules,
      outputs: recordVideo ? ["video"] : recordDom ? ["dom"] : ["screenshots"],
      publish: journey.publish,
      secrets
    });
    const walkthrough = selection.selective
      ? mergeWalkthroughModules(generatedWalkthrough, previousWalkthrough, selection.selectedIds)
      : generatedWalkthrough;

    const validation = await validateWalkthroughDocument(walkthrough);
    if (!validation.valid) {
      throw new CaptureError({
        message: "Captured walkthrough failed schema validation.",
        cause: JSON.stringify(validation.errors),
        secrets
      });
    }

    const generatedCaptureSteps = buildCaptureSteps(capturedModules, secrets);
    const captureSteps = selection.selective
      ? mergeCaptureSteps(
        journey.modules,
        generatedCaptureSteps,
        previousCaptureSteps,
        selection.selectedIds
      )
      : generatedCaptureSteps;
    const paths = await writeCaptureArtifacts(outputDir, walkthrough, captureSteps);
    const domIndexPath = recordDom
      ? await writeWalkthroughReplay(outputDir, walkthrough)
      : undefined;

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
      regeneratedModuleIds: [...selection.selectedIds],
      executedModuleIds: selection.modulesToExecute.map((module) => module.id),
      ...(domIndexPath ? { domIndexPath } : {}),
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

function normalizeDomStepDelay(recordDom, secrets) {
  if (!recordDom) return 0;
  const value = typeof recordDom === "object"
    ? recordDom.stepDelayMs ?? 500
    : 500;
  if (!Number.isInteger(value) || value < 0 || value > 30000) {
    throw new CaptureError({
      message: "DOM step delay must be an integer between 0 and 30000 milliseconds.",
      cause: "recordDom.stepDelayMs is invalid",
      secrets
    });
  }
  return value;
}

async function addDomPacingEvent(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.evaluate(() => {
        globalThis.rrwebRecord.record.addCustomEvent("autotour:pacing", null);
      });
      return;
    } catch (error) {
      if (!isNavigationRace(error) || attempt === 4) throw error;
      await page.waitForTimeout(25);
    }
  }
}

function isNavigationRace(error) {
  return error instanceof Error && /execution context was destroyed|cannot find context/i.test(error.message);
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
    async openModule(module, { capture = true } = {}) {
      const page = await context.newPage();
      const video = page.video();
      let closed = false;
      return {
        page,
        async close() {
          if (closed) return {};
          closed = true;
          await page.close();
          if (!capture) {
            await video.delete();
            return {};
          }
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

function normalizeModuleSelection({ journey, moduleIds, previousWalkthrough, previousCaptureSteps }) {
  if (moduleIds === undefined) {
    return {
      selective: false,
      selectedIds: new Set(journey.modules.map((module) => module.id)),
      modulesToExecute: journey.modules
    };
  }
  if (!Array.isArray(moduleIds) || moduleIds.length === 0) {
    throw new CaptureError({
      message: "Selective capture requires at least one module id.",
      cause: "moduleIds is empty"
    });
  }
  if (!previousWalkthrough || !Array.isArray(previousCaptureSteps)) {
    throw new CaptureError({
      message: "Selective capture requires previous walkthrough and capture-step artifacts.",
      cause: "previous artifacts are missing"
    });
  }
  const knownIds = new Set(journey.modules.map((module) => module.id));
  const selectedIds = new Set(moduleIds);
  if (selectedIds.size !== moduleIds.length || moduleIds.some((id) => !knownIds.has(id))) {
    throw new CaptureError({
      message: "Selective capture module ids must be unique journey modules.",
      cause: "moduleIds contains duplicates or unknown modules"
    });
  }
  const previousIds = previousWalkthrough.modules?.map((module) => module.id) ?? [];
  if (previousWalkthrough.id !== journey.id ||
      previousIds.length !== journey.modules.length ||
      journey.modules.some((module, index) => previousIds[index] !== module.id)) {
    throw new CaptureError({
      message: "Previous walkthrough does not match the executable journey.",
      cause: "walkthrough identity or ordered modules differ"
    });
  }
  for (const module of previousWalkthrough.modules) {
    if (selectedIds.has(module.id)) continue;
    const expectedStepIds = module.steps.map((step) => step.id);
    const previousStepIds = previousCaptureSteps
      .filter((step) => step.moduleId === module.id)
      .map((step) => step.id);
    if (expectedStepIds.length !== previousStepIds.length ||
        expectedStepIds.some((id, index) => previousStepIds[index] !== id)) {
      throw new CaptureError({
        message: `Previous capture steps are incomplete for reusable module ${module.id}.`,
        cause: "capture-step ids do not match the previous walkthrough"
      });
    }
  }
  const lastSelectedIndex = Math.max(
    ...journey.modules.map((module, index) => selectedIds.has(module.id) ? index : -1)
  );
  return {
    selective: true,
    selectedIds,
    modulesToExecute: journey.modules.slice(0, lastSelectedIndex + 1)
  };
}

function mergeWalkthroughModules(generated, previous, selectedIds) {
  const generatedById = new Map(generated.modules.map((module) => [module.id, module]));
  const previousById = new Map(previous.modules.map((module) => [module.id, module]));
  return {
    ...generated,
    outputs: [...previous.outputs],
    modules: previous.modules.map((module) =>
      selectedIds.has(module.id) ? generatedById.get(module.id) : previousById.get(module.id)
    )
  };
}

function mergeCaptureSteps(modules, generatedSteps, previousSteps, selectedIds) {
  return modules.flatMap((module) => {
    const source = selectedIds.has(module.id) ? generatedSteps : previousSteps;
    return source.filter((step) => step.moduleId === module.id);
  });
}
