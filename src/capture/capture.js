import { mkdir } from "node:fs/promises";
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

/**
 * @typedef {object} CaptureOptions
 * @property {string} baseUrl
 * @property {string} goal
 * @property {string} [usernameEnv]
 * @property {string} [passwordEnv]
 * @property {string} [displayName]
 * @property {string} [outputDir]
 * @property {object} [journey]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {import('playwright').Page} [page]
 * @property {() => Promise<{ page: import('playwright').Page, close?: () => Promise<void> }>} [createSession]
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
    baseUrl,
    goal,
    usernameEnv = "AUTOTOUR_USERNAME",
    passwordEnv = "AUTOTOUR_PASSWORD",
    displayName,
    outputDir = path.resolve(".autotour", "output", "capture"),
    env = process.env,
    page: injectedPage,
    createSession,
    journey: journeyOverride
  } = options;

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

  const username = env[usernameEnv];
  const password = env[passwordEnv];
  const secrets = collectSecretValues([username, password]);

  if (typeof username !== "string" || username.length === 0) {
    throw new CaptureError({
      message: `Missing credential environment variable ${usernameEnv}.`,
      cause: `${usernameEnv} is unset or empty`,
      secrets
    });
  }
  if (typeof password !== "string" || password.length === 0) {
    throw new CaptureError({
      message: `Missing credential environment variable ${passwordEnv}.`,
      cause: `${passwordEnv} is unset or empty`,
      secrets
    });
  }

  const journey =
    journeyOverride ??
    createProfileJourney({ usernameEnv, passwordEnv, displayName });

  let sessionClose = async () => {};
  let page = injectedPage;
  if (!page) {
    const session = createSession
      ? await createSession()
      : await openPlaywrightSession();
    page = session.page;
    sessionClose = session.close ?? sessionClose;
  }

  const observer = observeSameOriginRequests(page, parsedBase);
  /** @type {object[]} */
  const capturedModules = [];

  try {
    for (const module of journey.modules) {
      const moduleRequests = [];
      const capturedSteps = [];

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

      capturedModules.push({
        id: module.id,
        title: module.title,
        route: module.route,
        steps: capturedSteps,
        observedRequests: moduleRequests
      });
    }

    const walkthrough = buildWalkthrough({
      id: journey.id,
      title: journey.title,
      baseUrl: parsedBase.toString().replace(/\/$/, ""),
      goal,
      modules: capturedModules,
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
    await mkdir(outputDir, { recursive: true });
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
  } finally {
    observer.stop();
    await sessionClose();
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

async function openPlaywrightSession() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  return {
    page,
    async close() {
      await browser.close();
    }
  };
}
