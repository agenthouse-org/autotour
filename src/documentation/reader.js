const readerStyle = [
  ".autotour-contents > ol,.autotour-contents ol ol{margin:0.25rem 0;padding-left:1.25rem}",
  ".autotour-search{margin:0.5rem 0 1rem}",
  ".autotour-search label{display:block;font-weight:600;margin-bottom:0.25rem}",
  ".autotour-search input[type=search]{font:inherit;width:min(100%,32rem);padding:0.4rem 0.6rem}",
  ".autotour-search-status{margin:0.35rem 0}",
  ".autotour-search-group{margin:0.75rem 0}",
  ".autotour-search-group-label{font-weight:600;margin:0 0 0.25rem}",
  ".autotour-search-results,.autotour-search-group ul{list-style:none;margin:0;padding:0}",
  ".autotour-search-results a{display:block;padding:0.35rem 0.2rem;color:inherit;text-decoration:underline}",
  ".autotour-search-path{display:block;font-weight:600}",
  ".autotour-search-results a[aria-selected=true]{outline:2px solid currentColor;outline-offset:2px}",
  "@media print{.autotour-search{display:none}}"
].join("");

const searchScript = `(() => {
  const form = document.getElementById("autotour-search");
  const input = document.getElementById("autotour-search-input");
  const results = document.getElementById("autotour-search-results");
  const status = document.getElementById("autotour-search-status");
  const index = JSON.parse(document.getElementById("autotour-search-index").textContent);
  let active = -1;
  const options = () => [...results.querySelectorAll("[role=option]")];
  const clearResults = () => {
    results.replaceChildren();
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const select = (next) => {
    const items = options();
    if (!items.length) return;
    active = (next + items.length) % items.length;
    items.forEach((item, index) => item.setAttribute("aria-selected", index === active ? "true" : "false"));
    input.setAttribute("aria-activedescendant", items[active].id);
    items[active].scrollIntoView({ block: "nearest" });
  };
  const snippet = (parent, text, query) => {
    const source = text || "";
    const at = source.toLowerCase().indexOf(query.toLowerCase());
    const span = document.createElement("span");
    span.className = "autotour-search-snippet";
    if (at < 0) {
      span.textContent = source.slice(0, 120);
    } else {
      const start = Math.max(0, at - 40);
      const end = Math.min(source.length, at + query.length + 40);
      const mark = document.createElement("mark");
      mark.textContent = source.slice(at, at + query.length);
      span.append(start ? "…" : "", source.slice(start, at), mark, source.slice(at + query.length, end), end < source.length ? "…" : "");
    }
    parent.append(span);
  };
  const render = (query) => {
    const q = query.trim().toLowerCase();
    clearResults();
    if (!q) {
      status.textContent = "";
      return;
    }
    const matches = index.filter(item => item.heading.toLowerCase().includes(q) || item.text.toLowerCase().includes(q));
    status.textContent = matches.length === 1 ? "1 chapter" : matches.length ? matches.length + " chapters" : "No matching chapters.";
    if (!matches.length) return;
    const groups = [];
    for (const item of matches) {
      let group = groups.find(candidate => candidate.id === item.groupId);
      if (!group) {
        group = { id: item.groupId, label: item.groupLabel, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    for (const group of groups) {
      const block = document.createElement("li");
      block.className = "autotour-search-group";
      const label = document.createElement("p");
      label.className = "autotour-search-group-label";
      label.id = "autotour-search-group-" + group.id;
      label.textContent = group.label;
      const list = document.createElement("ul");
      list.setAttribute("aria-labelledby", label.id);
      for (const item of group.items) {
        const entry = document.createElement("li");
        const link = document.createElement("a");
        link.id = "autotour-search-hit-" + item.id;
        link.href = "#" + item.id;
        link.setAttribute("role", "option");
        const path = document.createElement("span");
        path.className = "autotour-search-path";
        path.textContent = item.path.join(" / ");
        link.append(path);
        snippet(link, item.text.toLowerCase().includes(q) ? item.text : item.heading, query.trim());
        entry.append(link);
        list.append(entry);
      }
      block.append(label, list);
      results.append(block);
    }
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  form.addEventListener("submit", (event) => event.preventDefault());
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      select(active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      select(active < 0 ? options().length - 1 : active - 1);
    } else if (event.key === "Escape") {
      input.value = "";
      status.textContent = "";
      clearResults();
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      options()[active].click();
    }
  });
})();`;

export function readerChrome(sections) {
  return {
    style: readerStyle,
    header: `<form id="autotour-search" class="autotour-search" role="search" action="#autotour-search"><label for="autotour-search-input">Search this manual</label><input id="autotour-search-input" type="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="autotour-search-results"><p id="autotour-search-status" class="autotour-search-status" role="status"></p><ul id="autotour-search-results" class="autotour-search-results" role="listbox" aria-label="Search results" hidden></ul></form><nav class="autotour-contents" aria-label="Contents">${buildContentsHtml(sections)}</nav>`,
    script: `<script type="application/json" id="autotour-search-index">${safeJson(buildSearchIndex(sections))}</script><script>${searchScript}</script>`
  };
}

export function buildContentsHtml(sections) {
  return renderNodes(contentsTree(sections));
}

export function buildSearchIndex(sections) {
  const index = [];
  const walk = (nodes, ancestors) => {
    for (const node of nodes) {
      const path = [...ancestors, node.section];
      index.push({
        id: node.section.moduleId,
        heading: node.section.heading,
        path: path.map(section => section.heading),
        groupId: path[0].moduleId,
        groupLabel: path[0].heading,
        text: plainText(node.section)
      });
      walk(node.children, path);
    }
  };
  walk(contentsTree(sections), []);
  return index;
}

function contentsTree(sections) {
  const root = [];
  const stack = [{ level: 0, children: root }];
  for (const section of sections) {
    const level = Number.isInteger(section.headingLevel) ? section.headingLevel : 2;
    const node = { section, level, children: [] };
    while (stack.length > 1 && stack.at(-1).level >= level) stack.pop();
    stack.at(-1).children.push(node);
    stack.push(node);
  }
  return root;
}

function renderNodes(nodes) {
  if (!nodes.length) return "";
  return `<ol>${nodes.map(node => `<li><a href="#${escapeHtml(node.section.moduleId)}">${escapeHtml(node.section.heading)}</a>${renderNodes(node.children)}</li>`).join("")}</ol>`;
}

function plainText(section) {
  const parts = [];
  for (const block of section.blocks ?? []) {
    if (block.kind === "text") parts.push(block.text);
    if (block.kind === "screenshot") parts.push(block.alt, block.caption);
    if (block.kind === "tour") parts.push(block.label);
    if (block.kind === "video") parts.push(block.label, block.caption);
  }
  return parts.filter(Boolean).join("\n");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
