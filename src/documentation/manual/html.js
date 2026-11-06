import { clientScript } from "./client.js";
import { format } from "./labels.js";

export const navigationFlavours = ["sidebar", "topbar", "minimal"];

/**
 * Render a complete HTML manual page from a document model.
 *
 * @param {object} model
 * @param {string} model.title
 * @param {string} model.language
 * @param {Record<string, string>} model.labels
 * @param {"sidebar"|"topbar"|"minimal"} model.navigation
 * @param {object[]} model.entries part and section entries ({ kind, anchor, level, number, heading, html })
 * @param {{ language: string, label: string, href: string, current: boolean }[]} [model.languages]
 * @param {{ colors?: Record<string,string>, fontFamily?: string, logoUrl?: string, logoAlt?: string }} [model.branding]
 * @param {boolean} [model.draft]
 * @param {string} [model.aiNoteHtml] note near the start (document placement)
 * @param {string} [model.aiClosingHtml] closing section (document placement)
 * @param {string} [model.footerHtml]
 * @param {{ print?: boolean, tocPages?: Record<string, number> }} [options]
 */
export function renderManualPage(model, { print = false, tocPages = {} } = {}) {
  const labels = model.labels;
  const title = escapeHtml(model.title);
  const sections = model.entries.map(entry => entry.kind === "part"
    ? `<div class="autotour-part" id="${escapeHtml(entry.anchor)}"><p class="autotour-part-label">${escapeHtml(entry.label)}</p></div>`
    : entry.html).join("\n");
  const main = `${model.aiNoteHtml ?? ""}${sections}${model.aiClosingHtml ?? ""}`;
  const brand = brandingStyle(model.branding);
  const logo = model.branding?.logoUrl ? `<img class="autotour-logo" src="${escapeHtml(model.branding.logoUrl)}" alt="${escapeHtml(model.branding.logoAlt ?? "")}">` : "";
  if (print) {
    const cover = `<section class="autotour-cover">${logo}<h1>${title}</h1><nav aria-label="${escapeHtml(labels.contents)}"><ol>${model.entries.filter(entry => entry.kind === "section").map(entry => `<li><a href="#${escapeHtml(entry.anchor)}">${escapeHtml(contentsText(entry))}</a>${tocPages[entry.anchor] ? ` <span class="autotour-toc-page">${tocPages[entry.anchor]}</span>` : ""}</li>`).join("")}</ol></nav></section>`;
    return `<!doctype html>\n<html lang="${escapeHtml(model.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>${brand}${printPageStyle}${contentStyle}</style></head><body>${cover}<main id="autotour-main">${main}</main>${model.footerHtml ?? ""}</body></html>\n`;
  }
  const navigation = model.navigation ?? "sidebar";
  const contents = `<nav class="autotour-contents" aria-label="${escapeHtml(labels.contents)}">${contentsTree(model.entries, model.aiClosingHtml ? labels.aiSection : undefined)}</nav>`;
  const search = `<form id="autotour-search" class="autotour-search" role="search" action="#"><label for="autotour-search-input">${escapeHtml(labels.search)}</label><input id="autotour-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(labels.searchPlaceholder)}"></form><p id="autotour-search-status" class="autotour-search-status" role="status" aria-live="polite"></p><ol id="autotour-search-results" class="autotour-search-results" hidden></ol>`;
  const languages = model.languages?.length ? `<nav class="autotour-languages" aria-label="${escapeHtml(labels.languages)}"><ul>${model.languages.map(link => `<li><a href="${escapeHtml(link.href)}" lang="${escapeHtml(link.language)}" hreflang="${escapeHtml(link.language)}"${link.current ? ' aria-current="page"' : " data-autotour-language"}>${escapeHtml(link.label)}</a></li>`).join("")}</ul></nav>` : "";
  const menuButton = navigation === "minimal" ? "" : `<button type="button" id="autotour-menu-button" class="autotour-menu-button" aria-expanded="false" aria-controls="autotour-nav-panel">${escapeHtml(labels.menu)}</button>`;
  const draft = model.draft ? `<div class="autotour-draft" role="note">${escapeHtml(labels.draft)}</div>` : "";
  const header = `<header class="autotour-header" id="top">${logo}<p class="autotour-title">${title}</p>${languages}${menuButton}</header>`;
  const panel = `<div id="autotour-nav-panel" class="autotour-nav-panel">${search}${contents}</div>`;
  let body;
  if (navigation === "topbar") {
    body = `${draft}<div class="autotour-bar">${header}${panel}</div><main id="autotour-main"><h1>${title}</h1>${main}</main>`;
  } else if (navigation === "minimal") {
    body = `${draft}${header}<div class="autotour-minimal">${panel}<main id="autotour-main"><h1>${title}</h1>${main}</main></div>`;
  } else {
    body = `${draft}${header}<div class="autotour-layout"><aside class="autotour-sidebar">${panel}</aside><main id="autotour-main"><h1>${title}</h1>${main}</main></div>`;
  }
  const dialog = `<dialog id="autotour-dialog" class="autotour-dialog" aria-label="${escapeHtml(labels.zoom)}"><button type="button" class="autotour-dialog-close" aria-label="${escapeHtml(labels.close)}">✕ ${escapeHtml(labels.close)}</button><figure><img alt=""><figcaption></figcaption></figure></dialog>`;
  const top = `<a id="autotour-top" class="autotour-top" href="#top">${escapeHtml(labels.backToTop)}</a>`;
  const config = `<script type="application/json" id="autotour-config">${safeJson({ labels: pick(labels, ["searchNone", "searchCountOne", "searchCount", "zoom"]) })}</script>`;
  return `<!doctype html>\n<html lang="${escapeHtml(model.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${brand}${screenStyle}${contentStyle}${flavourStyle[navigation]}${screenPrintStyle}</style></head><body class="autotour-nav-${navigation}">${body}${model.footerHtml ?? ""}${top}${dialog}${config}<script>${clientScript}</script></body></html>\n`;
}

