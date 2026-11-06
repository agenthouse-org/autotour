import { renderBlocks, escapeHtml } from "../blocks.js";
import { aiLabel, sectionAiItems, sectionOrigin } from "./ai.js";
import { contentsText } from "./html.js";
import { linkReferences, numberEntries } from "./references.js";

/**
 * Build the reader model (rendered sections, parts, AI notes) shared by HTML and PDF output.
 *
 * @param {object} options
 * @param {{ kind: "part"|"section", label?: string, anchor: string, section?: object, source?: object }[]} options.items
 * @param {Record<string, string>} options.labels
 * @param {boolean} [options.numbering]
 * @param {"document"|"chapter"|"item"|"none"} [options.aiPlacement]
 * @param {string} options.documentDir
 * @param {string} options.assetsDir
 * @param {boolean} [options.embedImages]
 * @param {Function} [options.encodeImage]
 * @param {boolean} [options.draft]
 */
export async function buildReaderModel({ items, labels, numbering = false, aiPlacement = "none", documentDir, assetsDir, embedImages = false, encodeImage, draft = false }) {
  const entries = items.map(item => item.kind === "part"
    ? { kind: "part", anchor: item.anchor, label: item.label }
    : { kind: "section", anchor: item.anchor, level: item.section.headingLevel ?? 2, heading: item.section.heading, item });
  if (numbering) numberEntries(entries);
  const anchors = new Map(entries.filter(entry => entry.number).map(entry => [entry.number, entry.anchor]));
  const placement = aiPlacement ?? "none";
  let anyAi = false;
  const closing = [];
  for (const entry of entries) {
    if (entry.kind !== "section") continue;
    const { section, source } = entry.item;
    const blocks = await renderBlocks({
      section,
      walkthrough: source.walkthrough,
      manifestDir: source.manifestDir,
      specDir: source.specDir,
      assetsDir,
      documentDir,
      format: "html",
      embedImages,
      encodeImage,
      draft,
      openApiDocuments: source.openApiDocuments,
      labels,
      aiPlacement: placement
    });
    const origin = sectionOrigin(section);
    if (origin) anyAi = true;
    if (origin && placement === "document") closing.push({ entry, items: sectionAiItems(section, labels) });
    const badge = origin && placement === "chapter" ? ` <span class="autotour-ai">${escapeHtml(aiLabel(origin, labels))}</span>` : "";
    const number = entry.number ? `<span class="autotour-number">${escapeHtml(entry.number)}</span>` : "";
    const body = numbering
      ? linkReferences(blocks.join("\n"), anchors, [labels.chapterReference, labels.sectionReference])
      : blocks.join("\n");
    entry.origin = origin;
    entry.html = `<section id="${escapeHtml(entry.anchor)}"><h${entry.level}>${number}${escapeHtml(entry.heading)}${badge}</h${entry.level}>${body}</section>`;
    delete entry.item;
  }
  const model = { entries };
  if (anyAi && placement === "document") {
    model.aiNoteHtml = `<p class="autotour-ai-note">${escapeHtml(labels.aiNote)} <a href="#autotour-ai-content">${escapeHtml(labels.aiNoteLink)}</a></p>`;
    model.aiClosingHtml = `<section id="autotour-ai-content" class="autotour-ai-content"><h2>${escapeHtml(labels.aiSection)}</h2><p>${escapeHtml(labels.aiSectionIntro)}</p><ul>${closing.map(({ entry, items: aiItems }) => `<li><a href="#${escapeHtml(entry.anchor)}">${escapeHtml(contentsText(entry))}</a>: ${escapeHtml(aiItems.map(item => `${item.kind} (${item.label})`).join(", "))}</li>`).join("")}</ul></section>`;
  }
  if (anyAi && (placement === "chapter" || placement === "item")) {
    model.footerHtml = `<footer class="autotour-footer"><p>${escapeHtml(labels.aiNote)}</p></footer>`;
  }
  return model;
}
