export function buildReplayHtml({ moduleId, title, events }) {
  const eventJson = JSON.stringify(events).replaceAll("<", "\\u003c");
  const safeTitle = escapeHtml(title);
  const safeModuleId = escapeHtml(moduleId);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; frame-src 'self' data: blob:; child-src 'self' data: blob:">
  <title>${safeTitle} - AutoTour replay</title>
  <link rel="stylesheet" href="../../../runtime/rrweb-replay.css">
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #0b0d0c; color: #f4f7f5; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr; background: #0b0d0c; }
    header { min-height: 58px; display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid #343936; background: #151816; }
    .identity { min-width: 0; flex: 1; }
    h1 { margin: 0; font-size: 16px; line-height: 1.25; font-weight: 650; }
    .module { margin: 3px 0 0; color: #aab3ad; font: 12px/1.2 ui-monospace, monospace; }
    .controls { display: flex; gap: 6px; }
    button { width: 36px; height: 36px; border: 1px solid #48504b; border-radius: 6px; background: #202522; color: #f4f7f5; font-size: 16px; cursor: pointer; }
    button:hover { border-color: #9da9a1; background: #2b322e; }
    button:focus-visible { outline: 2px solid #8dff32; outline-offset: 2px; }
    #status { width: 58px; color: #b7c1bb; font-size: 12px; text-align: right; }
    main { min-height: 0; overflow: auto; display: grid; place-items: start center; padding: 12px; background: #050706; }
    #replay { width: 100%; min-height: 540px; overflow: hidden; }
    .replayer-wrapper { transform-origin: top left; }
    @media (max-width: 680px) {
      header { flex-wrap: wrap; }
      .identity { flex-basis: calc(100% - 72px); }
      #status { order: 3; width: 100%; text-align: left; }
    }
  </style>
</head>
<body data-module-id="${safeModuleId}">
  <header>
    <div class="identity">
      <h1>${safeTitle}</h1>
      <p class="module">${safeModuleId}</p>
    </div>
    <div class="controls" aria-label="Replay controls">
      <button id="play" type="button" aria-label="Play replay" title="Play">▶</button>
      <button id="pause" type="button" aria-label="Pause replay" title="Pause">Ⅱ</button>
      <button id="restart" type="button" aria-label="Restart replay" title="Restart">↺</button>
    </div>
    <span id="status" aria-live="polite">Ready</span>
  </header>
  <main><div id="replay" aria-label="Recorded walkthrough"></div></main>
  <script src="../../../runtime/rrweb-replay.js"></script>
  <script id="autotour-events" type="application/json">${eventJson}</script>
  <script>
    (() => {
      const events = JSON.parse(document.getElementById("autotour-events").textContent);
      const status = document.getElementById("status");
      const meta = events.find((event) => event.type === 4)?.data ?? {};
      const replayer = new rrwebReplay.Replayer(events, {
        root: document.getElementById("replay"),
        width: Number.isFinite(meta.width) ? meta.width : 1280,
        height: Number.isFinite(meta.height) ? meta.height : 720,
        showWarning: false,
        mouseTail: false
      });
      const play = (offset) => {
        replayer.play(offset);
        status.textContent = "Playing";
      };
      document.getElementById("play").addEventListener("click", () => play());
      document.getElementById("pause").addEventListener("click", () => {
        replayer.pause();
        status.textContent = "Paused";
      });
      document.getElementById("restart").addEventListener("click", () => {
        replayer.pause(0);
        play(0);
      });
      requestAnimationFrame(() => {
        play(0);
        document.body.dataset.autoplay = "started";
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