export function contentsText(entry) {
  return entry.number ? `${entry.number} ${entry.heading}` : entry.heading;
}

function contentsTree(entries, closingLabel) {
  const root = [];
  const stack = [{ level: 0, children: root }];
  for (const entry of entries) {
    // A part groups the sections after it; sections nest by heading level.
    const level = entry.kind === "part" ? 0.5 : entry.level ?? 2;
    const node = { entry, level, children: [] };
    while (stack.length > 1 && stack.at(-1).level >= level) stack.pop();
    stack.at(-1).children.push(node);
    stack.push(node);
  }
  if (closingLabel) root.push({ entry: { kind: "section", anchor: "autotour-ai-content", heading: closingLabel }, children: [] });
  return renderNodes(root);
}

function renderNodes(nodes) {
  if (!nodes.length) return "";
  return `<ol>${nodes.map(node => node.entry.kind === "part"
    ? `<li class="autotour-contents-part"><a href="#${escapeHtml(node.entry.anchor)}">${escapeHtml(node.entry.label)}</a>${renderNodes(node.children)}</li>`
    : `<li><a href="#${escapeHtml(node.entry.anchor)}">${escapeHtml(contentsText(node.entry))}</a>${renderNodes(node.children)}</li>`).join("")}</ol>`;
}

function brandingStyle(branding = {}) {
  const colors = branding.colors ?? {};
  const vars = {
    "--autotour-accent": colors.accent ?? "#1f5fbf",
    "--autotour-text": colors.text ?? "#1d1d1f",
    "--autotour-background": colors.background ?? "#ffffff",
    "--autotour-muted": colors.muted ?? "#5f6368",
    "--autotour-surface": colors.surface ?? "#f4f5f7",
    "--autotour-border": colors.border ?? "#d6d8dc",
    "--autotour-font": branding.fontFamily ?? "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"
  };
  return `:root{${Object.entries(vars).map(([key, value]) => `${key}:${cssValue(value)}`).join(";")}}`;
}

function cssValue(value) {
  return String(value).replace(/[;{}<>]/g, "");
}

const contentStyle = [
  "img{max-width:100%;height:auto}",
  "table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--autotour-border);padding:.4rem .6rem;text-align:left;vertical-align:top}",
  "aside.autotour-note,blockquote{border-left:.25rem solid var(--autotour-accent);margin:1rem 0;padding:.25rem 1rem;background:var(--autotour-surface)}",
  "figure{break-inside:avoid;margin:1.5rem 0}figcaption{color:var(--autotour-muted);font-size:.92em;margin-top:.4rem}",
  "pre{overflow:auto}",
  "figure.autotour-placeholder{border:1px dashed #666;padding:1rem;margin:1rem 0;background:#f6f6f6}",
  ".autotour-number{color:var(--autotour-muted);font-weight:600;margin-right:.35em}",
  ".autotour-ai{color:var(--autotour-muted);font-size:.78rem;font-weight:400;letter-spacing:.01em}",
  "h1 .autotour-ai,h2 .autotour-ai,h3 .autotour-ai,h4 .autotour-ai{margin-left:.6em;vertical-align:middle;border:1px solid var(--autotour-border);border-radius:1em;padding:.05em .55em}",
  "p.autotour-ai{margin:.25rem 0 1rem}",
  ".autotour-ai-note{color:var(--autotour-muted);font-size:.85rem;border-bottom:1px solid var(--autotour-border);padding-bottom:.6rem}",
  ".autotour-part{margin:3rem 0 1rem;padding:.8rem 0;border-top:3px solid var(--autotour-accent)}",
  ".autotour-part-label{margin:0;font-size:1.35rem;font-weight:700;color:var(--autotour-accent)}",
  ".autotour-embed-stage{position:relative}",
  ".autotour-embed-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0;pointer-events:none}",
  ".autotour-embed-ready iframe{opacity:1;pointer-events:auto}",
  ".autotour-embed-ready .autotour-embed-still{visibility:hidden}",
  "a.autotour-ref{text-decoration-style:dotted}"
].join("");

