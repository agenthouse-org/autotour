// Browser script embedded in every generated HTML manual. No network access, no external code.
export const clientScript = String.raw`(() => {
  const config = JSON.parse(document.getElementById("autotour-config").textContent);
  const labels = config.labels;
  const main = document.getElementById("autotour-main");
  const format = (template, values) => String(template).replace(/\{(\w+)\}/g, (m, key) => key in values ? values[key] : m);

  // Search: index every h2/h3 section from the page itself.
  const fold = (text) => {
    const chars = [];
    const map = [];
    for (let index = 0; index < text.length; index += 1) {
      let folded = text[index].normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
      if (folded === "ß") folded = "ss";
      for (const char of folded) { chars.push(char); map.push(index); }
    }
    return { text: chars.join(""), map };
  };
  const headings = [...main.querySelectorAll("h1, h2, h3")].filter(heading => heading.parentElement !== main && !heading.closest(".autotour-ai-content"));
  headings.forEach((heading, index) => {
    const leads = heading.parentElement.id && heading.parentElement.firstElementChild === heading;
    if (!heading.id && !leads) heading.id = "autotour-h-" + (index + 1);
  });
  const anchorOf = (heading) => heading.id || heading.parentElement.id;
  const index = headings.map((heading, position) => {
    const range = document.createRange();
    range.setStartAfter(heading);
    const next = headings[position + 1];
    if (next) range.setEndBefore(next); else range.setEnd(main, main.childNodes.length);
    const fragment = range.cloneContents();
    fragment.querySelectorAll("script, style, iframe, .autotour-ai").forEach(node => node.remove());
    const alts = [...fragment.querySelectorAll("img[alt]")].map(img => img.getAttribute("alt"));
    const title = heading.textContent.replace(/\s+/g, " ").trim();
    const body = [fragment.textContent, ...alts].join(" ").replace(/\s+/g, " ").trim();
    return { anchor: anchorOf(heading), title, body, foldedTitle: fold(title).text, folded: fold(body) };
  });
  const input = document.getElementById("autotour-search-input");
  const results = document.getElementById("autotour-search-results");
  const status = document.getElementById("autotour-search-status");
  const contents = document.querySelectorAll(".autotour-contents");
  const reset = () => {
    results.replaceChildren();
    results.hidden = true;
    status.textContent = "";
    contents.forEach(nav => { nav.hidden = false; });
    document.body.classList.remove("autotour-searching");
  };
  const clear = () => { input.value = ""; reset(); };
  const snippet = (entry, words) => {
    const source = entry.body;
    const folded = entry.folded;
    let first = -1;
    for (const word of words) {
      const at = folded.text.indexOf(word);
      if (at >= 0 && (first < 0 || at < first)) first = at;
    }
    const startOriginal = first < 0 ? 0 : Math.max(0, folded.map[first] - 60);
    const endOriginal = Math.min(source.length, startOriginal + 180);
    const hits = [];
    for (const word of words) {
      let at = folded.text.indexOf(word);
      while (at >= 0) {
        const start = folded.map[at];
        const end = folded.map[at + word.length - 1] + 1;
        if (start >= startOriginal && end <= endOriginal) hits.push([start, end]);
        at = folded.text.indexOf(word, at + word.length);
      }
    }
    hits.sort((a, b) => a[0] - b[0]);
    const span = document.createElement("span");
    span.className = "autotour-search-snippet";
    let cursor = startOriginal;
    if (startOriginal > 0) span.append("…");
    for (const [start, end] of hits) {
      if (start < cursor) continue;
      span.append(source.slice(cursor, start));
      const mark = document.createElement("mark");
      mark.textContent = source.slice(start, end);
      span.append(mark);
      cursor = end;
    }
    span.append(source.slice(cursor, endOriginal));
    if (endOriginal < source.length) span.append("…");
    return span;
  };
  const render = () => {
    const words = fold(input.value).text.split(/\s+/).filter(word => word.length >= 2);
    if (!words.length) { reset(); return; }
    const matches = index.filter(entry => words.every(word => entry.foldedTitle.includes(word) || entry.folded.text.includes(word))).slice(0, 40);
    results.replaceChildren();
    for (const entry of matches) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#" + entry.anchor;
      const title = document.createElement("span");
      title.className = "autotour-search-title";
      title.textContent = entry.title;
      link.append(title, snippet(entry, words));
      link.addEventListener("click", () => { clear(); closeMenu(); });
      item.append(link);
      results.append(item);
    }
    status.textContent = matches.length === 0 ? labels.searchNone : matches.length === 1 ? labels.searchCountOne : format(labels.searchCount, { n: matches.length });
    results.hidden = matches.length === 0;
    contents.forEach(nav => { nav.hidden = true; });
    document.body.classList.add("autotour-searching");
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); clear(); }
    if (event.key === "Enter") {
      event.preventDefault();
      const first = results.querySelector("a");
      if (first) { first.click(); location.hash = first.getAttribute("href"); }
    }
  });
  document.getElementById("autotour-search").addEventListener("submit", event => event.preventDefault());

  // Navigation menu on narrow screens (sidebar) or the contents drop-down (topbar).
  const menuButton = document.getElementById("autotour-menu-button");
  const panel = document.getElementById("autotour-nav-panel");
  const closeMenu = () => {
    if (!menuButton) return;
    menuButton.setAttribute("aria-expanded", "false");
    panel.classList.remove("autotour-open");
  };
  if (menuButton) {
    menuButton.addEventListener("click", () => {
      const open = menuButton.getAttribute("aria-expanded") !== "true";
      menuButton.setAttribute("aria-expanded", String(open));
      panel.classList.toggle("autotour-open", open);
      if (open) input.focus();
    });
    panel.addEventListener("click", (event) => { if (event.target.closest(".autotour-contents a")) closeMenu(); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true" && !input.value) { closeMenu(); menuButton.focus(); }
    });
  }

  // Mark the section being read in the contents list.
  const links = new Map([...document.querySelectorAll(".autotour-contents a[href^='#']")].map(link => [link.getAttribute("href").slice(1), link]));
  const sections = [...main.querySelectorAll("section[id]")].filter(section => links.has(section.id));
  let current;
  const markCurrent = () => {
    let active = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top - 120 <= 0) active = section; else break;
    }
    if (!active || active === current) return;
    current = active;
    links.forEach(link => link.removeAttribute("aria-current"));
    const link = links.get(active.id);
    link.setAttribute("aria-current", "location");
    const box = link.closest(".autotour-contents");
    if (box && box.scrollHeight > box.clientHeight) {
      const top = link.offsetTop - box.offsetTop;
      if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) box.scrollTop = top - box.clientHeight / 3;
    }
  };

  // Back to top: appears after one viewport of scrolling.
  const top = document.getElementById("autotour-top");
  const onScroll = () => {
    top.classList.toggle("autotour-visible", window.scrollY > window.innerHeight);
    markCurrent();
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  // Image dialog.
  const dialog = document.getElementById("autotour-dialog");
  const dialogImage = dialog.querySelector("img");
  const dialogCaption = dialog.querySelector("figcaption");
  let opener;
  const openImage = (image) => {
    opener = image;
    dialogImage.src = image.currentSrc || image.src;
    dialogImage.alt = image.alt;
    const caption = image.closest("figure")?.querySelector("figcaption");
    dialogCaption.textContent = caption ? caption.textContent.trim() : image.alt;
    dialog.showModal();
  };
  dialog.addEventListener("close", () => { dialogImage.removeAttribute("src"); opener?.focus(); });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target === dialogImage || event.target.closest(".autotour-dialog-close")) dialog.close();
  });
  for (const image of main.querySelectorAll("figure.autotour-shot img, figure.autotour-still img")) {
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-haspopup", "dialog");
    image.setAttribute("aria-label", labels.zoom + ": " + image.alt);
    image.addEventListener("click", () => openImage(image));
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openImage(image); }
    });
  }

  // Embedded animations: show the frame once it reports that it runs; keep the still otherwise.
  for (const figure of main.querySelectorAll("figure.autotour-embed")) {
    const frame = figure.querySelector("iframe");
    const expected = JSON.parse(figure.dataset.ready || "{}");
    window.addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
      if (Object.entries(expected).every(([key, value]) => event.data[key] === value)) figure.classList.add("autotour-embed-ready");
    });
  }

  // Language switch keeps the reader's position.
  document.querySelectorAll("a[data-autotour-language]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (!location.hash) return;
      event.preventDefault();
      const url = new URL(link.getAttribute("href"), location.href);
      url.hash = location.hash;
      location.assign(url.href);
    });
  });
})();`;
