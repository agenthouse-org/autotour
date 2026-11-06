const audienceLabels = [
  ["pm", "For product managers"],
  ["po", "For product owners"],
  ["developer", "For developers"]
];
const noVisibleChangeHeading = "No user-visible change detected";
const noPreviousCapture = "no previous capture";

export function renderReleaseNotesMarkdown(notes) {
  const lines = [`# Release notes: ${inline(notes.title ?? notes.walkthroughId)}`, ""];
  lines.push(`Range: \`${notes.range.base}\` (${short(notes.range.baseCommit)}) to \`${notes.range.head}\` (${short(notes.range.headCommit)})`, "");
  if (notes.status === "approved") {
    lines.push(`Approved by ${inline(notes.approval.by)} on ${notes.approval.at}.${acceptedReview(notes)}`, "");
  } else {
    lines.push("> **Draft.** These notes have not been approved.", "");
  }

  for (const [key, label] of audienceLabels) {
    lines.push(`## ${label}`, "");
    if (notes.audiences[key].length === 0) lines.push("_Not written yet._");
    for (const entry of notes.audiences[key]) lines.push(`- ${inline(entry.text)}`);
    lines.push("");
  }

  const changed = notes.modules.filter(module => module.status === "regenerate");
  lines.push("## Changed modules", "");
  if (changed.length === 0) lines.push("_No walkthrough module is affected._", "");
  for (const module of changed) {
    lines.push(`### ${inline(module.title)} (\`${module.id}\`)`, "");
    lines.push(`Commits: ${module.commits.map(sha => `\`${short(sha)}\``).join(", ") || "none in this range"}`, "");
    if (module.images.length > 0) {
      lines.push("| Before | After |", "| --- | --- |");
      for (const image of module.images) {
        lines.push(`| ${image.before ? `![Before: ${cell(image.asset)}](${image.before})` : noPreviousCapture} | ${image.after ? `![After: ${cell(image.asset)}](${image.after})` : "missing capture"} |`);
      }
      lines.push("");
    }
  }

  const review = notes.modules.filter(module => module.status === "review");
  if (review.length > 0 || notes.reviewRequired) {
    lines.push("## Needs review", "");
    for (const module of review) lines.push(`- ${inline(module.title)} (\`${module.id}\`)`);
    for (const file of notes.unmappedFiles ?? []) lines.push(`- Unmapped file: \`${file}\``);
    lines.push("");
  }

  lines.push("## Commits", "");
  for (const commit of notes.commits) lines.push(`- ${commitLine(commit)}`);
  if (notes.commits.length === 0) lines.push("_No commits in this range._");
  lines.push("");

  lines.push(`## ${noVisibleChangeHeading}`, "");
  const quiet = notes.commits.filter(commit => notes.noVisibleChange.includes(commit.sha));
  if (quiet.length === 0) lines.push("_Every commit affects a walkthrough module._");
  for (const commit of quiet) lines.push(`- \`${short(commit.sha)}\` ${inline(commit.subject)}`);
  lines.push("");
  return lines.join("\n");
}