const screenStyle = [
  "*,*::before,*::after{box-sizing:border-box}",
  "html{scroll-padding-top:4.5rem}",
  "body{margin:0;font:1rem/1.6 var(--autotour-font);color:var(--autotour-text);background:var(--autotour-background)}",
  "a{color:var(--autotour-accent)}",
  ":focus-visible{outline:3px solid var(--autotour-accent);outline-offset:2px}",
  "main{min-width:0;padding:1.5rem 1.5rem 4rem}main>h1{margin-top:0}",
  "section{scroll-margin-top:4.5rem}",
  ".autotour-header{display:flex;align-items:center;gap:1rem;padding:.6rem 1.5rem;border-bottom:1px solid var(--autotour-border);background:var(--autotour-background)}",
  ".autotour-title{margin:0;font-weight:700;flex:1}",
  ".autotour-logo{max-height:2rem;width:auto}",
  ".autotour-languages ul{display:flex;gap:.75rem;list-style:none;margin:0;padding:0}.autotour-languages a[aria-current=page]{font-weight:700;text-decoration:none;color:inherit}",
  ".autotour-menu-button{font:inherit;border:1px solid var(--autotour-border);background:var(--autotour-surface);color:inherit;border-radius:.4rem;padding:.3rem .8rem;cursor:pointer}",
  ".autotour-search label{display:block;font-weight:600;font-size:.85rem;margin-bottom:.25rem}",
  ".autotour-search input{font:inherit;width:100%;padding:.4rem .6rem;border:1px solid var(--autotour-border);border-radius:.4rem}",
  ".autotour-search-status{font-size:.85rem;color:var(--autotour-muted);margin:.4rem 0;min-height:1em}",
  ".autotour-search-results{list-style:none;margin:0;padding:0}",
  ".autotour-search-results a{display:block;padding:.45rem .3rem;color:inherit;text-decoration:none;border-bottom:1px solid var(--autotour-border)}",
  ".autotour-search-results a:hover,.autotour-search-results a:focus-visible{background:var(--autotour-surface)}",
  ".autotour-search-title{display:block;font-weight:600;color:var(--autotour-accent)}",
  ".autotour-search-snippet{display:block;font-size:.85rem;color:var(--autotour-muted)}",
  "mark{background:#fde68a;color:inherit}",
  ".autotour-contents ol{list-style:none;margin:0;padding:0}.autotour-contents ol ol{padding-left:1rem}",
  ".autotour-contents a{display:block;padding:.2rem .4rem;border-radius:.3rem;color:inherit;text-decoration:none;font-size:.92rem}",
  ".autotour-contents a:hover{background:var(--autotour-surface)}",
  ".autotour-contents a[aria-current=location]{background:var(--autotour-surface);color:var(--autotour-accent);font-weight:600;box-shadow:inset 3px 0 0 var(--autotour-accent)}",
  ".autotour-contents-part>a{font-weight:700;text-transform:none;margin-top:.6rem}",
  "body:has(.autotour-draft){--autotour-banner:1.6rem}html:has(.autotour-draft){scroll-padding-top:6rem}",
  ".autotour-draft{position:sticky;top:0;z-index:30;height:var(--autotour-banner);line-height:1.2rem;background:#b45309;color:#fff;text-align:center;font-weight:700;letter-spacing:.08em;padding:.2rem;font-size:.8rem;text-transform:uppercase}",
  ".autotour-top{position:fixed;right:1.25rem;bottom:1.25rem;z-index:20;background:var(--autotour-accent);color:#fff;text-decoration:none;padding:.5rem .9rem;border-radius:2rem;box-shadow:0 2px 8px rgba(0,0,0,.2);opacity:0;transform:translateY(.5rem);pointer-events:none;transition:opacity .2s,transform .2s}",
  ".autotour-top.autotour-visible,.autotour-top:focus-visible{opacity:1;transform:none;pointer-events:auto}",
  "figure.autotour-shot img,figure.autotour-still img{cursor:zoom-in}",
  ".autotour-dialog{max-width:96vw;max-height:96vh;padding:.75rem;border:0;border-radius:.5rem}.autotour-dialog::backdrop{background:rgba(0,0,0,.75)}",
  ".autotour-dialog figure{margin:0}.autotour-dialog img{display:block;max-width:calc(96vw - 1.5rem);max-height:calc(96vh - 6rem);margin:auto;cursor:zoom-out}",
  ".autotour-dialog-close{float:right;font:inherit;border:0;background:none;cursor:pointer;padding:.2rem .4rem;margin-bottom:.4rem}",
  ".autotour-footer{color:var(--autotour-muted);font-size:.85rem;border-top:1px solid var(--autotour-border);padding:1rem 1.5rem}"
].join("");

