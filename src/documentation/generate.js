import { access, copyFile, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { renderMarkdown } from "./markdown.js";
import { readerChrome } from "./reader.js";
import { languageSwitchMarkup } from "./languages.js";
import { pageForText, pdfPageTexts } from "./pdf-text.js";
import { validateDocumentationSpec } from "./spec.js";
import { loadOpenApiDocuments, operationFor, renderOpenApiHtml, renderOpenApiMarkdown } from "./openapi.js";

const placeholderStyle = "figure.autotour-placeholder{border:1px dashed #666;padding:1rem;margin:1rem 0;background:#f6f6f6}";

export async function generateDocumentation({ spec, specPath, walkthrough, walkthroughFile, targets, outputRoot, mode = "create", draft = false, openApiDocuments }) {
  const documents = openApiDocuments ?? await loadOpenApiForGeneration(spec, specPath);
  const validation = await validateDocumentationSpec(spec, { journey: walkthrough, openApiDocuments: documents });
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
    if (target.kind === "markdown") results.push(await generateMarkdown({ spec, walkthrough, target, manifestDir, root, mode, draft, openApiDocuments: documents }));
    else if (target.kind === "html") results.push(await generateHtml({ spec, specPath, walkthrough, target, manifestDir, root, mode, draft, openApiDocuments: documents }));
    else if (target.kind === "pdf") results.push(await generatePdf({ spec, walkthrough, target, manifestDir, root, mode, draft, openApiDocuments: documents }));
    else results.push(await generateConfluencePlan({ spec, target, root, openApiDocuments: documents }));
  }
  return { mode, targets: results };
}

function targetList(spec) {
  return spec.targets ?? (spec.destination ? [spec.destination] : []);
}

