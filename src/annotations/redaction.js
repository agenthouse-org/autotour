import { AnnotationErrorCode, createAnnotationError } from "./errors.js";

/**
 * @typedef {{ selectors?: string[], texts?: string[] }} RedactionConfig
 */

/**
 * Normalize redaction configuration. Text values are kept for page evaluation only
 * and must never be copied into diagnostics or thrown error messages.
 *
 * @param {unknown} redaction
 * @returns {{ selectors: string[], texts: string[] }}
 */
export function normalizeRedactionConfig(redaction) {
  if (redaction == null) {
    return { selectors: [], texts: [] };
  }
  if (typeof redaction !== "object") {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      "redaction must be an object with optional selectors and texts arrays."
    );
  }
  const selectors = normalizeStringList(
    /** @type {{ selectors?: unknown }} */ (redaction).selectors,
    "redaction.selectors"
  );
  const texts = normalizeStringList(
    /** @type {{ texts?: unknown }} */ (redaction).texts,
    "redaction.texts"
  );
  return { selectors, texts };
}

/**
 * Apply configured selector and text redaction inside the page before capture.
 * Returns counts only — never the configured secret values.
 *
 * @param {import('playwright').Page} page
 * @param {RedactionConfig} [redaction]
 */
export async function applyRedaction(page, redaction) {
  const config = normalizeRedactionConfig(redaction);
  if (config.selectors.length === 0 && config.texts.length === 0) {
    return { selectorCount: 0, textRuleCount: 0, selectorHits: 0, textHits: 0 };
  }

  try {
    const result = await page.evaluate(
      ({ selectors, texts }) => {
        const restorePrevious = () => {
          const previous = globalThis.__autotourRedactionState;
          if (!previous) return;
          for (const entry of previous.elements) {
            if (entry.style === "") entry.element.removeAttribute("style");
            else entry.element.setAttribute("style", entry.style);
            if (entry.redacted === null) entry.element.removeAttribute("data-autotour-redacted");
            else entry.element.setAttribute("data-autotour-redacted", entry.redacted);
            if (entry.hasValue) entry.element.value = entry.value;
          }
          for (const entry of previous.textNodes) entry.node.nodeValue = entry.value;
          delete globalThis.__autotourRedactionState;
        };
        restorePrevious();

        let selectorHits = 0;
        let textHits = 0;
        const elements = [];
        const textNodes = [];
        const savedElements = new Set();
        const savedTextNodes = new Set();

        const saveElement = (el) => {
          if (savedElements.has(el)) return;
          savedElements.add(el);
          elements.push({
            element: el,
            style: el.getAttribute("style") ?? "",
            redacted: el.getAttribute("data-autotour-redacted"),
            hasValue: "value" in el && typeof el.value === "string",
            value: "value" in el && typeof el.value === "string" ? el.value : undefined
          });
        };
        const saveTextNode = (node) => {
          if (savedTextNodes.has(node)) return;
          savedTextNodes.add(node);
          textNodes.push({ node, value: node.nodeValue });
        };

        const redactElement = (el) => {
          saveElement(el);
          el.setAttribute("data-autotour-redacted", "true");
          if ("value" in el && typeof /** @type {HTMLInputElement} */ (el).value === "string") {
            /** @type {HTMLInputElement} */ (el).value = "████████";
          }
          /** @type {HTMLElement} */ (el).style.background = "#111";
          /** @type {HTMLElement} */ (el).style.color = "transparent";
          /** @type {HTMLElement} */ (el).style.borderColor = "#111";
        };

        for (const selector of selectors) {
          document.querySelectorAll(selector).forEach((el) => {
            redactElement(el);
            selectorHits += 1;
          });
        }

        if (texts.length > 0) {
          const unique = [...new Set(texts.filter((value) => value.length > 0))];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          /** @type {Text[]} */
          const nodes = [];
          let node = walker.nextNode();
          while (node) {
            nodes.push(/** @type {Text} */ (node));
            node = walker.nextNode();
          }
          for (const textNode of nodes) {
            let value = textNode.nodeValue ?? "";
            let changed = false;
            for (const needle of unique) {
              if (needle.length === 0 || !value.includes(needle)) {
                continue;
              }
              value = value.split(needle).join("████████");
              changed = true;
              textHits += 1;
            }
            if (changed) {
              saveTextNode(textNode);
              textNode.nodeValue = value;
            }
          }

          document.querySelectorAll("input, textarea").forEach((el) => {
            const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (el);
            let value = input.value ?? "";
            let changed = false;
            for (const needle of unique) {
              if (needle.length === 0 || !value.includes(needle)) {
                continue;
              }
              value = value.split(needle).join("████████");
              changed = true;
              textHits += 1;
            }
            if (changed) {
              saveElement(input);
              input.value = value;
              input.setAttribute("data-autotour-redacted", "true");
            }
          });
        }

        globalThis.__autotourRedactionState = { elements, textNodes };

        return { selectorHits, textHits };
      },
      { selectors: config.selectors, texts: config.texts }
    );

    return {
      selectorCount: config.selectors.length,
      textRuleCount: config.texts.length,
      selectorHits: result.selectorHits,
      textHits: result.textHits
    };
  } catch (cause) {
    throw createAnnotationError(
      AnnotationErrorCode.REDACTION_FAILED,
      "Configured redaction could not be applied.",
      {
        details: {
          selectorCount: config.selectors.length,
          textRuleCount: config.texts.length
        },
        cause
      }
    );
  }
}

/** Restore the page state saved by the most recent redaction pass. */
export async function restoreRedaction(page) {
  await page.evaluate(() => {
    const state = globalThis.__autotourRedactionState;
    if (!state) return;
    for (const entry of state.elements) {
      if (entry.style === "") entry.element.removeAttribute("style");
      else entry.element.setAttribute("style", entry.style);
      if (entry.redacted === null) entry.element.removeAttribute("data-autotour-redacted");
      else entry.element.setAttribute("data-autotour-redacted", entry.redacted);
      if (entry.hasValue) entry.element.value = entry.value;
    }
    for (const entry of state.textNodes) entry.node.nodeValue = entry.value;
    delete globalThis.__autotourRedactionState;
  });
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string[]}
 */
function normalizeStringList(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw createAnnotationError(
      AnnotationErrorCode.INVALID_INPUT,
      `${label} must be an array of non-empty strings.`
    );
  }
  return [...value];
}
