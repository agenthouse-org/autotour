import { normalizeDomPresentation } from "./presentation.js";

export function buildReplayHtml({ moduleId, title, events, presentation, language, autoplay = true, eventsScript = false }) {
  const findLanguage = node => node?.tagName === "html" ? node.attributes?.lang : node?.childNodes?.map(findLanguage).find(Boolean);
  language ??= findLanguage(events.find(event => event.type === 2)?.data?.node) ?? "en";
  const de = language.toLowerCase().startsWith("de");
  const labels = de ? { recorded: "Aufgezeichnete Produktführung – keine Live-Anwendung", play: "Abspielen", pause: "Pause", restart: "Neu starten", previous: "Vorheriger Schritt", next: "Nächster Schritt", timeline: "Zeitleiste", ready: "Bereit", playing: "Wiedergabe", paused: "Pausiert", complete: "Abgeschlossen", error: "Aufzeichnung konnte nicht geladen werden" } : { recorded: "Recorded walkthrough – not a live application", play: "Play replay", pause: "Pause replay", restart: "Restart replay", previous: "Previous step", next: "Next step", timeline: "Timeline", ready: "Ready", playing: "Playing", paused: "Paused", complete: "Complete", error: "Recording could not be loaded" };
  const eventJson = JSON.stringify(events).replaceAll("<", "\\u003c");
  const presentationJson = JSON.stringify(
    presentation ?? normalizeDomPresentation({})
  ).replaceAll("<", "\\u003c");
  const safeTitle = escapeHtml(title);
  const safeModuleId = escapeHtml(moduleId);

  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; frame-src 'self' data: blob:; child-src 'self' data: blob:">
  <title>${safeTitle} - AutoTour replay</title>
  <link rel="stylesheet" href="../../../runtime/rrweb-replay.css">
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #0b0d0c; color: #f4f7f5; }
    * { box-sizing: border-box; }
    body { margin: 0; height: 100vh; display: grid; grid-template-rows: auto auto minmax(0,1fr); background: #0b0d0c; }
    #timeline-controls { padding: 8px 16px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    #timeline { flex: 1; min-width: 80px; }
    #step-caption { flex-basis: 100%; margin: 0; }
    #replay { pointer-events: none; }
    [hidden] { display: none !important; }
    body[data-natural-size="true"] #canvas { width: max(100%, var(--natural-width)); height: auto; min-height: 100%; }
    #natural-size { width: auto; padding: 0 10px; }
    header { min-height: 58px; display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid #343936; background: #151816; }
    .identity { min-width: 0; flex: 1; }
    h1 { margin: 0; font-size: 16px; line-height: 1.25; font-weight: 650; }
    .module { margin: 3px 0 0; color: #aab3ad; font: 12px/1.2 ui-monospace, monospace; }
    .controls { display: flex; gap: 6px; }
    button { width: 36px; height: 36px; border: 1px solid #48504b; border-radius: 6px; background: #202522; color: #f4f7f5; font-size: 16px; cursor: pointer; }
    button:hover { border-color: #9da9a1; background: #2b322e; }
    button:focus-visible { outline: 2px solid #8dff32; outline-offset: 2px; }
    #status { width: 58px; color: #b7c1bb; font-size: 12px; text-align: right; }
    main { min-width: 0; min-height: 0; overflow: auto; background: #050706; }
    #canvas { min-width: 0; height: 100%; box-sizing: border-box; display: grid; place-items: center; padding: var(--canvas-padding); perspective: var(--motion-perspective); perspective-origin: center; }
    #browser-frame { width: 100%; max-width: var(--frame-max-width); overflow: hidden; border-radius: var(--frame-radius); background: #0a0c0b; box-shadow: var(--frame-shadow); transform-style: preserve-3d; backface-visibility: hidden; }
    #window-bar { height: 38px; display: none; align-items: center; gap: 7px; padding: 0 13px; border-bottom: 1px solid #343936; background: #1b1f1c; }
    .window-dot { width: 10px; height: 10px; border-radius: 50%; background: #606a64; }
    #window-title { min-width: 0; margin-left: 7px; overflow: hidden; color: #c6cec9; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    #viewport { position: relative; width: 100%; overflow: hidden; background: #050706; }
    #fit { position: absolute; inset: 0 auto auto 0; transform-origin: top left; }
    #replay { transform-origin: top left; transition: transform var(--focus-duration) cubic-bezier(.2,.8,.2,1); }
    #replay iframe { border: 0; }
    #replay .replayer-mouse {
      width: 24px;
      height: 30px;
      transition: left var(--cursor-move-duration) cubic-bezier(.22,.72,.24,1), top var(--cursor-move-duration) cubic-bezier(.22,.72,.24,1);
      transform: scale(var(--cursor-scale));
      transform-origin: top left;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 50'%3E%3Cpath d='M4 2v40l10-10 9 16 7-4-9-15h15z' fill='%23fff' stroke='%23000' stroke-width='2.5' stroke-linejoin='round'/%3E%3C/svg%3E");
    }
    #replay .replayer-mouse::after {
      width: 24px;
      height: 24px;
      background: rgba(158,255,61,.2);
      border: 3px solid #9eff3d;
      box-shadow: 0 0 0 2px rgba(0,0,0,.9);
      opacity: 0;
      transform: translate(-50%,-50%) scale(.4);
    }
    #replay .replayer-mouse.active::after { animation: autotour-click var(--click-duration) ease-out 1 !important; }
    body[data-cursor-visible="false"] #replay .replayer-mouse { display: none; }
    body[data-click-pulse="false"] #replay .replayer-mouse.active::after { animation: none; }
    @keyframes autotour-click {
      0% { opacity: .95; transform: translate(-50%,-50%) scale(.4); }
      30% { opacity: 1; transform: translate(-50%,-50%) scale(1); }
      100% { opacity: 0; transform: translate(-50%,-50%) scale(2.35); }
    }
    body[data-frame-mode="window"] #window-bar { display: flex; }
    body[data-frame-mode="pure"] #canvas { background: #050706 !important; }
    body[data-frame-mode="pure"] #browser-frame { border-radius: 0; box-shadow: none; }
    body[data-motion-mode="showcase"] #browser-frame { animation: autotour-showcase var(--motion-duration) cubic-bezier(.4,0,.2,1) both; }
    @keyframes autotour-showcase {
      from { transform: var(--motion-from); }
      to { transform: var(--motion-to); }
    }
    body[data-render="true"] { grid-template-rows: 1fr; }
    body[data-render="true"] > header, body[data-render="true"] > #timeline-controls { display: none; }
    body[data-render="true"] main { height: 100vh; }
    @media (max-width: 680px) {
      header { flex-wrap: wrap; }
      .identity { flex-basis: calc(100% - 72px); }
      #status { order: 3; width: 100%; text-align: left; }
      #canvas { padding: min(var(--canvas-padding), 16px); }
    }
    @media (prefers-reduced-motion: reduce) {
      #replay, #replay .replayer-mouse { transition: none; }
      #replay .replayer-mouse.active::after { animation: none !important; opacity: .85; transform: translate(-50%,-50%) scale(1); }
      body[data-click-pulse="false"] #replay .replayer-mouse.active::after { opacity: 0; }
      body[data-motion-mode="showcase"] #browser-frame { animation: none; transform: var(--motion-static); }
    }
  </style>
</head>
<body data-module-id="${safeModuleId}">
  <header>
    <div class="identity"><h1>${safeTitle}</h1><p class="module">${labels.recorded}</p></div>
    <div class="controls" aria-label="Replay controls">
      <button id="play" type="button" aria-label="${labels.play}" title="${labels.play}">▶</button>
      <button id="pause" type="button" aria-label="${labels.pause}" title="${labels.pause}">Ⅱ</button>
      <button id="restart" type="button" aria-label="${labels.restart}" title="${labels.restart}">↺</button>
    </div>
    <span id="status" aria-live="polite">${labels.ready}</span>
  </header>
  <div id="timeline-controls">
    <button id="previous-step" aria-label="${labels.previous}">‹</button>
    <input id="timeline" type="range" min="0" value="0" step="10" aria-label="${labels.timeline}">
    <button id="next-step" aria-label="${labels.next}">›</button>
    <button id="natural-size" aria-pressed="false" aria-label="${de ? 'Originalgröße umschalten' : 'Toggle original size'}">1:1</button>
    <span id="time"></span><p id="step-caption" aria-live="polite"></p>
  </div>
  <main>
    <div id="canvas">
      <section id="browser-frame" aria-label="Presented walkthrough">
        <div id="window-bar" aria-hidden="true">
          <span class="window-dot"></span><span class="window-dot"></span><span class="window-dot"></span>
          <span id="window-title"></span>
        </div>
        <div id="viewport"><div id="fit"><div id="replay" aria-label="Recorded walkthrough"></div></div></div>
      </section>
    </div>
  </main>
  <script src="../../../runtime/rrweb-replay.js"></script>
  ${eventsScript ? '' : `<script id="autotour-events" type="application/json">${eventJson}</script>`}
  <script id="autotour-presentation" type="application/json">${presentationJson}</script>
  <script>
    (async () => {
      const labels = ${JSON.stringify(labels)};
      window.addEventListener("error", () => { document.getElementById("status").textContent = labels.error; });
      window.addEventListener("unhandledrejection", () => { document.getElementById("status").textContent = labels.error; });
      const events = ${eventsScript ? '(await fetch("events.json").then(response => { if (!response.ok) throw new Error("Events unavailable"); return response.json(); }))' : 'JSON.parse(document.getElementById("autotour-events").textContent)'};
      const presentation = JSON.parse(document.getElementById("autotour-presentation").textContent);
      const status = document.getElementById("status");
      const canvas = document.getElementById("canvas");
      const frame = document.getElementById("browser-frame");
      const viewport = document.getElementById("viewport");
      const fit = document.getElementById("fit");
      const replayRoot = document.getElementById("replay");
      const meta = events.find((event) => event.type === 4)?.data ?? {};
      const replayWidth = Number.isFinite(meta.width) ? meta.width : 1280;
      const replayHeight = Number.isFinite(meta.height) ? meta.height : 720;
      const renderMode = new URLSearchParams(location.search).get("render") === "1";
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      let focusTimer;
      let naturalSize = false;
      document.documentElement.style.setProperty("--natural-width", (replayWidth + presentation.padding * 2) + "px");

      document.body.dataset.frameMode = presentation.frame.mode;
      document.body.dataset.cursorVisible = String(presentation.cursor.visible);
      document.body.dataset.clickPulse = String(presentation.cursor.clickPulse);
      document.body.dataset.motionMode = presentation.motion.mode;
      document.body.dataset.render = String(renderMode);
      document.getElementById("window-title").textContent = presentation.frame.title;
      document.documentElement.style.setProperty("--canvas-padding", presentation.padding + "px");
      document.documentElement.style.setProperty("--frame-radius", presentation.frame.cornerRadius + "px");
      document.documentElement.style.setProperty("--frame-shadow", presentation.frame.shadow ? "0 22px 54px rgba(0,0,0,.38)" : "none");
      document.documentElement.style.setProperty("--frame-max-width", replayWidth + "px");
      document.documentElement.style.setProperty("--cursor-scale", String(presentation.cursor.scale));
      document.documentElement.style.setProperty("--cursor-move-duration", presentation.cursor.moveDurationMs + "ms");
      document.documentElement.style.setProperty("--click-duration", presentation.cursor.clickDurationMs + "ms");
      document.documentElement.style.setProperty("--focus-duration", presentation.focus.durationMs + "ms");
      document.documentElement.style.setProperty("--motion-perspective", presentation.motion.perspective + "px");
      document.documentElement.style.setProperty("--motion-duration", presentation.motion.durationMs + "ms");
      const motion = presentation.motion;
      const fromScale = motion.scale;
      const toScale = Math.min(1, motion.scale + 0.025);
      const fromTransform = "translate3d(" + (-motion.driftX / 2) + "px," + (-motion.driftY / 2) + "px,0) rotateX(" + motion.rotateX + "deg) rotateY(" + motion.rotateY + "deg) scale(" + fromScale + ")";
      const toTransform = "translate3d(" + (motion.driftX / 2) + "px," + (motion.driftY / 2) + "px,18px) rotateX(" + (motion.rotateX * 0.55) + "deg) rotateY(" + (motion.rotateY * 0.6) + "deg) scale(" + toScale + ")";
      const staticTransform = "rotateX(" + (motion.rotateX * 0.75) + "deg) rotateY(" + (motion.rotateY * 0.8) + "deg) scale(" + motion.scale + ")";
      document.documentElement.style.setProperty("--motion-from", fromTransform);
      document.documentElement.style.setProperty("--motion-to", toTransform);
      document.documentElement.style.setProperty("--motion-static", staticTransform);
      replayRoot.style.width = replayWidth + "px";
      replayRoot.style.height = replayHeight + "px";
      fit.style.width = replayWidth + "px";
      fit.style.height = replayHeight + "px";

      if (presentation.background.mode === "gradient") {
        canvas.style.background = "linear-gradient(135deg, " + presentation.background.from + ", " + presentation.background.to + ")";
      } else if (presentation.background.mode === "solid") {
        canvas.style.background = presentation.background.color;
      } else {
        canvas.style.background = "transparent";
      }

      const resetFocus = () => {
        clearTimeout(focusTimer);
        replayRoot.style.transform = "translate(0px, 0px) scale(1)";
        document.body.dataset.focusActive = "false";
        document.body.dataset.focusPoint = "";
      };
      const focusClick = (event) => {
        if (presentation.focus.mode !== "clicks" || reducedMotion.matches) return;
        const x = Number(event.data?.x);
        const y = Number(event.data?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        clearTimeout(focusTimer);
        const scale = presentation.focus.scale;
        const minX = replayWidth - (replayWidth * scale);
        const minY = replayHeight - (replayHeight * scale);
        const translateX = Math.max(minX, Math.min(0, (replayWidth / 2) - (x * scale)));
        const translateY = Math.max(minY, Math.min(0, (replayHeight / 2) - (y * scale)));
        replayRoot.style.transform = "translate(" + translateX + "px, " + translateY + "px) scale(" + scale + ")";
        document.body.dataset.focusActive = "true";
        document.body.dataset.focusPoint = x + "," + y;
        focusTimer = setTimeout(resetFocus, presentation.focus.holdMs);
      };
      const fitReplay = () => {
        resetFocus();
        const chromeHeight = presentation.frame.mode === "window" ? 38 : 0;
        const canvasStyle = getComputedStyle(canvas);
        const verticalPadding = parseFloat(canvasStyle.paddingTop) + parseFloat(canvasStyle.paddingBottom);
        const availableHeight = Math.max(
          1,
          canvas.clientHeight - verticalPadding - chromeHeight
        );
        const scale = naturalSize ? 1 : Math.min(
          1,
          frame.clientWidth / replayWidth,
          availableHeight / replayHeight
        );
        fit.style.transform = "scale(" + scale + ")";
        fit.style.left = Math.max(0, Math.round((frame.clientWidth - (replayWidth * scale)) / 2)) + "px";
        viewport.style.height = Math.max(1, Math.round(replayHeight * scale)) + "px";
      };

      const replayer = new rrwebReplay.Replayer(events, {
        root: replayRoot,
        width: replayWidth,
        height: replayHeight,
        showWarning: false,
        mouseTail: false
      });
      document.getElementById("natural-size").addEventListener("click", event => {
        naturalSize = !naturalSize;
        document.body.dataset.naturalSize = String(naturalSize);
        event.currentTarget.setAttribute("aria-pressed", String(naturalSize));
        requestAnimationFrame(fitReplay);
      });
      const timeline = document.getElementById("timeline");
      const caption = document.getElementById("step-caption");
      const start = events[0]?.timestamp ?? 0;
      const duration = Math.max(0, (events.at(-1)?.timestamp ?? start) - start);
      const steps = events.filter(event => event.type === 5 && event.data?.tag === "autotour:step" && event.data.payload?.phase === "start");
      timeline.max = String(duration);
      const updatePosition = offset => {
        timeline.value = String(offset);
        document.getElementById("time").textContent = (offset / 1000).toFixed(1) + " / " + (duration / 1000).toFixed(1) + " s";
        const index = steps.findLastIndex(event => event.timestamp - start <= offset);
        caption.textContent = index < 0 ? "" : (index + 1) + " / " + steps.length + " · " + steps[index].data.payload.instruction + (steps[index].data.payload.narration ? " — " + steps[index].data.payload.narration : "");
      };
      const seek = offset => { resetFocus(); replayer.pause(offset); status.textContent = labels.paused; updatePosition(offset); };
      timeline.addEventListener("input", () => seek(Number(timeline.value)));
      document.getElementById("previous-step").disabled = !steps.length;
      document.getElementById("next-step").disabled = !steps.length;
      document.getElementById("previous-step").addEventListener("click", () => {
        const event = steps.findLast(event => event.timestamp - start < Number(timeline.value) - 20) ?? steps[0];
        if (event) seek(event.timestamp - start);
      });
      document.getElementById("next-step").addEventListener("click", () => {
        const event = steps.find(event => event.timestamp - start > Number(timeline.value) + 20);
        if (event) seek(event.timestamp - start);
      });
      setInterval(() => updatePosition(Math.min(duration, replayer.getCurrentTime())), 200);
      replayer.on("event-cast", (event) => {
        if (event.type === 3 && event.data?.source === 2 && event.data?.type === 2) focusClick(event);
      });
      const play = (offset) => { replayer.play(offset); status.textContent = labels.playing; };
      document.getElementById("play").addEventListener("click", () => play());
      document.getElementById("pause").addEventListener("click", () => {
        replayer.pause(); resetFocus(); status.textContent = labels.paused;
      });
      document.getElementById("restart").addEventListener("click", () => {
        resetFocus(); replayer.pause(0); play(0);
      });
      replayer.on("finish", () => {
        resetFocus();
        status.textContent = labels.complete;
        if (window.parent !== window) {
          window.parent.postMessage({ type: "autotour:module-finished", moduleId: ${JSON.stringify(moduleId).replaceAll("<", "\\u003c")} }, location.origin === "null" ? "*" : location.origin);
        }
      });
      const resizeObserver = new ResizeObserver(fitReplay);
      resizeObserver.observe(frame);
      resizeObserver.observe(canvas);
      reducedMotion.addEventListener("change", resetFocus);
      requestAnimationFrame(() => {
        fitReplay();
        const query = new URLSearchParams(location.search);
        const checkpoint = events.find(event => event.type === 5 && event.data?.tag === "autotour:step" && event.data.payload?.id === query.get("step") && event.data.payload?.phase === "settled");
        if (checkpoint && !renderMode) {
          seek(checkpoint.timestamp - start); document.body.dataset.autoplay = "disabled";
        } else if (renderMode || (${JSON.stringify(autoplay)} && !reducedMotion.matches && query.get("autoplay") !== "0")) {
          play(0); document.body.dataset.autoplay = "started";
        } else { seek(0); document.body.dataset.autoplay = "disabled"; }
      });
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