async function generateMarkdown({ spec, walkthrough, target, manifestDir, root, mode, draft, openApiDocuments }) {
  const destination = resolveTarget(root, target.path);
  const assetsDir = path.join(path.dirname(destination), "assets", "autotour", walkthrough.id);
  const generated = [];
  for (const section of spec.sections) {
    generated.push({
      moduleId: section.moduleId,
      content: [`${"#".repeat(section.headingLevel ?? 2)} ${escapeMarkdown(section.heading)}`, `<!-- autotour:module=${section.moduleId}:start -->`, ...await renderBlocks({ section, walkthrough, manifestDir, assetsDir, documentDir: path.dirname(destination), format: "markdown", draft, openApiDocuments }), `<!-- autotour:module=${section.moduleId}:end -->`].join("\n")
    });
  }
  const existing = mode === "adapt" && await exists(destination) ? await readFile(destination, "utf8") : undefined;
  const body = existing ? adaptMarkdown(existing, generated) : [`# ${escapeMarkdown(spec.title ?? walkthrough.title ?? walkthrough.id)}`, "", ...generated.map(item => item.content)].join("\n\n");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${body.trim()}\n`, "utf8");
  return { kind: "markdown", path: destination, mode, assetsDir };
}

async function generateHtml({ spec, specPath, walkthrough, target, manifestDir, root, mode, draft, openApiDocuments }) {
  const destination = resolveTarget(root, target.path);
  const htmlMode = target.mode ?? spec.generation?.htmlMode ?? "site";
  const reader = await readerContent({
    spec,
    walkthrough,
    manifestDir,
    documentDir: path.dirname(destination),
    assetsDir: path.join(path.dirname(destination), "assets"),
    embedImages: htmlMode === "single-file",
    draft,
    openApiDocuments
  });
  const chrome = readerChrome(spec.sections);
  const switcher = await languageSwitchMarkup({ spec, specPath, outputRoot: root, currentHtmlPath: destination });
  const html = documentationDocument(reader, { print: false, chrome, switcher });
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, html, "utf8");
  return { kind: "html", path: destination, mode: htmlMode };
}

async function generateConfluencePlan({ spec, target, root, openApiDocuments }) {
  const destination = resolveTarget(root, `confluence-${target.pageId}.json`);
  const plan = {
    kind: "confluence",
    siteUrl: target.siteUrl,
    pageId: target.pageId,
    sections: spec.sections.map(section => ({
      moduleId: section.moduleId,
      heading: section.heading,
      blocks: section.blocks.map(block => block.kind === "openapi" ? { ...block, renderedMarkdown: renderOpenApiMarkdown(requireOperation(openApiDocuments, block)) } : block)
    }))
  };
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return { kind: "confluence", path: destination, pageId: target.pageId, status: "plan-created" };
}

async function generatePdf({ spec, walkthrough, target, manifestDir, root, mode, draft, openApiDocuments }) {
  const destination = resolveTarget(root, target.path);
  const temporary = `${destination}.autotour.html`;
  const documentDir = path.dirname(temporary);
  const assetsDir = path.join(documentDir, "assets");
  await mkdir(documentDir, { recursive: true });
  const reader = await readerContent({ spec, walkthrough, manifestDir, documentDir, assetsDir, draft, openApiDocuments });
  const language = reader.language;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let tocPages = {};
    let pdf;
    for (let pass = 0; pass < 2; pass += 1) {
      await writeFile(temporary, documentationDocument(reader, { print: true, tocPages }), "utf8");
      await page.goto(fileUrl(temporary), { waitUntil: "load" });
      pdf = await page.pdf(pdfOptions(reader.title, language));
      tocPages = Object.fromEntries(reader.sections.map(section => [section.moduleId, pageForText(pdfPageTexts(pdf), section.heading, reader.title)]).filter(([, pageNumber]) => pageNumber > 0));
    }
    await writeFile(destination, pdf);
  } finally {
    await browser.close();
    await rm(temporary, { force: true });
  }
  return { kind: "pdf", path: destination, mode };
}

async function readerContent({ spec, walkthrough, manifestDir, documentDir, assetsDir, embedImages = false, draft = false, openApiDocuments }) {
  const sections = [];
  for (const section of spec.sections) {
    const blocks = await renderBlocks({ section, walkthrough, manifestDir, assetsDir, documentDir, format: "html", embedImages, draft, openApiDocuments });
    const level = section.headingLevel ?? 2;
    sections.push({
      moduleId: section.moduleId,
      heading: section.heading,
      level,
      html: `<section id="${section.moduleId}"><h${level}>${escapeHtml(section.heading)}</h${level}>${blocks.join("\n")}</section>`
    });
  }
  return {
    title: spec.title ?? walkthrough.title ?? walkthrough.id,
    language: documentLanguage(spec, walkthrough),
    sections
  };
}

function documentationDocument(reader, { print, tocPages = {}, chrome, switcher }) {
  const title = escapeHtml(reader.title);
  const nav = `<nav aria-label="Contents"><ol>${reader.sections.map(section => `<li><a href="#${section.moduleId}">${escapeHtml(section.heading)}</a></li>`).join("")}</ol></nav>`;
  const cover = print ? `<section class="autotour-cover"><h1>${title}</h1><nav aria-label="Contents"><ol>${reader.sections.map(section => `<li><a href="#${section.moduleId}">${escapeHtml(section.heading)}</a>${tocPages[section.moduleId] ? ` <span class="autotour-toc-page">${tocPages[section.moduleId]}</span>` : ""}</li>`).join("")}</ol></nav></section>` : "";
  const style = print
    ? `<style>@page{size:A4}body{font:12pt/1.5 system-ui}img{max-width:100%}figure{break-inside:avoid}figcaption{break-before:avoid;font-style:italic;margin-top:.4rem}h1,h2,h3{break-after:avoid}.autotour-cover{break-after:page;min-height:70vh}header h1,header nav{display:none}${placeholderStyle}</style>`
    : `<style>${manualStyle}${chrome?.style ?? ""}${placeholderStyle}</style>${switcher?.style ?? ""}`;
  return `<!doctype html>\n<html lang="${escapeHtml(reader.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>${style}</head><body>${cover}<header><h1>${title}</h1>${print ? nav : `${switcher?.markup ?? ""}${chrome?.header ?? nav}`}</header><main>${reader.sections.map(section => section.html).join("\n")}</main>${print ? "" : `${chrome?.script ?? ""}${switcher?.script ?? ""}`}</body></html>\n`;
}

function pdfOptions(title, language) {
  const german = String(language).toLowerCase().startsWith("de");
  const footer = german
    ? "Seite <span class=\"pageNumber\"></span> von <span class=\"totalPages\"></span>"
    : "Page <span class=\"pageNumber\"></span> of <span class=\"totalPages\"></span>";
  return {
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    outline: true,
    tagged: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:9px;width:100%;padding:0 12mm;color:#444">${escapeHtml(title)}</div>`,
    footerTemplate: `<div style="font-size:10px;width:100%;text-align:center;color:#333">${footer}</div>`,
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" }
  };
}

function fileUrl(file) {
  return `file://${file.replaceAll("\\", "/")}`;
}

