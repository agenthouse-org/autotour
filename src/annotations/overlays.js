const OVERLAY_ROOT_ID = "autotour-annotation-root";

/**
 * Inject deterministic DOM overlays for highlight, numbered callout, and caption.
 *
 * @param {import('playwright').Page} page
 * @param {{
 *   targetBox: { x: number, y: number, width: number, height: number },
 *   calloutBox: { x: number, y: number, width: number, height: number },
 *   captionBox: { x: number, y: number, width: number, height: number, lines: string[], fontSize: number, padding: number },
 *   callout: number
 * }} overlay
 */
export async function injectAnnotationOverlays(page, overlay) {
  await page.evaluate(
    ({ rootId, targetBox, calloutBox, captionBox, callout }) => {
      const existing = document.getElementById(rootId);
      if (existing) {
        existing.remove();
      }

      const root = document.createElement("div");
      root.id = rootId;
      root.setAttribute("data-autotour-annotation", "true");
      root.style.cssText =
        "position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:Arial,Helvetica,sans-serif;";

      const highlight = document.createElement("div");
      highlight.setAttribute("data-autotour-highlight", "true");
      highlight.style.cssText = [
        "position:absolute",
        `left:${targetBox.x}px`,
        `top:${targetBox.y}px`,
        `width:${targetBox.width}px`,
        `height:${targetBox.height}px`,
        "box-sizing:border-box",
        "border:3px solid #0b57d0",
        "border-radius:6px",
        "box-shadow:0 0 0 2px rgba(255,255,255,0.9)"
      ].join(";");

      const badge = document.createElement("div");
      badge.setAttribute("data-autotour-callout", String(callout));
      badge.textContent = String(callout);
      badge.style.cssText = [
        "position:absolute",
        `left:${calloutBox.x}px`,
        `top:${calloutBox.y}px`,
        `width:${calloutBox.width}px`,
        `height:${calloutBox.height}px`,
        "box-sizing:border-box",
        "border-radius:999px",
        "background:#0b57d0",
        "color:#fff",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "font-weight:700",
        "font-size:14px",
        "line-height:1",
        "border:2px solid #fff"
      ].join(";");

      const caption = document.createElement("div");
      caption.setAttribute("data-autotour-caption", "true");
      caption.textContent = captionBox.lines.join("\n");
      caption.style.cssText = [
        "position:absolute",
        `left:${captionBox.x}px`,
        `top:${captionBox.y}px`,
        `width:${captionBox.width}px`,
        `height:${captionBox.height}px`,
        "box-sizing:border-box",
        "background:rgba(17,17,17,0.92)",
        "color:#fff",
        `font-size:${captionBox.fontSize}px`,
        "line-height:1.35",
        `padding:${captionBox.padding}px`,
        "border-radius:8px",
        "white-space:pre-wrap",
        "overflow:hidden"
      ].join(";");

      root.append(highlight, badge, caption);
      document.documentElement.appendChild(root);
    },
    {
      rootId: OVERLAY_ROOT_ID,
      targetBox: overlay.targetBox,
      calloutBox: overlay.calloutBox,
      captionBox: {
        x: overlay.captionBox.x,
        y: overlay.captionBox.y,
        width: overlay.captionBox.width,
        height: overlay.captionBox.height,
        lines: overlay.captionBox.lines,
        fontSize: overlay.captionBox.fontSize,
        padding: overlay.captionBox.padding
      },
      callout: overlay.callout
    }
  );
}

/**
 * Remove previously injected annotation overlays.
 *
 * @param {import('playwright').Page} page
 */
export async function removeAnnotationOverlays(page) {
  await page.evaluate((rootId) => {
    document.getElementById(rootId)?.remove();
  }, OVERLAY_ROOT_ID);
}

export { OVERLAY_ROOT_ID };
