import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { renderMarkdown } from "./markdown.js";
import { operationFor, renderOpenApiHtml, renderOpenApiMarkdown } from "./openapi.js";
import { resolveLabels } from "./manual/labels.js";
import { aiLabel, blockOrigin } from "./manual/ai.js";

/**
 * Render the blocks of one documentation section.
 *
 * @param {object} options
 * @param {object} options.section
 * @param {object} options.walkthrough
 * @param {string} options.manifestDir directory that capture asset paths are relative to
 * @param {string} [options.specDir] directory that authored files (embeds) are relative to
 * @param {string} options.assetsDir
 * @param {string} options.documentDir
 * @param {"html"|"markdown"} options.format
 * @param {boolean} [options.embedImages]
 * @param {boolean} [options.draft]
 * @param {Map<string, object>} [options.openApiDocuments]
 * @param {Record<string, string>} [options.labels]
 * @param {"item"|"chapter"|"document"|"none"} [options.aiPlacement]
 * @param {(file: string) => Promise<{ data: Buffer, mime: string }>} [options.encodeImage]
 * @param {(file: string, destination: string) => string} [options.imageUrl] URL for a copied image (LaRecipe)
 */
export async function renderBlocks({
  section,
  walkthrough,
  manifestDir,
  specDir,
  assetsDir,
  documentDir,
  format,
  embedImages = false,
  draft = false,
  openApiDocuments,
  labels = resolveLabels("en"),
  aiPlacement = "none",
  encodeImage,
  imageUrl
}) {
  const status = section.status ?? "ready";
  const module = walkthrough?.modules?.find(candidate => candidate.id === section.moduleId);
  const output = [];
  const itemLabel = block => (aiPlacement === "item" ? aiLabel(blockOrigin(block), labels) : "");
  const image = async (source, destination) => {
    if (embedImages) {
      const encoded = encodeImage ? await encodeImage(source) : { data: await readFile(source), mime: mimeType(source) };
      return `data:${encoded.mime};base64,${encoded.data.toString("base64")}`;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    return imageUrl ? imageUrl(source, destination) : portable(path.relative(documentDir, destination));
  };
  for (const block of section.blocks) {
    const ai = itemLabel(block);
    if (block.kind === "text") {
      if (format === "html") output.push(renderMarkdown(block.text) + (ai ? `<p class="autotour-ai">${escapeHtml(ai)}</p>` : ""));
      else output.push(block.text + (ai ? `\n\n*${ai}*` : ""));
    }
    if (block.kind === "tour") output.push(format === "html" ? `<p><a href="${escapeHtml(block.url)}">${escapeHtml(block.label)}</a></p>` : `[${block.label}](${block.url})`);
    if (block.kind === "video") output.push(await renderVideo({ block, section, manifestDir, assetsDir, format, image, ai }));
    if (block.kind === "embed") output.push(await renderEmbed({ block, section, specDir: specDir ?? manifestDir, assetsDir, format, image, labels, ai }));
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
      const relative = await image(source, path.join(assetsDir, module.id, path.basename(source)));
      const aiHtml = ai ? ` <span class="autotour-ai">${escapeHtml(ai)}</span>` : "";
      output.push(format === "html"
        ? `<figure class="autotour-shot"><img src="${escapeHtml(relative)}" alt="${escapeHtml(block.alt)}"><figcaption>${escapeHtml(block.caption)}${aiHtml}</figcaption></figure>`
        : `![${escapeMarkdown(block.alt)}](${relative})\n\n${block.caption}${ai ? ` *(${ai})*` : ""}`);
      continue;
    }
    if (draft || status === "planned") {
      output.push(screenshotPlaceholder(block, format, labels));
      continue;
    }
    const where = assetPath ? ` (${assetPath})` : "";
    throw new Error(`${section.moduleId}: screenshot for step ${block.stepId} has not been captured${where}. Capture it, or run with --draft to show a placeholder.`);
  }
  return output;
}

