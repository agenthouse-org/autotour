import { copyFile, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { renderMarkdown } from "./markdown.js";
import { readerChrome } from "./reader.js";
import { languageSwitchMarkup } from "./languages.js";
import { validateDocumentationSpec } from "./spec.js";

export async function generateDocumentation({ spec, specPath, walkthrough, walkthroughFile, targets, outputRoot, mode = "create" }) {
  const validation = await validateDocumentationSpec(spec, { journey: walkthrough });
  if (!validation.valid) throw new Error(`Cannot generate documentation: ${JSON.stringify(validation.errors)}`);
  const selected = (targets?.length ? targetList(spec).filter(target => targets.includes(target.kind)) : targetList(spec));
  if (!selected.length) throw new Error("No documentation targets were selected.");
  const manifestFile = walkthroughFile ? path.resolve(walkthroughFile) : (specPath ? path.resolve(specPath) : process.cwd());
  const manifestDir = path.dirname(manifestFile);
  const root = path.resolve(outputRoot ?? ".autotour/output/documentation");
  // Preflight every destination before copying assets or writing any target.
  for (const target of selected) {
    if (target.path) resolveTarget(root, target.path);
  }
  const results = [];
  for (const target of selected) {
    if (target.kind === "markdown") results.push(await generateMarkdown({ spec, walkthrough, target, manifestDir, root, mode }));
    else if (target.kind === "html") results.push(await generateHtml({ spec, specPath, walkthrough, target, manifestDir, root, mode }));
    else if (target.kind === "pdf") results.push(await generatePdf({ spec, walkthrough, target, manifestDir, root, mode }));
    else results.push(await generateConfluencePlan({ spec, target, root }));
  }
  return { mode, targets: results };
}

function targetList(spec) {
  return spec.targets ?? (spec.destination ? [spec.destination] : []);
}

async function generateMarkdown({ spec, walkthrough, target, manifestDir, root, mode }) {
  const destination = resolveTarget(root, target.path);
  const assetsDir = path.join(path.dirname(destination), "assets", "autotour", walkthrough.id);
  const generated = [];
  for (const section of spec.sections) {
    generated.push({
      moduleId: section.moduleId,
      content: [`${"#".repeat(section.headingLevel ?? 2)} ${escapeMarkdown(section.heading)}`, `<!-- autotour:module=${section.moduleId}:start -->`, ...await renderBlocks({ section, walkthrough, manifestDir, assetsDir, documentDir: path.dirname(destination), format: "markdown" }), `<!-- autotour:module=${section.moduleId}:end -->`].join("\n")
    });
  }
  const existing = mode === "adapt" && await exists(destination) ? await readFile(destination, "utf8") : undefined;
  const body = existing ? adaptMarkdown(existing, generated) : [`# ${escapeMarkdown(spec.title ?? walkthrough.title ?? walkthrough.id)}`, "", ...generated.map(item => item.content)].join("\n\n");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${body.trim()}\n`, "utf8");
  return { kind: "markdown", path: destination, mode, assetsDir };
}

async function generateHtml({ spec, specPath, walkthrough, target, manifestDir, root, mode }) {
  const destination = resolveTarget(root, target.path);
  const htmlMode = target.mode ?? spec.generation?.htmlMode ?? "site";
  const sections = [];
  for (const section of spec.sections) {
    const blocks = await renderBlocks({
      section,
      walkthrough,
      manifestDir,
      assetsDir: path.join(path.dirname(destination), "assets"),
      documentDir: path.dirname(destination),
      format: "html",
      embedImages: htmlMode === "single-file"
    });
    const level = section.headingLevel ?? 2;
    sections.push(`<section id="${section.moduleId}"><h${level}>${escapeHtml(section.heading)}</h${level}>${blocks.join("\n")}</section>`);
  }
  const title = escapeHtml(spec.title ?? walkthrough.title ?? walkthrough.id);
  const language = escapeHtml(documentLanguage(spec, walkthrough));
  const reader = readerChrome(spec.sections);
  const switcher = await languageSwitchMarkup({ spec, specPath, outputRoot: root, currentHtmlPath: destination });
  const html = `<!doctype html>\n<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>${manualStyle}${reader.style}</style>${switcher.style}</head><body><header><h1>${title}</h1>${switcher.markup}${reader.header}</header><main>${sections.join("\n")}</main>${reader.script}${switcher.script}</body></html>\n`;
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, html, "utf8");
  return { kind: "html", path: destination, mode: htmlMode };
}

async function generateConfluencePlan({ spec, target, root }) {
  const destination = resolveTarget(root, `confluence-${target.pageId}.json`);
  const plan = { kind: "confluence", siteUrl: target.siteUrl, pageId: target.pageId, sections: spec.sections.map(section => ({ moduleId: section.moduleId, heading: section.heading, blocks: section.blocks })) };
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return { kind: "confluence", path: destination, pageId: target.pageId, status: "plan-created" };
}

async function generatePdf({ spec, walkthrough, target, manifestDir, root, mode }) {
  const destination = resolveTarget(root, target.path);
  const temporary = `${destination}.autotour.html`;
  const sections = [];
  for (const section of spec.sections) {
    const blocks = await renderBlocks({ section, walkthrough, manifestDir, assetsDir: path.join(path.dirname(destination), "assets"), documentDir: path.dirname(destination), format: "html" });
    const level = section.headingLevel ?? 2;
    sections.push(`<section><h${level}>${escapeHtml(section.heading)}</h${level}>${blocks.join("\n")}</section>`);
  }
  const title = escapeHtml(spec.title ?? walkthrough.title ?? walkthrough.id);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(temporary, `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>@page{size:A4;margin:18mm}body{font:12pt/1.5 system-ui}img{max-width:100%}figure{break-inside:avoid}figcaption{font-style:italic;margin-top:.4rem}</style></head><body><h1>${title}</h1>${sections.join("\n")}</body></html>`);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${temporary.replaceAll("\\", "/")}`, { waitUntil: "load" });
    await page.pdf({ path: destination, format: "A4", printBackground: true });
  } finally {
    await browser.close();
    await rm(temporary, { force: true });
  }
  return { kind: "pdf", path: destination, mode };
}

