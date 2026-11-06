// AI provenance: which authored content was generated or modified with AI, and how the reader is told.

export const aiPlacements = ["document", "chapter", "item", "none"];

/**
 * The declared origin of a block. Screenshots and OpenAPI operations come from the real product,
 * so they count as "human" unless the author says otherwise.
 * @returns {"human"|"ai-generated"|"ai-modified"|undefined}
 */
export function blockOrigin(block) {
  if (block.origin) return block.origin;
  if (block.kind === "screenshot" || block.kind === "openapi" || block.kind === "tour") return "human";
  return undefined;
}

export function aiLabel(origin, labels) {
  if (origin === "ai-generated") return labels.aiGenerated;
  if (origin === "ai-modified") return labels.aiModified;
  return "";
}

/** The strongest AI origin in a section: generated beats modified. */
export function sectionOrigin(section) {
  const origins = section.blocks.map(blockOrigin);
  if (origins.includes("ai-generated")) return "ai-generated";
  if (origins.includes("ai-modified")) return "ai-modified";
  return undefined;
}

/** Items of one section that carry an AI origin, for the closing section. */
export function sectionAiItems(section, labels) {
  const items = [];
  for (const block of section.blocks) {
    const origin = blockOrigin(block);
    if (origin !== "ai-generated" && origin !== "ai-modified") continue;
    const kind = block.kind === "text" ? labels.aiText
      : block.kind === "embed" || block.kind === "video" ? labels.aiAnimation
        : labels.aiImage;
    items.push({ kind, label: aiLabel(origin, labels) });
  }
  return items;
}

/**
 * Warnings about AI disclosure for one specification or manual.
 * @param {{ sections: object[], aiDisclosure?: { placement?: string }, where?: string }} input
 */
export function aiDisclosureWarnings({ sections, aiDisclosure, where = "documentation" }) {
  const warnings = [];
  const marked = sections.filter(section => sectionOrigin(section));
  const placement = aiDisclosure?.placement;
  if (marked.length && !placement) {
    warnings.push(`${where}: ${marked.length} section(s) contain content marked as AI-generated or AI-modified, but aiDisclosure.placement is not set, so readers see no hint. Ask the author where the hint belongs (document, chapter, item) or set "none" to record the decision.`);
  }
  if (placement && placement !== "none") {
    const unknown = [];
    for (const section of sections) {
      for (const block of section.blocks) {
        if (["text", "video", "embed"].includes(block.kind) && !block.origin) unknown.push(`${section.moduleId}/${block.kind}`);
      }
    }
    if (unknown.length) {
      warnings.push(`${where}: aiDisclosure is on, but ${unknown.length} block(s) have no declared origin (human, ai-generated, ai-modified): ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? ", …" : ""}.`);
    }
  }
  return warnings;
}