async function renderVideo({ block, section, manifestDir, assetsDir, format, image, ai }) {
  const caption = block.caption ? (format === "html" ? `<figcaption>${escapeHtml(block.caption)}${ai ? ` <span class="autotour-ai">${escapeHtml(ai)}</span>` : ""}</figcaption>` : block.caption) : "";
  const link = format === "html" ? `<a href="${escapeHtml(block.path)}">${escapeHtml(block.label)}</a>` : `[${block.label}](${block.path})`;
  const aiMarkdown = ai ? ` *(${ai})*` : "";
  if (!block.still || format !== "html") {
    if (format === "html") return `<p>${link}</p>${block.caption ? `<p>${escapeHtml(block.caption)}</p>` : ""}${ai && !block.caption ? `<p class="autotour-ai">${escapeHtml(ai)}</p>` : ""}`;
    return `${link}${block.caption ? `\n\n${block.caption}` : ""}${aiMarkdown}`;
  }
  const source = resolveAuthoredFile(manifestDir, block.still, `${section.moduleId}: motion still for ${block.label}`);
  await requireFile(source, `${section.moduleId}: motion still for ${block.label} was not found (${block.still}).`);
  const relative = await image(source, path.join(assetsDir, "stills", path.basename(source)));
  return `<figure class="autotour-still"><img src="${escapeHtml(relative)}" alt="${escapeHtml(block.label)}">${caption}<p>${link}</p></figure>`;
}

async function renderEmbed({ block, section, specDir, assetsDir, format, image, labels, ai }) {
  const still = resolveAuthoredFile(specDir, block.still, `${section.moduleId}: still image for ${block.label}`);
  await requireFile(still, `${section.moduleId}: still image for ${block.label} was not found (${block.still}).`);
  const stillUrl = await image(still, path.join(assetsDir, "embeds", path.basename(still)));
  const caption = block.caption ?? "";
  if (format !== "html") {
    return `![${escapeMarkdown(block.label)}](${stillUrl})${caption ? `\n\n${caption}` : ""}${ai ? ` *(${ai})*` : ""}`;
  }
  const page = resolveAuthoredFile(specDir, block.path, `${section.moduleId}: embedded page for ${block.label}`);
  await requireFile(page, `${section.moduleId}: embedded page for ${block.label} was not found (${block.path}).`);
  const source = await readFile(page, "utf8");
  const ready = JSON.stringify(block.readyMessage ?? { type: "autotour:ready" });
  const aiHtml = ai ? ` <span class="autotour-ai">${escapeHtml(ai)}</span>` : "";
  const figcaption = caption || ai ? `<figcaption>${escapeHtml(caption)}${aiHtml}</figcaption>` : "";
  return `<figure class="autotour-embed" data-ready="${escapeHtml(ready)}"><div class="autotour-embed-stage"><img class="autotour-embed-still" src="${escapeHtml(stillUrl)}" alt="${escapeHtml(block.label)}"><iframe class="autotour-embed-frame" title="${escapeHtml(block.label)}" sandbox="allow-scripts" loading="lazy" tabindex="-1" srcdoc="${escapeHtml(source)}"></iframe></div>${figcaption}<noscript><p>${escapeHtml(labels.embedFallback)}</p></noscript></figure>`;
}

function screenshotPlaceholder(block, format, labels) {
  if (format === "html") {
    return `<figure class="autotour-placeholder"><p>${escapeHtml(labels.screenshotMissing)}</p><p>${escapeHtml(labels.step)}: ${escapeHtml(block.stepId)}</p><p>${escapeHtml(block.alt)}</p><figcaption>${escapeHtml(block.caption)}</figcaption></figure>`;
  }
  return [
    `> ${escapeMarkdown(labels.screenshotMissing)}`,
    ">",
    `> ${escapeMarkdown(labels.step)}: ${escapeMarkdown(block.stepId)}`,
    ">",
    `> ${escapeMarkdown(block.alt)}`,
    ">",
    `> ${escapeMarkdown(block.caption)}`
  ].join("\n");
}

export function requireOperation(openApiDocuments, block) {
  const loaded = openApiDocuments?.get(block.document);
  const operation = loaded ? operationFor(loaded, block.operation) : null;
  if (!operation) throw new Error(`OpenAPI operation ${block.operation} is not available in ${block.document}.`);
  return operation;
}

function resolveAuthoredFile(root, relative, what) {
  try {
    return safeResolve(root, relative);
  } catch {
    throw new Error(`${what} is not a safe file (${relative}).`);
  }
}

async function requireFile(file, message) {
  if (!await fileExists(file)) throw new Error(message);
}

export function safeResolve(root, relative) {
  const resolved = path.resolve(root, relative);
  if (path.relative(root, resolved).startsWith("..")) throw new Error(`Documentation asset escapes its capture directory: ${relative}`);
  return resolved;
}
export async function fileExists(file) { try { await access(file); return true; } catch { return false; } }
export function portable(value) { return value.split(path.sep).join("/"); }
export function mimeType(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return "image/png";
}
export function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
export function escapeMarkdown(value) { return String(value).replace(/[\\[\]]/g, "\\$&"); }
