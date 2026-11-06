import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderBlocks, escapeMarkdown } from "./blocks.js";
import { aiLabel, sectionAiItems, sectionOrigin } from "./manual/ai.js";
import { linkReferences, numberEntries } from "./manual/references.js";

/**
 * Write a LaRecipe documentation version: one Markdown page per chapter in `<path>/<version>/`,
 * an `index.md` sidebar, and images under the public assets folder.
 *
 * LaRecipe replaces `{{route}}` and `{{version}}` in links, brings its own search, and opens the page
 * configured as `docs.landing` in `config/larecipe.php`; the result names the first page for that setting.
 *
 * @param {object} options
 * @param {{ path: string, version: string, assetsPath?: string, assetsUrl?: string }} options.target
 * @param {string} options.root
 * @param {Record<string, string>} options.labels
 * @param {object[]} options.items part and section items
 * @param {string} options.title
 * @param {boolean} [options.numbering]
 * @param {string} [options.aiPlacement]
 * @param {boolean} [options.draft]
 */
export async function generateLaRecipe({ target, root, labels, items, title, numbering = false, aiPlacement = "none", draft = false }) {
  const docsDir = inside(root, path.join(target.path, target.version));
  const assetsRoot = inside(root, path.join(target.assetsPath ?? "public/docs-assets", target.version));
  const assetsUrl = `${(target.assetsUrl ?? "/docs-assets").replace(/\/$/, "")}/${encodeURIComponent(target.version)}`;
  const entries = items.map(item => item.kind === "part" ? { ...item } : { ...item, level: item.section.headingLevel ?? 2 });
  if (numbering) numberEntries(entries);

  // A chapter (level 1 or 2) starts a page; deeper sections stay on their chapter's page.
  const pages = [];
  let group = { label: title, pages: [] };
  const groups = [group];
  for (const entry of entries) {
    if (entry.kind === "part") {
      group = { label: entry.label, pages: [] };
      groups.push(group);
      continue;
    }
    if (entry.level <= 2 || !pages.length) {
      const page = { slug: entry.anchor, entry, sections: [entry] };
      pages.push(page);
      group.pages.push(page);
    } else {
      pages.at(-1).sections.push(entry);
    }
  }
  const pageOf = new Map();
  for (const page of pages) for (const entry of page.sections) pageOf.set(entry.anchor, page);
  const anchors = new Map(entries.filter(entry => entry.number).map(entry => [entry.number, entry.anchor]));
  const href = anchor => {
    const page = pageOf.get(anchor);
    return `/{{route}}/{{version}}/${page.slug}${page.slug === anchor ? "" : `#${anchor}`}`;
  };

  const aiSections = entries.filter(entry => entry.kind === "section" && sectionOrigin(entry.section));
  await mkdir(docsDir, { recursive: true });
  for (const [index, page] of pages.entries()) {
    const parts = [];
    if (index === 0 && aiSections.length && aiPlacement !== "none") {
      parts.push(`<small>${escapeText(labels.aiNote)}${aiPlacement === "document" ? ` <a href="/{{route}}/{{version}}/ai-content">${escapeText(labels.aiNoteLink)}</a>` : ""}</small>`);
    }
    for (const entry of page.sections) {
      const origin = sectionOrigin(entry.section);
      const badge = origin && aiPlacement === "chapter" ? ` <small>${escapeText(aiLabel(origin, labels))}</small>` : "";
      const depth = entry === page.entry ? 1 : Math.max(2, entry.level - (page.entry.level - 1));
      const heading = `${entry.number ? `${entry.number} ` : ""}${escapeMarkdown(entry.section.heading)}`;
      if (entry !== page.entry) parts.push(`<a name="${entry.anchor}"></a>`);
      parts.push(`${"#".repeat(depth)} ${heading}${badge}`);
      const blocks = await renderBlocks({
        section: entry.section,
        walkthrough: entry.source.walkthrough,
        manifestDir: entry.source.manifestDir,
        specDir: entry.source.specDir,
        assetsDir: assetsRoot,
        documentDir: docsDir,
        format: "markdown",
        draft,
        openApiDocuments: entry.source.openApiDocuments,
        labels,
        aiPlacement,
        imageUrl: (source, destination) => `${assetsUrl}/${path.relative(assetsRoot, destination).split(path.sep).map(encodeURIComponent).join("/")}`
      });
      const body = blocks.join("\n\n");
      parts.push(numbering ? linkReferences(body, anchors, [labels.chapterReference, labels.sectionReference], href) : body);
    }
    await writeFile(path.join(docsDir, `${page.slug}.md`), `${parts.join("\n\n").trim()}\n`, "utf8");
  }
  if (aiSections.length && aiPlacement === "document") {
    const lines = aiSections.map(entry => `- [${entry.number ? `${entry.number} ` : ""}${escapeMarkdown(entry.section.heading)}](${href(entry.anchor)}): ${sectionAiItems(entry.section, labels).map(item => `${item.kind} (${item.label})`).join(", ")}`);
    await writeFile(path.join(docsDir, "ai-content.md"), `# ${escapeMarkdown(labels.aiSection)}\n\n${labels.aiSectionIntro}\n\n${lines.join("\n")}\n`, "utf8");
    groups.at(-1).pages.push({ slug: "ai-content", entry: { section: { heading: labels.aiSection } }, sections: [] });
  }
  const sidebar = groups.filter(item => item.pages.length).map(item => [
    `- ## ${escapeMarkdown(item.label)}`,
    ...item.pages.map(page => `    - [${page.entry.number ? `${page.entry.number} ` : ""}${escapeMarkdown(page.entry.section.heading)}](/{{route}}/{{version}}/${page.slug})`)
  ].join("\n")).join("\n\n");
  await writeFile(path.join(docsDir, "index.md"), `${sidebar}\n`, "utf8");
  return { kind: "larecipe", path: docsDir, assetsPath: assetsRoot, pages: pages.length, landing: pages[0]?.slug };
}

function inside(root, relative) {
  const destination = path.resolve(root, relative);
  const check = path.relative(root, destination);
  if (check === ".." || check.startsWith(`..${path.sep}`) || path.isAbsolute(check)) {
    throw new Error("LaRecipe output escapes the chosen output folder; ask the user and configure that destination first.");
  }
  return destination;
}

function escapeText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
