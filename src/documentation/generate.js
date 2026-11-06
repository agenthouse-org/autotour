import { copyFile, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { languageLinks } from "./languages.js";
import { pageForText, pdfPageTexts } from "./pdf-text.js";
import { validateDocumentationSpec } from "./spec.js";
import { loadOpenApiDocuments, renderOpenApiMarkdown } from "./openapi.js";
import { escapeMarkdown, fileExists, mimeType, portable, renderBlocks, requireOperation, safeResolve } from "./blocks.js";
import { resolveLabels } from "./manual/labels.js";
import { aiLabel, sectionAiItems, sectionOrigin, aiDisclosureWarnings } from "./manual/ai.js";
import { buildReaderModel } from "./manual/model.js";
import { pageFooterTemplate, renderManualPage } from "./manual/html.js";
import { createImageEncoder } from "./manual/images.js";
import { generateLaRecipe } from "./larecipe.js";

/**
 * Generate every selected target of one documentation specification.
 * `presentation` holds project-level defaults (for example `{ navigation: "sidebar" }`).
 */
export async function generateDocumentation({ spec, specPath, walkthrough, walkthroughFile, targets, outputRoot, mode = "create", draft = false, openApiDocuments, presentation = {} }) {
  const documents = openApiDocuments ?? await loadOpenApiForGeneration(spec, specPath);
  const validation = await validateDocumentationSpec(spec, { journey: walkthrough, openApiDocuments: documents });
  if (!validation.valid) throw new Error(`Cannot generate documentation: ${JSON.stringify(validation.errors)}`);
  const selected = (targets?.length ? targetList(spec).filter(target => targets.includes(target.kind)) : targetList(spec));
  if (!selected.length) throw new Error("No documentation targets were selected.");
  const manifestFile = walkthroughFile ? path.resolve(walkthroughFile) : (specPath ? path.resolve(specPath) : process.cwd());
  const manifestDir = path.dirname(manifestFile);
  const specDir = specPath ? path.dirname(path.resolve(specPath)) : manifestDir;
  const root = path.resolve(outputRoot ?? ".autotour/output/documentation");
  // Preflight every destination before copying assets or writing any target.
  for (const target of selected) {
    if (target.path) resolveTarget(root, target.path);
  }
  const language = documentLanguage(spec, walkthrough);
  const context = {
    spec,
    specPath,
    walkthrough,
    root,
    mode,
    draft,
    language,
    labels: resolveLabels(language, spec.labels),
    source: { walkthrough, manifestDir, specDir, openApiDocuments: documents },
    presentation
  };
  const warnings = documentationWarnings(spec, presentation, selected);
  const results = [];
  for (const target of selected) {
    if (target.kind === "markdown") results.push(await generateMarkdown({ ...context, target }));
    else if (target.kind === "html") results.push(await generateHtml({ ...context, target }));
    else if (target.kind === "pdf") results.push(await generatePdf({ ...context, target }));
    else if (target.kind === "larecipe") results.push(await generateLaRecipe({ ...context, target, items: specItems(spec, context.source), title: documentTitle(spec, walkthrough), numbering: spec.numbering ?? false, aiPlacement: spec.aiDisclosure?.placement ?? "none" }));
    else results.push(await generateConfluencePlan({ spec, target, root, openApiDocuments: documents }));
  }
  return { mode, targets: results, ...(warnings.length ? { warnings } : {}) };
}

/** Warnings that do not stop generation but need the author's attention. */
export function documentationWarnings(spec, presentation = {}, targets = targetList(spec)) {
  const warnings = aiDisclosureWarnings({ sections: spec.sections, aiDisclosure: spec.aiDisclosure, where: spec.walkthroughId });
  if (targets.some(target => target.kind === "html") && !spec.navigation && !presentation.navigation) {
    warnings.push(`${spec.walkthroughId}: no navigation flavour was chosen, so the HTML uses "sidebar". Ask the author (sidebar, topbar, minimal) and save it with autotour configure-presentation --navigation <flavour>.`);
  }
  return warnings;
}

function targetList(spec) {
  return spec.targets ?? (spec.destination ? [spec.destination] : []);
}

function specItems(spec, source) {
  return spec.sections.map(section => ({ kind: "section", anchor: section.moduleId, section, source }));
}

function documentTitle(spec, walkthrough) {
  return spec.title ?? walkthrough?.title ?? walkthrough?.id ?? spec.walkthroughId;
}

async function generateMarkdown({ spec, walkthrough, target, root, mode, draft, labels, source }) {
  const destination = resolveTarget(root, target.path);
  const assetsDir = path.join(path.dirname(destination), "assets", "autotour", walkthrough.id);
  const placement = spec.aiDisclosure?.placement ?? "none";
  const generated = [];
  const aiSections = [];
  for (const section of spec.sections) {
    const origin = sectionOrigin(section);
    if (origin) aiSections.push(section);
    const badge = origin && placement === "chapter" ? ` *(${aiLabel(origin, labels)})*` : "";
    generated.push({
      moduleId: section.moduleId,
      content: [`${"#".repeat(section.headingLevel ?? 2)} ${escapeMarkdown(section.heading)}${badge}`, `<!-- autotour:module=${section.moduleId}:start -->`, ...await renderBlocks({ section, walkthrough, manifestDir: source.manifestDir, specDir: source.specDir, assetsDir, documentDir: path.dirname(destination), format: "markdown", draft, openApiDocuments: source.openApiDocuments, labels, aiPlacement: placement }), `<!-- autotour:module=${section.moduleId}:end -->`].join("\n")
    });
  }
  let note = "";
  if (aiSections.length && placement === "document") {
    note = `*${labels.aiNote}*`;
    const lines = aiSections.map(section => `- [${escapeMarkdown(section.heading)}](#${section.moduleId}): ${sectionAiItems(section, labels).map(item => `${item.kind} (${item.label})`).join(", ")}`);
    generated.push({
      moduleId: "autotour-ai-content",
      content: [`## ${escapeMarkdown(labels.aiSection)}`, "<!-- autotour:module=autotour-ai-content:start -->", labels.aiSectionIntro, "", ...lines, "<!-- autotour:module=autotour-ai-content:end -->"].join("\n")
    });
  } else if (aiSections.length && placement !== "none") {
    note = `*${labels.aiNote}*`;
  }
  const existing = mode === "adapt" && await exists(destination) ? await readFile(destination, "utf8") : undefined;
  const body = existing
    ? adaptMarkdown(existing, generated)
    : [`# ${escapeMarkdown(documentTitle(spec, walkthrough))}`, ...(note ? [note] : []), "", ...generated.map(item => item.content)].join("\n\n");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${body.trim()}\n`, "utf8");
  return { kind: "markdown", path: destination, mode, assetsDir };
}

async function generateHtml({ spec, specPath, walkthrough, target, root, draft, language, labels, source, presentation }) {
  const destination = resolveTarget(root, target.path);
  const htmlMode = target.mode ?? spec.generation?.htmlMode ?? "site";
  const page = await buildPage({
    title: documentTitle(spec, walkthrough),
    language,
    labels,
    items: specItems(spec, source),
    settings: { ...presentation, ...pickSettings(spec) },
    destination,
    embedImages: htmlMode === "single-file",
    draft,
    brandingDir: source.specDir,
    languages: await languageLinks({ spec, specPath, outputRoot: root, currentHtmlPath: destination })
  });
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, page, "utf8");
  return { kind: "html", path: destination, mode: htmlMode };
}

/** Settings a specification or manual can declare for its reader output. */
export function pickSettings(document) {
  const settings = {};
  for (const key of ["navigation", "numbering", "aiDisclosure", "branding", "images"]) {
    if (document[key] !== undefined) settings[key] = document[key];
  }
  return settings;
}

/**
 * Render one HTML (or print) page for a list of part and section items.
 * @param {object} options
 */
export async function buildPage({ title, language, labels, items, settings, destination, embedImages, draft, brandingDir, languages = [], print = false, tocPages, model: prepared }) {
  const documentDir = path.dirname(destination);
  const assetsDir = path.join(documentDir, "assets");
  const encoder = embedImages ? createImageEncoder(settings.images) : createImageEncoder();
  try {
    const model = prepared ?? await buildReaderModel({
      items,
      labels,
      numbering: settings.numbering ?? false,
      aiPlacement: settings.aiDisclosure?.placement ?? "none",
      documentDir,
      assetsDir,
      embedImages,
      encodeImage: encoder.encode,
      draft
    });
    const branding = await brandingFor(settings.branding, { baseDir: brandingDir, assetsDir, documentDir, embedImages });
    const page = renderManualPage({ ...model, title, language, labels, navigation: settings.navigation ?? "sidebar", branding, draft, languages }, { print, tocPages });
    return page;
  } finally {
    await encoder.close();
  }
}

async function brandingFor(branding, { baseDir, assetsDir, documentDir, embedImages }) {
  if (!branding) return undefined;
  const result = { colors: branding.colors, fontFamily: branding.fontFamily, logoAlt: branding.logoAlt };
  if (branding.logo) {
    const source = safeResolve(baseDir, branding.logo);
    if (!await fileExists(source)) throw new Error(`Branding logo was not found (${branding.logo}).`);
    if (embedImages) {
      result.logoUrl = `data:${mimeType(source)};base64,${(await readFile(source)).toString("base64")}`;
    } else {
      const destination = path.join(assetsDir, "branding", path.basename(source));
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      result.logoUrl = portable(path.relative(documentDir, destination));
    }
  }
  return result;
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

async function generatePdf({ spec, walkthrough, target, root, mode, draft, language, labels, source, presentation }) {
  const destination = resolveTarget(root, target.path);
  const pdf = await printPdf({
    title: documentTitle(spec, walkthrough),
    language,
    labels,
    items: specItems(spec, source),
    settings: { ...presentation, ...pickSettings(spec) },
    destination,
    draft,
    brandingDir: source.specDir
  });
  await writeFile(destination, pdf);
  return { kind: "pdf", path: destination, mode };
}

/** Print a PDF from the print rendering of the same model; a second pass adds page numbers to the contents. */
export async function printPdf({ title, language, labels, items, settings, destination, draft, brandingDir }) {
  const temporary = `${destination}.autotour.html`;
  const documentDir = path.dirname(temporary);
  const assetsDir = path.join(documentDir, "assets");
  await mkdir(documentDir, { recursive: true });
  const model = await buildReaderModel({
    items,
    labels,
    numbering: settings.numbering ?? false,
    aiPlacement: settings.aiDisclosure?.placement ?? "none",
    documentDir,
    assetsDir,
    draft
  });
  const sections = model.entries.filter(entry => entry.kind === "section");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let tocPages = {};
    let pdf;
    for (let pass = 0; pass < 2; pass += 1) {
      const html = await buildPage({ title, language, labels, items, settings, destination: temporary, embedImages: false, draft, brandingDir, print: true, tocPages, model });
      await writeFile(temporary, html, "utf8");
      await page.goto(fileUrl(temporary), { waitUntil: "load" });
      pdf = await page.pdf(pdfOptions(title, labels));
      tocPages = Object.fromEntries(sections.map(section => [section.anchor, pageForText(pdfPageTexts(pdf), section.heading, title)]).filter(([, pageNumber]) => pageNumber > 0));
    }
    return pdf;
  } finally {
    await browser.close();
    await rm(temporary, { force: true });
  }
}

function pdfOptions(title, labels) {
  return {
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    outline: true,
    tagged: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:9px;width:100%;padding:0 12mm;color:#444">${escapeHtml(title)}</div>`,
    footerTemplate: `<div style="font-size:10px;width:100%;text-align:center;color:#333">${pageFooterTemplate(labels)}</div>`,
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" }
  };
}

function fileUrl(file) {
  return `file://${file.replaceAll("\\", "/")}`;
}

async function loadOpenApiForGeneration(spec, specPath) {
  if (!spec.sections.some(section => section.blocks.some(block => block.kind === "openapi"))) return undefined;
  if (!specPath) throw new Error("OpenAPI documentation blocks require the specification path.");
  return loadOpenApiDocuments(specPath, spec);
}

export function resolveTarget(root, target) {
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
async function exists(file) { try { await readFile(file); return true; } catch { return false; } }
export function documentLanguage(spec, walkthrough) {
  const value = spec.language ?? walkthrough?.language ?? "en";
  return /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(value) ? value : "en";
}
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