const flavourStyle = {
  sidebar: [
    ".autotour-layout{display:grid;grid-template-columns:18rem minmax(0,1fr);max-width:84rem;margin:0 auto}",
    ".autotour-sidebar{border-right:1px solid var(--autotour-border)}",
    ".autotour-sidebar .autotour-nav-panel{position:sticky;top:var(--autotour-banner,0px);max-height:calc(100vh - var(--autotour-banner,0px));overflow:auto;padding:1rem}",
    "main{max-width:52rem}",
    ".autotour-menu-button{display:none}",
    "@media (max-width:900px){.autotour-layout{display:block}.autotour-sidebar{border:0}.autotour-menu-button{display:inline-block}.autotour-header{position:sticky;top:var(--autotour-banner,0px);z-index:15}",
    ".autotour-sidebar .autotour-nav-panel{display:none;position:fixed;top:calc(3.25rem + var(--autotour-banner,0px));left:0;right:0;bottom:0;z-index:14;max-height:none;background:var(--autotour-background);border-top:1px solid var(--autotour-border)}",
    ".autotour-sidebar .autotour-nav-panel.autotour-open{display:block}}"
  ].join(""),
  topbar: [
    ".autotour-bar{position:sticky;top:var(--autotour-banner,0px);z-index:15;background:var(--autotour-background);border-bottom:1px solid var(--autotour-border)}",
    ".autotour-bar .autotour-header{border:0}",
    ".autotour-bar .autotour-nav-panel{display:none;position:absolute;left:0;right:0;top:100%;max-height:75vh;overflow:auto;padding:1rem 1.5rem;background:var(--autotour-background);border-bottom:1px solid var(--autotour-border);box-shadow:0 6px 16px rgba(0,0,0,.08)}",
    ".autotour-bar .autotour-nav-panel.autotour-open{display:block}",
    ".autotour-nav-panel>*{max-width:52rem;margin-left:auto;margin-right:auto}",
    "main{max-width:56rem;margin:0 auto}"
  ].join(""),
  minimal: [
    ".autotour-minimal{max-width:52rem;margin:0 auto}",
    ".autotour-minimal .autotour-nav-panel{padding:1rem 1.5rem 0;border-bottom:1px solid var(--autotour-border)}"
  ].join("")
};

const screenPrintStyle = "@media print{.autotour-nav-panel,.autotour-sidebar,.autotour-menu-button,.autotour-languages,.autotour-top,.autotour-dialog,.autotour-draft,.autotour-search{display:none!important}.autotour-layout{display:block}main{max-width:none;padding:0}.autotour-header{border:0}.autotour-embed-stage iframe{display:none}.autotour-embed-still{visibility:visible!important}figure,img{break-inside:avoid}h1,h2,h3{break-after:avoid}a{color:inherit}}";

const printPageStyle = "@page{size:A4}body{font:12pt/1.5 var(--autotour-font);color:#000}img{max-width:100%}figure{break-inside:avoid}figcaption{break-before:avoid;font-style:italic;margin-top:.4rem}h1,h2,h3{break-after:avoid}.autotour-cover{break-after:page;min-height:70vh}.autotour-embed-stage iframe{display:none}.autotour-part{break-before:page}";

function pick(object, keys) {
  return Object.fromEntries(keys.map(key => [key, object[key]]));
}

export function pageFooterTemplate(labels) {
  return format(labels.pageFooter, { page: '<span class="pageNumber"></span>', total: '<span class="totalPages"></span>' });
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
