/* No remote assets or telemetry. All actions go to this loopback session. */
let state;
let view = "brief";
let sceneId;
let checkpoint = 0;
let reviewer = "";
let pending = false;
const app = document.querySelector("#app");
const message = document.querySelector("#message");
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const status = value => ({ "needs-capture": "Needs capture", "needs-review": "Needs your review", approved: "Approved", excluded: "Excluded" })[value] ?? value;
const button = (text, action, extra = "") => `<button data-action="${action}" ${extra}>${text}</button>`;
const identity = () => `<label class="field" for="reviewer">Reviewer name</label><input type="text" id="reviewer" value="${esc(reviewer)}" maxlength="120" autocomplete="name">`;
const mediaUrl = name => state.mediaOrigin + "/media/" + state.scenes.find(s => s.id === sceneId).capture + "/" + name.split("/").map(encodeURIComponent).join("/");
async function refresh() {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("The review session could not be loaded.");
  state = await response.json();
  sceneId ??= state.scenes[0]?.id;
  render();
}
function render() {
  document.querySelector("#title").textContent = state.title;
  document.querySelector("#subtitle").textContent = `${state.brief.audience} · ${state.mode} · Saved revision ${state.version}`;
  document.querySelector("#working").textContent = `Working folder: ${state.storage.output} · ${state.storage.policy.artifacts}`;
  document.querySelectorAll("[data-view]").forEach(b => { if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  app.setAttribute("aria-busy", String(pending || state.busy));
  const scene = state.scenes.find(s => s.id === sceneId);
  checkpoint = Math.min(checkpoint, Math.max(0, (scene?.steps.length ?? 1) - 1));
  if (view === "brief") app.innerHTML = briefView();
  else if (view === "review") app.innerHTML = reviewScreen(scene);
  else if (view === "recapture") app.innerHTML = recaptureView(scene);
  else app.innerHTML = deliveryView();
  if (pending || state.busy) app.querySelectorAll("button").forEach(b => b.disabled = true);
  updateGates();
}
function briefView() {
  return `<div class="content two-col"><section><div class="panel"><h2>Agree on the first tour</h2><h3>Audience</h3><p>${esc(state.brief.audience)}</p><h3>What should viewers achieve?</h3><p>${esc(state.brief.outcome)}</p><h3>Privacy and sample data</h3><p>${esc(state.brief.privacy)}</p><h3>Test-data effects</h3><p>${esc(state.brief.testDataEffects)}</p></div><div class="panel"><h2>Proposed scenes</h2><ol>${state.scenes.map(s => `<li>${esc(s.title)} · ${s.steps.length} checkpoints</li>`).join("")}</ol><p class="muted">Each scene has setup/navigation and an expected-state check. Execution changes require a new plan.</p></div></section><section><div class="panel"><h2>Approved file destinations</h2><h3>Working captures</h3><p class="path">${esc(state.storage.output)}</p><p>${esc(state.storage.policy.artifacts)}</p><h3>Final documentation</h3><p class="path">${esc(state.storage.documentationOutput)}</p><p>${esc(state.storage.policy.documentation)}</p><p>Ignore-file choice: ${esc(state.storage.policy.gitignore)}</p><p class="muted">To change these choices, stop and update the project configuration with user consent. This screen does not silently change folders or ignore rules.</p></div><div class="panel">${identity()}<label class="check"><input id="plan-consent" type="checkbox">I approve the saved plan, environment, privacy rules and stated test-data effects.</label><div class="actions">${button(state.planApproved ? "Plan approved" : "Approve plan", "approve-plan", 'class="primary" disabled')}${button("Start capture", "capture", `class="primary" ${state.planApproved ? "" : "disabled"}`)}</div><p class="muted">Capture may run the stated application actions. Approval is a local attestation, not authenticated identity.</p></div></section></div>`;
}
function reviewScreen(scene) {
  if (!scene) return '<p class="empty">No scenes in this plan.</p>';
  const step = scene.steps[checkpoint];
  let media = '<p class="empty">No capture yet. Approve the plan and start capture.</p>';
  const screenshot = scene.assets.screenshots?.find(a => a.endsWith(`/${step.id}.png`));
  if (screenshot) media = `<img src="${esc(mediaUrl(screenshot))}" alt="${esc(step.instruction)}">`;
  else if (scene.assets.dom) media = `<iframe title="Recorded scene preview" sandbox="allow-scripts allow-same-origin" src="${esc(mediaUrl(scene.assets.dom))}?step=${encodeURIComponent(step.id)}&autoplay=0"></iframe>`;
  else if (scene.assets.video) media = `<video controls aria-label="Recorded scene" src="${esc(mediaUrl(scene.assets.video))}"></video>`;
  return `<div class="grid"><nav class="scenes" aria-label="Scenes"><h2>Scenes</h2><p class="muted">${state.report.scenes.filter(s => s.status === "approved").length} approved</p><div class="scene-list">${state.scenes.map((s,i) => `<button class="scene" data-scene="${esc(s.id)}" ${s.id === sceneId ? 'aria-current="step"' : ""}><strong>${i+1} · ${esc(s.title)}</strong><small>${status(s.status)} · revision ${s.revision}</small></button>`).join("")}</div></nav><section class="preview"><div class="preview-top"><div><span class="eyebrow">Checkpoint ${checkpoint+1} of ${scene.steps.length}</span><h2>${esc(scene.title)}</h2></div><span class="tag">${esc(status(scene.status))}</span></div><div class="media">${media}</div><div class="toolbar">${button("← Previous", "previous", checkpoint === 0 ? "disabled" : "")}${button("Next →", "next", checkpoint === scene.steps.length-1 ? "disabled" : "")}${screenshot ? button("View at 1:1", "natural", 'aria-pressed="false"') : ""}</div><div class="notice"><strong>Capture integrity: ${scene.mediaOK ? "verified" : "not verified"}</strong><p class="muted">Byte integrity is not visual approval. Inspect alignment, readability and sensitive content.</p></div><h3>Expected result</h3><p class="path">${esc(step.expected)}</p></section><aside class="inspector"><section><h2>Wording</h2><label class="field" for="instruction">Viewer instruction</label><textarea id="instruction">${esc(step.instruction)}</textarea><label class="field" for="narration">Explanation / narration</label><textarea id="narration">${esc(step.narration)}</textarea>${button("Save wording", "wording")}<p class="muted">Changes clear this scene’s approval and require recapture.</p></section><section><hr><h2>Your review</h2>${identity()}${[["readable","The capture is readable and shows the right action."],["accurate","The wording is accurate for this audience."],["private","I checked this scene for sensitive information."],["playback","I opened every checkpoint / checked media playback."]].map(([id,label]) => `<label class="check"><input type="checkbox" id="${id}">${label}</label>`).join("")}<div class="actions">${button("Approve scene", "approve-scene", 'class="primary" disabled')}${button("Recapture scene…", "show-recapture")}${button(scene.excluded ? "Restore to delivery" : "Exclude from delivery", "exclude")}</div><p class="muted">Applies to this revision only. Exclusion preserves source and required setup.</p></section></aside></div>`;
}
function recaptureView(scene) {
  return `<div class="content two-col"><section class="panel"><h2>Refresh only what changed</h2><p>${esc(scene.title)} · revision ${scene.revision}</p>${state.failure ? `<div class="notice error"><strong>${esc(state.failure.message)}</strong><p>${esc(state.failure.advice)}</p></div>` : ""}<h3>Recapture scope</h3><ul class="rows">${state.scenes.map(s => `<li>${esc(s.title)}<span>${s.id === sceneId ? "Recapture" : "Keep media"}</span></li>`).join("")}</ul><p class="muted">Earlier actions may execute again to establish the starting state. Later scenes must be reviewed again for consistency.</p></section><section class="panel"><h2>Review the effects before retrying</h2><p>${esc(state.brief.testDataEffects)}</p><div class="notice">Old captures are retained. A successful retry becomes a new revision requiring approval. A failed retry does not replace the current capture.</div><label class="check"><input id="retry-consent" type="checkbox">I approve this retry, including prerequisite actions and the stated test-data effects.</label><div class="actions">${button("Recapture this scene", "recapture", 'class="primary" disabled')}${button("Back to review", "show-review")}</div></section></div>`;
}
function deliveryView() {
  return `<div class="content"><div class="two-col"><section class="panel"><h2>Automated evidence</h2><ul class="rows">${state.report.checks.map(c => `<li><div>${esc(c.name)}<p class="muted">${esc(c.detail ?? "")}</p></div><span>${esc(c.status)}</span></li>`).join("")}</ul></section><section class="panel"><h2>Human sign-off</h2><ul class="rows">${state.report.scenes.map(s => `<li>${esc(s.title)}<span>${esc(status(s.status))}</span></li>`).join("")}</ul><div class="notice">${state.report.ready ? "All included scenes have current approval." : "Delivery is blocked until every included scene has current approval and intact media."}</div>${button("Review scenes", "show-review")}</section></div><div class="two-col"><section class="panel"><h2>Delivery destination</h2><p class="path">${esc(state.storage.documentationOutput)}</p><p>${esc(state.storage.policy.documentation)} · ${esc(state.mode)}</p><label class="check"><input id="deliver-consent" type="checkbox">Prepare a new local delivery in this approved folder.</label>${button("Prepare local delivery", "deliver", 'class="primary" disabled')}<p class="muted">Existing deliveries are never overwritten. This does not publish externally.</p>${state.delivery ? `<p>Prepared locally:</p><p class="path">${esc(state.delivery.path)}</p>` : ""}</section><section class="panel"><h2>Trial results</h2><ul class="rows"><li>Time to first approved tour<span>${state.report.metrics.timeToFirstApprovalMs === null ? "Not yet approved" : Math.round(state.report.metrics.timeToFirstApprovalMs/1000)+" s"}</span></li><li>Manual wording corrections<span>${state.report.metrics.corrections}</span></li><li>Capture attempts<span>${state.report.metrics.captureAttempts}</span></li><li>Observed viewer trials<span>${state.report.metrics.trials.length}</span></li></ul><details><summary>Record a real viewer trial</summary><label class="field" for="participant">Participant alias (no personal information)</label><input type="text" id="participant"><label class="field" for="applicationType">Application type</label><select id="applicationType"><option>dashboard</option><option>form</option><option>content</option><option>other</option></select>${[["completed","Viewer completed the task"],["unexpectedWrites","Unexpected writes occurred"],["disclosure","Sensitive information was disclosed"]].map(([id,label])=>`<label class="field" for="${id}">${label}</label><select id="${id}"><option value="">Not assessed</option><option value="true">Yes</option><option value="false">No</option></select>`).join("")}${button("Save trial observation", "trial")}</details><p class="muted">Fixture tests are not viewer trials. Unknown outcomes stay unmeasured.</p></section></div></div>`;
}
function checked(id) { return document.getElementById(id)?.checked === true; }
function value(id) { return document.getElementById(id)?.value ?? ""; }
function updateGates() {
  const scene = state.scenes.find(s => s.id === sceneId);
  const gates = { "approve-plan": checked("plan-consent") && value("reviewer").trim(), capture: state.planApproved && checked("plan-consent"), "approve-scene": ["needs-review","approved"].includes(scene.status) && ["readable","accurate","private","playback"].every(checked) && value("reviewer").trim(), recapture: state.planApproved && scene.capture && checked("retry-consent"), deliver: state.report.ready && checked("deliver-consent") };
  for (const [action, allowed] of Object.entries(gates)) { const b = app.querySelector(`[data-action="${action}"]`); if (b) b.disabled = pending || state.busy || !allowed; }
}
app.addEventListener("input", event => { if (event.target.id === "reviewer") reviewer = event.target.value; updateGates(); });
function unsavedWording() {
  const step = state?.scenes.find(s => s.id === sceneId)?.steps[checkpoint];
  return !!document.getElementById("instruction") && step && (value("instruction") !== step.instruction || value("narration") !== step.narration);
}
const canLeave = () => !unsavedWording() || window.confirm("Discard unsaved wording changes?");
window.addEventListener("beforeunload", event => { if (unsavedWording() || pending) { event.preventDefault(); event.returnValue = ""; } });
document.querySelector(".tabs").addEventListener("click", event => { const b = event.target.closest("[data-view]"); if (b && !pending && canLeave()) { view = b.dataset.view; render(); } });
app.addEventListener("click", async event => {
  const b = event.target.closest("button"); if (!b || pending) return;
  if (b.dataset.action !== "wording" && b.dataset.action !== "natural" && !canLeave()) return;
  if (b.dataset.scene) { sceneId = b.dataset.scene; checkpoint = 0; render(); return; }
  const action = b.dataset.action;
  if (!action) return;
  if (action === "previous" || action === "next") { checkpoint += action === "next" ? 1 : -1; render(); return; }
  if (action === "natural") { const on = document.querySelector(".media").classList.toggle("natural"); b.setAttribute("aria-pressed", String(on)); return; }
  if (action.startsWith("show-")) { view = action.slice(5); render(); return; }
  const scene = state.scenes.find(s => s.id === sceneId);
  const payload = { type: action, version: state.version, sceneId, reviewer, consent: ["capture","approve-plan"].includes(action) ? checked("plan-consent") : action === "recapture" ? checked("retry-consent") : checked("deliver-consent") };
  if (action === "wording") Object.assign(payload, { stepId: scene.steps[checkpoint].id, instruction: value("instruction"), narration: value("narration") });
  if (action === "exclude") payload.excluded = !scene.excluded;
  if (action === "approve-scene") payload.checks = Object.fromEntries(["readable","accurate","private","playback"].map(k => [k,checked(k)]));
  if (action === "trial") {
    Object.assign(payload, { participant: value("participant"), applicationType: value("applicationType") });
    for (const key of ["completed","unexpectedWrites","disclosure"]) payload[key] = value(key) === "" ? null : value(key) === "true";
  }
  pending = true; render(); message.textContent = ["capture","recapture"].includes(action) ? "Capturing… the previous revision remains available. Please wait." : "Saving…";
  try {
    const response = await fetch("/api/action", { method:"POST", headers:{"Content-Type":"application/json","X-Autotour-Token":document.body.dataset.token}, body:JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    state = result;
    if (["capture","recapture"].includes(action)) view = "review";
    message.textContent = action === "deliver" ? "Delivery prepared locally. Nothing was published." : "Saved. Review state updated.";
  } catch (error) { message.textContent = error.message; await refresh().catch(()=>{}); }
  finally { pending = false; render(); }
});
refresh().catch(error => { app.setAttribute("aria-busy","false"); message.textContent = error.message; });
