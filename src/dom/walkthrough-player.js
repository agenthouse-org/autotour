import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeWalkthroughReplay(outputDir, walkthrough) {
  const replayPath = path.join(outputDir, "index.html");
  await writeFile(replayPath, `${buildWalkthroughReplayHtml(walkthrough)}\n`, "utf8");
  return replayPath;
}

export function buildWalkthroughReplayHtml(walkthrough) {
  const modules = walkthrough.modules
    .filter((module) => module.assets.dom)
    .map((module) => ({
      id: module.id,
      title: module.title,
      src: module.assets.dom
    }));
  const moduleJson = JSON.stringify(modules).replaceAll("<", "\\u003c");
  const safeTitle = escapeHtml(walkthrough.title);

  return `<!doctype html>
<html lang="${escapeHtml(walkthrough.language ?? "en")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self';">
  <title>${safeTitle} - AutoTour</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #0b0d0c; color: #f4f7f5; }
    * { box-sizing: border-box; }
    body { margin: 0; height: 100vh; display: flex; flex-direction: column; background: #0b0d0c; }
    [hidden] { display: none !important; }
    header { min-height: 58px; display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid #343936; background: #151816; }
    h1 { min-width: 0; flex: 1; margin: 0; font-size: 16px; line-height: 1.25; font-weight: 650; }
    #progress { color: #b7c1bb; font-size: 12px; white-space: nowrap; }
    nav { display: flex; gap: 2px; overflow-x: auto; padding: 8px 12px 0; background: #101311; border-bottom: 1px solid #343936; }
    nav button { min-height: 38px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #aab3ad; font: inherit; cursor: pointer; white-space: nowrap; }
    nav button:hover { color: #f4f7f5; background: #1b201d; }
    nav button[aria-selected="true"] { color: #f4f7f5; border-bottom-color: #8dff32; }
    nav button:focus-visible { outline: 2px solid #8dff32; outline-offset: -2px; }
    main { flex: 1; min-height: 0; padding: 0; background: #050706; }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: #050706; }
  </style>
</head>
<body data-current-module="">
  <header>
    <h1>${safeTitle}</h1>
    <span id="progress" aria-live="polite"></span>
  </header>
  <nav aria-label="Walkthrough modules" role="tablist"></nav>
  <main><iframe id="module-frame" title="Walkthrough module" sandbox="allow-scripts allow-same-origin"></iframe></main>
  <script id="autotour-modules" type="application/json">${moduleJson}</script>
  <script>
    (() => {
      const modules = JSON.parse(document.getElementById("autotour-modules").textContent);
      const frame = document.getElementById("module-frame");
      const nav = document.querySelector("nav");
      const progress = document.getElementById("progress");
      let currentIndex = 0;
      let advanceTimer;

      const selectModule = (index) => {
        window.clearTimeout(advanceTimer);
        currentIndex = index;
        const module = modules[index];
        document.body.dataset.currentModule = module.id;
        progress.textContent = String(index + 1) + " / " + String(modules.length);
        for (const [buttonIndex, button] of [...nav.children].entries()) {
          button.setAttribute("aria-selected", String(buttonIndex === index));
          button.tabIndex = buttonIndex === index ? 0 : -1;
        }
        frame.title = module.title;
        frame.src = module.src;
      };

      modules.forEach((module, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = module.title;
        button.setAttribute("role", "tab");
        button.id = "module-tab-" + index;
        button.setAttribute("aria-controls", "module-panel");
        button.addEventListener("keydown", event => {
          const indexToSelect = event.key === "ArrowRight" ? (currentIndex + 1) % modules.length :
            event.key === "ArrowLeft" ? (currentIndex + modules.length - 1) % modules.length :
            event.key === "Home" ? 0 : event.key === "End" ? modules.length - 1 : null;
          if (indexToSelect !== null) { event.preventDefault(); selectModule(indexToSelect); nav.children[indexToSelect].focus(); }
        });
        button.addEventListener("click", () => selectModule(index));
        nav.append(button);
      });

      window.addEventListener("message", (event) => {
        if (event.source !== frame.contentWindow) return;
        if (event.origin !== location.origin) return;
        if (event.data?.type !== "autotour:module-finished") return;
        if (event.data.moduleId !== modules[currentIndex]?.id) return;
        if (currentIndex >= modules.length - 1) return;
        advanceTimer = window.setTimeout(() => selectModule(currentIndex + 1), 1200);
      });

      const panel = document.querySelector("main");
      panel.id = "module-panel";
      panel.setAttribute("role", "tabpanel");
      nav.hidden = modules.length <= 1;
      frame.addEventListener("load", () => panel.setAttribute("aria-labelledby", "module-tab-" + currentIndex));
      if (modules.length > 0) selectModule(0);
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
