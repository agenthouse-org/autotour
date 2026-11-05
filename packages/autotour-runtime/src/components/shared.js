const HOST_STYLE = `
:host {
  color: var(--ah-webtour-fg, var(--ah-fg, CanvasText));
  font-family: var(--ah-webtour-font-sans, var(--ah-font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif));
  font-size: 14px;
  line-height: 1.45;
  box-sizing: border-box;
}
:host([theme="dark"]) { color-scheme: dark; }
:host([theme="light"]) { color-scheme: light; }
*, *::before, *::after { box-sizing: border-box; }
:host {
  --ah-webtour-motion-duration: var(--ah-webtour-motion, 240ms);
  --ah-webtour-motion-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
@media (prefers-reduced-motion: reduce) {
  :host {
    --ah-webtour-motion: 0ms;
    --ah-webtour-motion-duration: 0ms;
  }
}
button {
  font: inherit;
  cursor: pointer;
  border-radius: var(--ah-webtour-radius-sm, 4px);
  border: 1px solid var(--ah-webtour-border, var(--border, color-mix(in srgb, CanvasText 18%, transparent)));
  background: var(--ah-webtour-surface, var(--ah-surface, Canvas));
  color: var(--ah-webtour-fg, var(--ah-fg, CanvasText));
  min-height: 32px;
  min-width: 32px;
  padding: 0 var(--ah-webtour-space-3, 12px);
}
button.primary {
  background: var(--ah-webtour-signal, var(--ah-signal, LinkText));
  color: var(--ah-webtour-bg, var(--ah-bg, Canvas));
  border-color: transparent;
}
button.quiet {
  background: transparent;
  border-color: transparent;
  color: var(--ah-webtour-muted, var(--ah-muted, GrayText));
}
button:focus-visible {
  outline: 2px solid var(--ah-webtour-signal, var(--ah-signal, LinkText));
  outline-offset: 2px;
}
`;

export function baseStyles() {
  return HOST_STYLE;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function defineOnce(name, ctor) {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(name)) customElements.define(name, ctor);
}

export function syncObservedAttribute(el, name, nextValue) {
  if (!el || typeof el.getAttribute !== 'function') return false;
  const next = nextValue == null || nextValue === '' ? null : String(nextValue);
  const current = el.getAttribute(name);
  if (next === null) {
    if (current === null) return false;
    el.removeAttribute(name);
    return true;
  }
  if (current === next) return false;
  el.setAttribute(name, next);
  return true;
}