async function renderVideo({ block, section, manifestDir, assetsDir, documentDir, format }) {
  const caption = block.caption ? (format === "html" ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : block.caption) : "";
  const link = format === "html" ? `<a href="${escapeHtml(block.path)}">${escapeHtml(block.label)}</a>` : `[${block.label}](${block.path})`;
  if (!block.still) return format === "html" ? `<p>${link}</p>${block.caption ? `<p>${escapeHtml(block.caption)}</p>` : ""}` : `${link}${block.caption ? `\n\n${block.caption}` : ""}`;
  if (format !== "html") return `${link}${block.caption ? `\n\n${block.caption}` : ""}`;
  let source;
  try {
    source = safeResolve(manifestDir, block.still);
  } catch (error) {
    throw new Error(`${section.moduleId}: motion still for ${block.label} is not a safe file (${block.still}).`);
  }
  const destination = path.join(assetsDir, "stills", path.basename(source));
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await copyFile(source, destination);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${section.moduleId}: motion still for ${block.label} was not found (${block.still}).`);
    throw error;
  }
  const relative = portable(path.relative(documentDir, destination));
  return `<figure class="autotour-still"><img src="${escapeHtml(relative)}" alt="${escapeHtml(block.label)}">${caption}<p>${link}</p></figure>`;
}

async function loadOpenApiForGeneration(spec, specPath) {
  if (!spec.sections.some(section => section.blocks.some(block => block.kind === "openapi"))) return undefined;
  if (!specPath) throw new Error("OpenAPI documentation blocks require the specification path.");
  return loadOpenApiDocuments(specPath, spec);
}

function requireOperation(openApiDocuments, block) {
  const loaded = openApiDocuments?.get(block.document);
  const operation = loaded ? operationFor(loaded, block.operation) : null;
  if (!operation) throw new Error(`OpenAPI operation ${block.operation} is not available in ${block.document}.`);
  return operation;
}

async function renderBlocks({ section, walkthrough, manifestDir, assetsDir, documentDir, format, embedImages = false, draft = false, openApiDocuments }) {
  const status = section.status ?? "ready";
  const module = walkthrough.modules.find(candidate => candidate.id === section.moduleId);
  const output = [];
  for (const block of section.blocks) {
    if (block.kind === "text") output.push(format === "html" ? renderMarkdown(block.text) : block.text);
    if (block.kind === "tour") output.push(format === "html" ? `<p><a href="${escapeHtml(block.url)}">${escapeHtml(block.label)}</a></p>` : `[${block.label}](${block.url})`);
    if (block.kind === "video") output.push(await renderVideo({ block, section, manifestDir, assetsDir, documentDir, format }));
    if (block.kind === "openapi") {
      const operation = requireOperation(openApiDocuments, block);
      output.push(format === "html" ? renderOpenApiHtml(operation) : renderOpenApiMarkdown(operation));
    }
    if (block.kind !== "screenshot") continue;
    const assetPath = module
      ? module.assets?.screenshots?.find(candidate => candidate.endsWith(`/${block.stepId}.png`)) ?? `modules/${module.id}/screenshots/${block.stepId}.png`
      : undefined;
    const source = assetPath ? safeResolve(manifestDir, assetPath) : undefined;
    if (source && await fileExists(source)) {
      const destination = path.join(assetsDir, module.id, path.basename(source));
      const relative = embedImages
        ? `data:${mimeType(source)};base64,${(await readFile(source)).toString("base64")}`
        : portable(path.relative(documentDir, destination));
      if (!embedImages) {
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(source, destination);
      }
      output.push(format === "html" ? `<figure><img src="${escapeHtml(relative)}" alt="${escapeHtml(block.alt)}"><figcaption>${escapeHtml(block.caption)}</figcaption></figure>` : `![${escapeMarkdown(block.alt)}](${relative})\n\n${block.caption}`);
      continue;
    }
    if (draft || status === "planned") {
      output.push(screenshotPlaceholder(block, format));
      continue;
    }
    const where = assetPath ? ` (${assetPath})` : "";
    throw new Error(`${section.moduleId}: screenshot for step ${block.stepId} has not been captured${where}. Capture it, or run with --draft to show a placeholder.`);
  }
  return output;
}

function screenshotPlaceholder(block, format) {
  if (format === "html") {
    return `<figure class="autotour-placeholder"><p>Screenshot not captured yet.</p><p>Step: ${escapeHtml(block.stepId)}</p><p>${escapeHtml(block.alt)}</p><figcaption>${escapeHtml(block.caption)}</figcaption></figure>`;
  }
  return [
    "> Screenshot not captured yet.",
    ">",
    `> Step: ${escapeMarkdown(block.stepId)}`,
    ">",
    `> ${escapeMarkdown(block.alt)}`,
    ">",
    `> ${escapeMarkdown(block.caption)}`
  ].join("\n");
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
async function fileExists(file) { try { await access(file); return true; } catch { return false; } }
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
