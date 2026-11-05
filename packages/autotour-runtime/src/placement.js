const GAP = 12;

export function isUsableRect(rect) {
  return !!rect && Number(rect.width) >= 1 && Number(rect.height) >= 1;
}

export function isVisibleTarget(el) {
  if (!el) return false;
  if (typeof el.isConnected === 'boolean' && !el.isConnected) return false;
  return isUsableRect(el.getBoundingClientRect());
}

export function resolveTarget(target) {
  if (!target) return null;
  if (typeof target === 'string') {
    return typeof document !== 'undefined' ? document.querySelector(target) : null;
  }
  if (typeof target === 'object' && target.selector) {
    return typeof document !== 'undefined' ? document.querySelector(target.selector) : null;
  }
  return null;
}

export function resolveWaitTimeout(explicit, fallback = 2000) {
  if (explicit === undefined || explicit === null || explicit === '') {
    const n = Number(fallback);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n;
  }
  const n = Number(explicit);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export function resolveAdvanceWhen(step) {
  const raw = step && step.advanceWhen;
  if (!raw) return null;
  if (typeof raw === 'string' && raw.trim()) {
    return { selector: raw.trim(), timeout: 0 };
  }
  if (typeof raw === 'object' && raw.selector) {
    return {
      selector: String(raw.selector),
      timeout: resolveWaitTimeout(raw.timeout, 0),
    };
  }
  return null;
}

export function waitForTarget(step, timeoutMs = 2000, options = {}) {
  const selector =
    typeof step.target === 'string'
      ? step.target
      : step.target && (step.target.wait || step.target.selector);
  const timeout = resolveWaitTimeout(
    step.target && typeof step.target === 'object' ? step.target.timeout : undefined,
    timeoutMs
  );
  const signal = options && options.signal;
  return new Promise((resolve) => {
    if (!selector) {
      resolve(null);
      return;
    }
    if (signal && signal.aborted) {
      resolve(null);
      return;
    }
    const existing = typeof document !== 'undefined' ? document.querySelector(selector) : null;
    if (isVisibleTarget(existing)) {
      resolve(existing);
      return;
    }
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const started = Date.now();
    let timer = null;
    const finish = (el) => {
      if (timer) clearInterval(timer);
      timer = null;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(el);
    };
    const onAbort = () => finish(null);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setInterval(() => {
      const el = document.querySelector(selector);
      if (isVisibleTarget(el)) {
        finish(el);
        return;
      }
      if (timeout > 0 && Date.now() - started >= timeout) {
        finish(isVisibleTarget(el) ? el : null);
      }
    }, 50);
  });
}

export function placeNear(anchorRect, popoverSize, preferred = 'auto', viewport = null) {
  const vw = viewport?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const vh = viewport?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 768);
  const w = popoverSize.width || 320;
  const h = popoverSize.height || 180;
  const placements = preferred === 'auto'
    ? ['bottom', 'top', 'right', 'left']
    : [preferred, 'bottom', 'top', 'right', 'left'];

  if (!isUsableRect(anchorRect)) {
    return {
      placement: 'orphan',
      left: Math.max(GAP, (vw - w) / 2),
      top: Math.max(GAP, (vh - h) / 2),
    };
  }

  for (const placement of placements) {
    let left = anchorRect.left;
    let top = anchorRect.top;
    if (placement === 'bottom') {
      left = anchorRect.left + (anchorRect.width - w) / 2;
      top = anchorRect.bottom + GAP;
    } else if (placement === 'top') {
      left = anchorRect.left + (anchorRect.width - w) / 2;
      top = anchorRect.top - h - GAP;
    } else if (placement === 'right') {
      left = anchorRect.right + GAP;
      top = anchorRect.top + (anchorRect.height - h) / 2;
    } else if (placement === 'left') {
      left = anchorRect.left - w - GAP;
      top = anchorRect.top + (anchorRect.height - h) / 2;
    }
    left = Math.min(Math.max(GAP, left), vw - w - GAP);
    top = Math.min(Math.max(GAP, top), vh - h - GAP);
    const fits =
      (placement === 'bottom' && anchorRect.bottom + GAP + h <= vh - GAP) ||
      (placement === 'top' && anchorRect.top - GAP - h >= GAP) ||
      (placement === 'right' && anchorRect.right + GAP + w <= vw - GAP) ||
      (placement === 'left' && anchorRect.left - GAP - w >= GAP) ||
      preferred !== 'auto';
    if (fits || preferred !== 'auto') {
      return { placement, left, top };
    }
  }
  return {
    placement: 'bottom',
    left: Math.min(Math.max(GAP, anchorRect.left), vw - w - GAP),
    top: Math.min(Math.max(GAP, anchorRect.bottom + GAP), vh - h - GAP),
  };
}

export function placeDocked(popoverSize, viewport = null) {
  const vw = viewport?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const vh = viewport?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 768);
  const w = popoverSize.width || 320;
  const h = popoverSize.height || 180;
  return {
    placement: 'dock',
    left: Math.max(GAP, vw - w - GAP),
    top: Math.max(GAP, vh - h - GAP),
  };
}