export function renderReleaseNotesHtml(notes) {
  const title = `Release notes: ${notes.title ?? notes.walkthroughId}`;
  const parts = [];
  parts.push(`<h1>${escapeHtml(title)}</h1>`);
  parts.push(`<p class="range">Range <code>${escapeHtml(notes.range.base)}</code> (${short(notes.range.baseCommit)}) to <code>${escapeHtml(notes.range.head)}</code> (${short(notes.range.headCommit)})</p>`);
  parts.push(notes.status === "approved"
    ? `<p class="approved">Approved by ${escapeHtml(notes.approval.by)} on ${escapeHtml(notes.approval.at)}.${escapeHtml(acceptedReview(notes))}</p>`
    : `<p class="draft" role="note"><strong>Draft.</strong> These notes have not been approved.</p>`);

  for (const [key, label] of audienceLabels) {
    parts.push(`<section><h2>${label}</h2>`);
    parts.push(notes.audiences[key].length === 0
      ? `<p class="empty">Not written yet.</p>`
      : `<ul>${notes.audiences[key].map(entry => `<li>${escapeHtml(entry.text)}</li>`).join("")}</ul>`);
    parts.push(`</section>`);
  }

  const changed = notes.modules.filter(module => module.status === "regenerate");
  parts.push(`<section><h2>Changed modules</h2>`);
  if (changed.length === 0) parts.push(`<p class="empty">No walkthrough module is affected.</p>`);
  for (const module of changed) {
    parts.push(`<article id="module-${escapeHtml(module.id)}"><h3>${escapeHtml(module.title)} <code>${escapeHtml(module.id)}</code></h3>`);
    parts.push(`<p>Commits: ${module.commits.map(sha => `<code>${short(sha)}</code>`).join(", ") || "none in this range"}</p>`);
    for (const image of module.images) {
      parts.push(`<div class="pair">`);
      parts.push(`<figure>${image.before ? `<img src="${escapeHtml(image.before)}" alt="Before: ${escapeHtml(image.asset)}">` : `<div class="missing">${noPreviousCapture}</div>`}<figcaption>Before</figcaption></figure>`);
      parts.push(`<figure>${image.after ? `<img src="${escapeHtml(image.after)}" alt="After: ${escapeHtml(image.asset)}">` : `<div class="missing">missing capture</div>`}<figcaption>After</figcaption></figure>`);
      parts.push(`</div>`);
    }
    parts.push(`</article>`);
  }
  parts.push(`</section>`);

  const review = notes.modules.filter(module => module.status === "review");
  if (review.length > 0 || notes.reviewRequired) {
    parts.push(`<section><h2>Needs review</h2><ul>`);
    for (const module of review) parts.push(`<li>${escapeHtml(module.title)} <code>${escapeHtml(module.id)}</code></li>`);
    for (const file of notes.unmappedFiles ?? []) parts.push(`<li>Unmapped file: <code>${escapeHtml(file)}</code></li>`);
    parts.push(`</ul></section>`);
  }

  parts.push(`<section><h2>Commits</h2><ul>`);
  for (const commit of notes.commits) {
    const items = commit.workItems.map(item => `${escapeHtml(item.id)}${item.title ? `: ${escapeHtml(item.title)}` : ""}`).join("; ");
    const modules = commit.modules.map(id => `<code>${escapeHtml(id)}</code>`).join(", ");
    parts.push(`<li><code>${short(commit.sha)}</code> ${escapeHtml(commit.subject)}${items ? ` <span class="meta">(${items})</span>` : ""}${modules ? ` <span class="meta">modules ${modules}</span>` : ""}</li>`);
  }
  parts.push(`</ul></section>`);

  const quiet = notes.commits.filter(commit => notes.noVisibleChange.includes(commit.sha));
  parts.push(`<section><h2>${noVisibleChangeHeading}</h2>`);
  parts.push(quiet.length === 0
    ? `<p class="empty">Every commit affects a walkthrough module.</p>`
    : `<ul>${quiet.map(commit => `<li><code>${short(commit.sha)}</code> ${escapeHtml(commit.subject)}</li>`).join("")}</ul>`);
  parts.push(`</section>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { --bg: #ffffff; --fg: #1d2330; --muted: #5b6475; --line: #d8dde6; --draft-bg: #fff4d6; --draft-fg: #6b4b00; --ok-bg: #e3f5e8; --ok-fg: #1d5e30; }
@media (prefers-color-scheme: dark) { :root { --bg: #14171d; --fg: #e6e9ef; --muted: #a1a9b8; --line: #2d333d; --draft-bg: #3d3010; --draft-fg: #f5d77a; --ok-bg: #173523; --ok-fg: #9ee0b2; } }
body { margin: 0 auto; max-width: 960px; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
code { font-size: 0.9em; }
.range, .meta, .empty { color: var(--muted); }
.draft { background: var(--draft-bg); color: var(--draft-fg); padding: 10px 14px; border-radius: 6px; }
.approved { background: var(--ok-bg); color: var(--ok-fg); padding: 10px 14px; border-radius: 6px; }
section { border-top: 1px solid var(--line); margin-top: 24px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
@media (max-width: 640px) { .pair { grid-template-columns: 1fr; } }
figure { margin: 0; }
img { max-width: 100%; border: 1px solid var(--line); border-radius: 4px; }
.missing { display: grid; place-items: center; min-height: 120px; border: 1px dashed var(--line); border-radius: 4px; color: var(--muted); }
figcaption { color: var(--muted); font-size: 0.875em; }
</style>
</head>
<body>
${parts.join("\n")}
</body>
</html>
`;
}

function commitLine(commit) {
  const items = commit.workItems.map(item => `${item.id}${item.title ? `: ${inline(item.title)}` : ""}${item.outcome ? ` (${inline(item.outcome)})` : ""}`);
  const modules = commit.modules.map(id => `\`${id}\``);
  let line = `\`${short(commit.sha)}\` ${inline(commit.subject)}`;
  if (items.length > 0) line += ` — ${items.join("; ")}`;
  if (modules.length > 0) line += ` — modules: ${modules.join(", ")}`;
  return line;
}

function acceptedReview(notes) {
  const accepted = notes.approval?.acceptedReview ?? [];
  return accepted.length > 0 ? ` Modules accepted after review: ${accepted.join(", ")}.` : "";
}

function short(sha) {
  return sha.slice(0, 7);
}

function inline(value) {
  return String(value).replace(/\s+/g, " ").replace(/[<>]/g, character => (character === "<" ? "&lt;" : "&gt;"));
}

function cell(value) {
  return inline(value).replaceAll("|", "\\|").replace(/[[\]]/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
