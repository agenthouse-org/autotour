import { readFile } from "node:fs/promises";
import { mimeType } from "../blocks.js";

/**
 * Create an image encoder for single-file HTML. With `format: "webp"` raster images are re-encoded in
 * Chromium (already required for capture), and the original is kept when WebP is not smaller.
 * @param {{ format?: "original"|"webp", quality?: number }} [options]
 */
export function createImageEncoder(options = {}) {
  const format = options.format ?? "original";
  if (format !== "webp") return { encode: undefined, close: async () => {} };
  const quality = Math.min(100, Math.max(1, options.quality ?? 82)) / 100;
  const cache = new Map();
  let browserPromise;
  let pagePromise;
  const page = () => {
    pagePromise ??= (async () => {
      const { chromium } = await import("playwright");
      browserPromise = chromium.launch({ headless: true });
      const browser = await browserPromise;
      return browser.newPage();
    })();
    return pagePromise;
  };
  const encode = async (file) => {
    if (cache.has(file)) return cache.get(file);
    const result = (async () => {
      const data = await readFile(file);
      const mime = mimeType(file);
      if (!["image/png", "image/jpeg"].includes(mime)) return { data, mime };
      const webp = await (await page()).evaluate(async ({ source, quality: q }) => {
        const image = new Image();
        image.src = source;
        try { await image.decode(); } catch { return null; }
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const url = canvas.toDataURL("image/webp", q);
        return url.startsWith("data:image/webp") ? url.slice(url.indexOf(",") + 1) : null;
      }, { source: `data:${mime};base64,${data.toString("base64")}`, quality });
      if (!webp) return { data, mime };
      const encoded = Buffer.from(webp, "base64");
      return encoded.length < data.length ? { data: encoded, mime: "image/webp" } : { data, mime };
    })();
    cache.set(file, result);
    return result;
  };
  return {
    encode,
    async close() {
      if (browserPromise) await (await browserPromise).close();
    }
  };
}
