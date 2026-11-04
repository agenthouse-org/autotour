const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__(?:(?!__).)+__)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;

/**
 * Render a documentation text block as HTML.
 * Author HTML is escaped. Links accept http(s), mailto, and relative URLs.
 * @param {string} source
 */
export function renderMarkdown(source) {
  const lines = String(source).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].trim() === "") {
      index += 1;
      continue;
    }
    if (lines[index].startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }
    if (isTableStart(lines, index)) {
      const table = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
        table.push(lines[index]);
        index += 1;
      }
      blocks.push(renderTable(table));
      continue;
    }
    if (isListItem(lines[index])) {
      const ordered = /^\s*\d+\.\s+/.test(lines[index]);
      const items = [];
      while (index < lines.length && isListItem(lines[index]) && /^\s*\d+\.\s+/.test(lines[index]) === ordered) {
        items.push(lines[index].replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.map(item => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (lines[index].startsWith(">")) {
      const quoted = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quoted.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(renderNote(quoted));
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() !== "" && !startsBlock(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return blocks.join("\n");
}

function startsBlock(lines, index) {
  return lines[index].startsWith("```") ||
    lines[index].startsWith(">") ||
    /^(#{1,6})\s+/.test(lines[index]) ||
    isListItem(lines[index]) ||
    isTableStart(lines, index);
}

function isListItem(line) {
  return /^\s*(?:[-*]|\d+\.)\s+/.test(line);
}

function isTableStart(lines, index) {
  return lines[index].includes("|") && index + 1 < lines.length && isSeparator(lines[index + 1]);
}

function isSeparator(line) {
  const cells = splitRow(line);
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

function renderTable(lines) {
  const header = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow);
  const head = `<thead><tr>${header.map(cell => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderNote(lines) {
  const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(lines[0]?.trim() ?? "");
  const body = alert ? lines.slice(1) : lines;
  const inner = renderMarkdown(body.join("\n"));
  if (!alert) return `<blockquote>${inner}</blockquote>`;
  const kind = alert[1].toLowerCase();
  return `<aside class="autotour-note" data-type="${kind}">${inner}</aside>`;
}

function inline(raw) {
  let html = "";
  let last = 0;
  for (const match of String(raw).matchAll(INLINE)) {
    html += escapeHtml(raw.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) html += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    else if (token.startsWith("**")) html += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
    else if (token.startsWith("__")) html += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
    else if (token.startsWith("*")) html += `<em>${escapeHtml(token.slice(1, -1))}</em>`;
    else html += renderLink(token);
    last = match.index + token.length;
  }
  html += escapeHtml(raw.slice(last));
  return html;
}

function renderLink(token) {
  const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
  if (!link) return escapeHtml(token);
  const href = link[2].trim();
  if (!safeHref(href)) return escapeHtml(link[1]);
  return `<a href="${escapeHtml(href)}">${escapeHtml(link[1])}</a>`;
}

function safeHref(href) {
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) {
    return !/[\s\\]/.test(href);
  }
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
