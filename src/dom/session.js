import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { buildReplayHtml } from "./player.js";
import { ensureReplayRuntime, loadRecorderBundle } from "./runtime.js";

export async function openPlaywrightDomSession(options, outputDir, secrets = []) {
  const recorderBundle = await loadRecorderBundle();
  await ensureReplayRuntime(outputDir);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 720 },
    reducedMotion: "reduce"
  });

  return {
    async openModule(module) {
      const events = [];
      const page = await context.newPage();
      await page.exposeBinding("__autotourRrwebEmit", (_source, event) => {
        events.push(event);
      });
      await page.addInitScript({ content: buildRecorderBootstrap(recorderBundle) });
      let closed = false;

      return {
        page,
        async close() {
          if (closed) return {};
          closed = true;
          await stopRecorder(page);
          await page.close();

          if (!events.some((event) => event.type === 2)) {
            throw new Error(`DOM capture for module ${module.id} has no full snapshot.`);
          }

          const serialized = `${JSON.stringify(events, null, 2)}\n`;
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
          await writeFile(playerPath, `${buildReplayHtml({
            moduleId: module.id,
            title: module.title,
            events
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

function buildRecorderBootstrap(bundle) {
  return `${bundle}\n;(() => {
    if (globalThis.top !== globalThis) return;
    const pending = new Set();
    globalThis.__autotourRrwebPending = pending;
    globalThis.__autotourRrwebStop = globalThis.rrwebRecord.record({
      emit(event) {
        const promise = globalThis.__autotourRrwebEmit(event);
        pending.add(promise);
        promise.finally(() => pending.delete(promise));
      },
      maskAllInputs: true,
      inlineStylesheet: true,
      recordCanvas: false,
      collectFonts: true
    });
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

