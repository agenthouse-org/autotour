// Reader-facing words used by generated manuals. A specification or manual can override any key per language.
const builtIn = {
  en: {
    contents: "Contents",
    menu: "Contents",
    search: "Search this manual",
    searchPlaceholder: "Search…",
    searchNone: "No results.",
    searchCountOne: "1 result",
    searchCount: "{n} results",
    zoom: "Enlarge image",
    close: "Close",
    backToTop: "↑ Back to top",
    languages: "Languages",
    draft: "Draft",
    chapterReference: "Chapter {n}",
    sectionReference: "Section {n}",
    pageFooter: "Page {page} of {total}",
    screenshotMissing: "Screenshot not captured yet.",
    step: "Step",
    embedFallback: "Open the animation",
    aiGenerated: "AI-generated",
    aiModified: "AI-modified",
    aiNote: "Parts of this manual were created or edited with AI.",
    aiNoteLink: "Details",
    aiSection: "About AI-generated content",
    aiSectionIntro: "The following content was created or edited with AI:",
    aiText: "Text",
    aiImage: "Image",
    aiAnimation: "Animation"
  },
  de: {
    contents: "Inhalt",
    menu: "Inhalt",
    search: "Handbuch durchsuchen",
    searchPlaceholder: "Suchen …",
    searchNone: "Keine Treffer.",
    searchCountOne: "1 Treffer",
    searchCount: "{n} Treffer",
    zoom: "Bild vergrößern",
    close: "Schließen",
    backToTop: "↑ Nach oben",
    languages: "Sprachen",
    draft: "Entwurf",
    chapterReference: "Kapitel {n}",
    sectionReference: "Abschnitt {n}",
    pageFooter: "Seite {page} von {total}",
    screenshotMissing: "Bildschirmfoto noch nicht aufgenommen.",
    step: "Schritt",
    embedFallback: "Animation öffnen",
    aiGenerated: "KI-generiert",
    aiModified: "KI-bearbeitet",
    aiNote: "Teile dieses Handbuchs wurden mit KI erstellt oder bearbeitet.",
    aiNoteLink: "Details",
    aiSection: "Hinweis zu KI-Inhalten",
    aiSectionIntro: "Folgende Inhalte wurden mit KI erstellt oder bearbeitet:",
    aiText: "Text",
    aiImage: "Bild",
    aiAnimation: "Animation"
  }
};

export const labelKeys = Object.keys(builtIn.en);

/**
 * Resolve labels for a language tag ("de-AT" falls back to "de", unknown languages to English).
 * @param {string} language
 * @param {Record<string, string>} [overrides]
 */
export function resolveLabels(language = "en", overrides = {}) {
  const primary = String(language).toLowerCase().split("-")[0];
  return { ...builtIn.en, ...(builtIn[primary] ?? {}), ...overrides };
}

/** Replace `{name}` placeholders. */
export function format(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}
