// Chapter numbers and links for number references in prose ("Chapter 3", "Abschnitt 6.2").

/**
 * Assign numbers ("3", "3.1") to section entries in document order, by heading level.
 * Level 1 and 2 count as chapters.
 * @param {{ kind: string, level?: number }[]} entries
 */
export function numberEntries(entries) {
  const counters = [];
  for (const entry of entries) {
    if (entry.kind !== "section") continue;
    const depth = Math.max(0, (entry.level ?? 2) - 2);
    counters.length = depth + 1;
    for (let index = 0; index < depth; index += 1) counters[index] ??= 0;
    counters[depth] = (counters[depth] ?? 0) + 1;
    entry.number = counters.slice(0, depth + 1).map(value => value || 0).join(".");
  }
  return entries;
}

/**
 * Turn "Chapter 3" / "Section 6.2" (per-language templates with `{n}`) into links, outside
 * existing links, code, and headings.
 * @param {string} html
 * @param {Map<string, string>} anchors number → anchor
 * @param {string[]} templates e.g. ["Kapitel {n}", "Abschnitt {n}"]
 * @param {(anchor: string) => string} [href]
 */
export function linkReferences(html, anchors, templates, href = anchor => `#${anchor}`) {
  if (!anchors.size) return html;
  const patterns = templates.filter(Boolean).map(template => {
    const [before, after = ""] = template.split("{n}");
    return new RegExp(`(${escapeRegExp(before)})(\\d+(?:\\.\\d+)*)(${escapeRegExp(after)})(?![\\d.]*\\d)`, "g");
  });
  const blocked = /^(a|code|pre|h[1-6]|script|style|figcaption|button|textarea)$/i;
  const stack = [];
  return html.split(/(<[^>]+>)/).map(part => {
    if (part.startsWith("<")) {
      const tag = /^<\s*(\/)?\s*([a-zA-Z0-9]+)/.exec(part);
      if (tag && blocked.test(tag[2]) && !part.endsWith("/>")) {
        if (tag[1]) {
          const at = stack.lastIndexOf(tag[2].toLowerCase());
          if (at >= 0) stack.length = at;
        } else stack.push(tag[2].toLowerCase());
      }
      return part;
    }
    if (stack.length) return part;
    let text = part;
    for (const pattern of patterns) {
      text = text.replace(pattern, (match, before, number, after) => {
        const anchor = anchors.get(number);
        return anchor ? `<a class="autotour-ref" href="${href(anchor)}">${before}${number}${after}</a>` : match;
      });
    }
    return text;
  }).join("");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
