import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { buildReplayHtml } from "./player.js";
import { normalizeDomPresentation } from "./presentation.js";
import { ensureReplayRuntime, loadRecorderBundle } from "./runtime.js";

export async function openPlaywrightDomSession(options, outputDir, secrets = []) {
  const presentation = normalizeDomPresentation(options.presentation, secrets);
  const recorderBundle = await loadRecorderBundle();
  const recorderBootstrap = buildRecorderBootstrap(recorderBundle, options.redaction);
  await ensureReplayRuntime(outputDir);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 720 },
    reducedMotion: "reduce"
  });

  return {
    async openModule(module, { capture = true } = {}) {
      const events = [];
      const page = await context.newPage();
      if (!capture) {
        return {
          page,
          async close() {
            await page.close();
            return {};
          }
        };
      }
      await page.exposeBinding("__autotourRrwebEmit", (_source, event) => {
        events.push(event);
      });
      await page.addInitScript({ content: recorderBootstrap });
      let closed = false;

      return {
        page,
        async restartRecording() {
          await page.evaluate(async () => {
            globalThis.__autotourRrwebStop?.();
            await Promise.allSettled([...(globalThis.__autotourRrwebPending ?? [])]);
          });
          events.length = 0;
          await page.evaluate(() => globalThis.__autotourRrwebStart());
        },
        async close() {
          if (closed) return {};
          closed = true;
          await stopRecorder(page);
          await page.close();

          if (!events.some((event) => event.type === 2)) {
            throw new Error(`DOM capture for module ${module.id} has no full snapshot.`);
          }

          const serialized = `${JSON.stringify(events)}\n`;
          for (const secret of secrets) {
            if (secret && serialized.includes(secret)) {
              throw new Error(`DOM capture for module ${module.id} contains a protected value.`);
            }
          }

          const relativePlayerPath = path.posix.join("modules", module.id, "dom", "index.html");
          const moduleDirectory = path.join(outputDir, "modules", module.id, "dom");
          const playerPath = path.join(moduleDirectory, "index.html");
          const eventsPath = path.join(moduleDirectory, "events.json");
          await mkdir(moduleDirectory, { recursive: true });
          await writeFile(eventsPath, serialized, "utf8");
          const privacy = {
            emailOccurrences: (serialized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).length,
            localUrlOccurrences: (serialized.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?=[:/])/g) ?? []).length,
            note: "Heuristic counts only; inspect recorded content before sharing. No matching values are included."
          };
          await writeFile(path.join(moduleDirectory, "capture-report.json"), JSON.stringify({
            eventCount: events.length, eventBytes: Buffer.byteLength(serialized),
            durationMs: events.at(-1).timestamp - events[0].timestamp,
            privacy, capturedAt: new Date().toISOString(),
            moduleHash: createHash("sha256").update(JSON.stringify(module)).digest("hex")
          }, null, 2) + "\n");
          await writeFile(playerPath, `${buildReplayHtml({
            moduleId: module.id,
            title: module.title,
            language: options.language,
            autoplay: options.autoplay ?? true,
            eventsScript: options.inlineEvents === false,
            events,
            presentation
          })}\n`, "utf8");

          return {
            dom: relativePlayerPath,
            domPath: playerPath,
            domEventsPath: eventsPath
          };
        }
      };
    },
    async close() {
      await context.close();
      await browser.close();
    }
  };
}

function buildRecorderBootstrap(bundle, redaction = {}) {
  for (const key of ["blockSelector", "maskTextSelector"]) {
    if (redaction[key] !== undefined && typeof redaction[key] !== "string") throw new Error(`redaction.${key} must be a CSS selector string`);
  }
  return `${bundle}\n;(() => {
    if (globalThis.top !== globalThis) return;
    const pending = new Set();
    globalThis.__autotourRrwebPending = pending;
    globalThis.__autotourRrwebStart = () => {
    globalThis.__autotourRrwebStop = globalThis.rrwebRecord.record({
      emit(event) {
        const promise = globalThis.__autotourRrwebEmit(event);
        pending.add(promise);
        promise.finally(() => pending.delete(promise));
      },
      maskAllInputs: true,
      blockSelector: ${JSON.stringify(redaction.blockSelector ?? "[data-autotour-private]")},
      maskTextSelector: ${JSON.stringify(redaction.maskTextSelector ?? "[data-autotour-mask]")},
      inlineStylesheet: true,
      inlineImages: true,
      recordCanvas: false,
      collectFonts: true
    });
    };
    globalThis.__autotourRrwebStart();
  })();`;
}

async function stopRecorder(page) {
  if (page.isClosed()) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.evaluate(async () => {
        if (typeof globalThis.__autotourRrwebStop === "function") {
          globalThis.__autotourRrwebStop();
        }
        await Promise.allSettled([...(globalThis.__autotourRrwebPending ?? [])]);
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