async function renderBlocks({ section, walkthrough, manifestDir, assetsDir, documentDir, format, embedImages = false }) {
  const module = walkthrough.modules.find(candidate => candidate.id === section.moduleId);
  const output = [];
  for (const block of section.blocks) {
    if (block.kind === "text") output.push(format === "html" ? renderMarkdown(block.text) : block.text);
    if (block.kind === "tour") output.push(format === "html" ? `<p><a href="${escapeHtml(block.url)}">${escapeHtml(block.label)}</a></p>` : `[${block.label}](${block.url})`);
    if (block.kind === "video") output.push(format === "html" ? `<p><a href="${escapeHtml(block.path)}">${escapeHtml(block.label)}</a></p>${block.caption ? `<p>${escapeHtml(block.caption)}</p>` : ""}` : `[${block.label}](${block.path})${block.caption ? `\n\n${block.caption}` : ""}`);
    if (block.kind !== "screenshot") continue;
    const assetPath = module.assets?.screenshots?.find(candidate => candidate.endsWith(`/${block.stepId}.png`)) ?? `modules/${module.id}/screenshots/${block.stepId}.png`;
    const source = safeResolve(manifestDir, assetPath);
    const destination = path.join(assetsDir, module.id, path.basename(source));
    const relative = embedImages
      ? `data:${mimeType(source)};base64,${(await readFile(source)).toString("base64")}`
      : portable(path.relative(documentDir, destination));
    if (!embedImages) {
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    output.push(format === "html" ? `<figure><img src="${escapeHtml(relative)}" alt="${escapeHtml(block.alt)}"><figcaption>${escapeHtml(block.caption)}</figcaption></figure>` : `![${escapeMarkdown(block.alt)}](${relative})\n\n${block.caption}`);
  }
  return output;
}

function resolveTarget(root, target) {
  const destination = path.resolve(root, target);
  const relative = path.relative(root, destination);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Documentation target escapes the chosen output folder; ask the user and configure that destination first.");
  }
  return destination;
}
function adaptMarkdown(existing, generated) {
  let result = existing;
  for (const item of generated) {
    const marker = new RegExp(`<!-- autotour:module=${item.moduleId}:start -->[\\s\\S]*?<!-- autotour:module=${item.moduleId}:end -->`);
    result = marker.test(result) ? result.replace(marker, item.content) : `${result.trim()}\n\n${item.content}\n`;
  }
  return result;
}
function safeResolve(root, relative) {
  const resolved = path.resolve(root, relative);
  if (path.relative(root, resolved).startsWith("..")) throw new Error(`Documentation asset escapes its capture directory: ${relative}`);
  return resolved;
}
async function exists(file) { try { await readFile(file); return true; } catch { return false; } }
function portable(value) { return value.split(path.sep).join("/"); }
function documentLanguage(spec, walkthrough) {
  const value = spec.language ?? walkthrough.language ?? "en";
  return /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(value) ? value : "en";
}
function mimeType(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return "image/png";
}
const manualStyle = "body{margin:0 auto;max-width:52rem;padding:1.5rem;font:1rem/1.5 system-ui,sans-serif}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}aside.autotour-note,blockquote{border-left:.25rem solid #888;margin:1rem 0;padding:.25rem 1rem}figure{break-inside:avoid;margin:1.5rem 0}pre{overflow:auto}";
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function escapeMarkdown(value) { return String(value).replace(/[\\[\]]/g, "\\$&"); }
