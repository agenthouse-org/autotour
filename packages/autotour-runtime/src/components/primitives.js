import { baseStyles, defineOnce, escapeHtml } from './shared.js';

class AhWebtourSpotlight extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._rect = null;
    this._ready = false;
  }

  connectedCallback() {
    this._ensureDom();
    this._applyRect(false);
  }

  set targetRect(rect) {
    const had = !!this._rect;
    this._rect = rect;
    this._ensureDom();
    this._applyRect(had);
  }

  get targetRect() {
    return this._rect;
  }

  _ensureDom() {
    if (this._ready) return;
    this._ready = true;
    this.shadowRoot.innerHTML = `
      <style>
        ${baseStyles()}
        :host {
          position: fixed;
          inset: 0;
          z-index: var(--ah-webtour-z, 10000);
          pointer-events: none;
        }
        .scrim {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          background: color-mix(in srgb, CanvasText var(--ah-webtour-spotlight-opacity, 55%), transparent);
          opacity: 0;
          transition: opacity var(--ah-webtour-motion-duration, 240ms) var(--ah-webtour-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
        }
        .scrim.is-on { opacity: 1; }
        .cutout {
          position: absolute;
          border: 2px solid var(--ah-webtour-signal, var(--ah-signal, LinkText));
          border-radius: var(--ah-webtour-radius-sm, 4px);
          box-shadow:
            0 0 0 1px color-mix(in srgb, var(--ah-webtour-signal, var(--ah-signal, LinkText)) 35%, transparent),
            0 0 0 9999px rgba(0, 0, 0, 0.55);
          box-shadow:
            0 0 0 1px color-mix(in srgb, var(--ah-webtour-signal, var(--ah-signal, LinkText)) 35%, transparent),
            0 0 0 9999px color-mix(in srgb, CanvasText var(--ah-webtour-spotlight-opacity, 55%), transparent);
          opacity: 0;
          pointer-events: none;
          transition:
            left var(--ah-webtour-motion-duration, 240ms) var(--ah-webtour-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)),
            top var(--ah-webtour-motion-duration, 240ms) var(--ah-webtour-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)),
            width var(--ah-webtour-motion-duration, 240ms) var(--ah-webtour-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)),
            height var(--ah-webtour-motion-duration, 240ms) var(--ah-webtour-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)),
            opacity var(--ah-webtour-motion-duration, 240ms) var(--ah-webtour-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
        }
        .cutout.is-on { opacity: 1; }
      </style>
      <div part="spotlight" class="scrim" aria-hidden="true"></div>
      <div part="cutout" class="cutout" aria-hidden="true"></div>
    `;
  }

  _applyRect(animate) {
    const scrim = this.shadowRoot.querySelector('.scrim');
    const cutout = this.shadowRoot.querySelector('.cutout');
    if (!scrim || !cutout) return;
    const r = this._rect;
    const pad = 4;
    if (!animate) {
      cutout.style.transition = 'none';
    }
    if (!r) {
      scrim.classList.add('is-on');
      cutout.classList.remove('is-on');
      return;
    }
    scrim.classList.remove('is-on');
    cutout.style.left = `${Math.round(r.left - pad)}px`;
    cutout.style.top = `${Math.round(r.top - pad)}px`;
    cutout.style.width = `${Math.round(r.width + pad * 2)}px`;
    cutout.style.height = `${Math.round(r.height + pad * 2)}px`;
    cutout.classList.add('is-on');
    if (!animate) {
      // Force layout, then restore transitions for later morphs.
      void cutout.offsetWidth;
      cutout.style.transition = '';
    }
  }
}

class AhWebtourCoachmark extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._model = null;
    this._handlers = {};
    this._ready = false;
    this._userPos = null;
    this._drag = null;
    this._onClick = this._onClick.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  set model(value) {
    const previous = this._model;
    const same =
      previous &&
      value &&
      previous.tourId === value.tourId &&
      previous.stepId === value.stepId &&
      previous.index === value.index;
    if (!same) this._userPos = null;
    this._model = value;
    if (!value) {
      this._ready = false;
      this._drag = null;
      this.shadowRoot.innerHTML = '';
      this.style.removeProperty('left');
      this.style.removeProperty('top');
      return;
    }
    this._ensureDom();
    this._applyModel(!!previous && !same);
  }

  set handlers(value) {
    this._handlers = value || {};
  }

  focusPrimary() {
    const btn =
      this.shadowRoot.querySelector('button.primary') ||
      this.shadowRoot.querySelector('button[data-act="skip"]');
    if (btn) btn.focus();
  }

  _onClick(event) {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'next' && this._handlers.onNext) this._handlers.onNext();
    if (act === 'prev' && this._handlers.onPrev) this._handlers.onPrev();
    if (act === 'skip' && this._handlers.onSkip) this._handlers.onSkip();
    if (act === 'done' && this._handlers.onDone) this._handlers.onDone();
  }

  _onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest('button')) return;
    const rect = this.getBoundingClientRect();
    this._drag = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    };
    this._userPos = { left: rect.left, top: rect.top };
    this.style.transition = 'none';
    const card = this.shadowRoot.querySelector('.card');
    if (card) card.classList.add('is-dragging');
    if (typeof this.setPointerCapture === 'function') this.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  _onPointerMove(event) {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    const w = this.offsetWidth || 320;
    const h = this.offsetHeight || 180;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const left = Math.min(Math.max(12, event.clientX - this._drag.dx), Math.max(12, vw - w - 12));
    const top = Math.min(Math.max(12, event.clientY - this._drag.dy), Math.max(12, vh - h - 12));
    this._userPos = { left, top };
    this.style.left = `${Math.round(left)}px`;
    this.style.top = `${Math.round(top)}px`;
  }

  _onPointerUp(event) {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    this._drag = null;
    const card = this.shadowRoot.querySelector('.card');
    if (card) card.classList.remove('is-dragging');
    if (typeof this.releasePointerCapture === 'function' && this.hasPointerCapture?.(event.pointerId)) {
      this.releasePointerCapture(event.pointerId);
    }
  }

  _ensureDom() {
    if (this._ready) return;
    this._ready = true;
    this.shadowRoot.innerHTML = `
      <style>
        ${baseStyles()}
        :host {
          position: fixed;
          z-index: calc(var(--ah-webtour-z, 10000) + 2);
          width: min(320px, calc(100vw - 24px));
          transition:
            left var(--ah-webtour-motion-duration, 240ms) var(--ah-webtour-motion-ease, cubic-bezier(0.22, 1, 0.36, 1)),
            top var(--ah-webtour-motion-duration, 240ms) var(--ah-webtour-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
        }
        .card {
          background-color: #ffffff;
          background-color: var(--ah-webtour-surface, Canvas);
          color: var(--ah-webtour-fg, CanvasText);
          border: 1px solid var(--ah-webtour-border, #d4d4d8);
          border-radius: var(--ah-webtour-radius-md, 8px);
          padding: var(--ah-webtour-space-4, 16px);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
          cursor: grab;
          touch-action: none;
          transition: opacity var(--ah-webtour-motion-duration, 240ms) var(--ah-webtour-motion-ease, cubic-bezier(0.22, 1, 0.36, 1));
        }
        .card.is-dragging {
          cursor: grabbing;
        }
        .card.is-swap {
          opacity: 0.55;
        }
        .progress {
          font-family: var(--ah-webtour-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
          font-size: 11px;
          color: var(--ah-webtour-muted, var(--ah-muted, GrayText));
          margin-bottom: var(--ah-webtour-space-2, 8px);
        }
        h2 {
          margin: 0 0 var(--ah-webtour-space-2, 8px);
          font-size: 14px;
          font-weight: 600;
        }
        .body {
          margin: 0 0 var(--ah-webtour-space-4, 16px);
          font-size: 13px;
          color: var(--ah-webtour-fg, var(--ah-fg, CanvasText));
        }
        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: var(--ah-webtour-space-4, 16px);
          justify-content: flex-end;
          align-items: center;
        }
        .actions button[data-act="skip"] {
          margin-right: auto;
        }
        .card button {
          cursor: pointer;
          touch-action: auto;
        }
        [aria-live] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      </style>
      <div part="coachmark" class="card" role="dialog" aria-modal="true" aria-labelledby="wt-title">
        <div class="live" aria-live="polite"></div>
        <div part="progress" class="progress" hidden></div>
        <h2 part="title" id="wt-title"></h2>
        <div part="body" class="body"></div>
        <div part="actions" class="actions"></div>
      </div>
    `;
    const card = this.shadowRoot.querySelector('.card');
    this.shadowRoot.querySelector('.actions').addEventListener('click', this._onClick);
    card.addEventListener('pointerdown', this._onPointerDown);
    this.addEventListener('pointermove', this._onPointerMove);
    this.addEventListener('pointerup', this._onPointerUp);
    this.addEventListener('pointercancel', this._onPointerUp);
  }

  _applyModel(animate) {
    const m = this._model;
    const left = this._userPos?.left ?? m.placement?.left ?? 24;
    const top = this._userPos?.top ?? m.placement?.top ?? 24;
    const card = this.shadowRoot.querySelector('.card');
    if (!animate) {
      this.style.transition = 'none';
    }
    this.style.left = `${Math.round(left)}px`;
    this.style.top = `${Math.round(top)}px`;
    if (!animate) {
      void this.offsetWidth;
      this.style.transition = '';
    }
    if (card) {
      card.setAttribute('aria-modal', m.awaitingAdvance ? 'false' : 'true');
    }

    if (animate && card) {
      card.classList.add('is-swap');
      requestAnimationFrame(() => {
        this._fillContent(m);
        requestAnimationFrame(() => card.classList.remove('is-swap'));
      });
    } else {
      this._fillContent(m);
    }
    if (!m.awaitingAdvance) {
      queueMicrotask(() => this.focusPrimary());
    }
  }

  _fillContent(m) {
    const live = this.shadowRoot.querySelector('.live');
    const progress = this.shadowRoot.querySelector('.progress');
    const title = this.shadowRoot.querySelector('h2');
    const body = this.shadowRoot.querySelector('.body');
    const actions = this.shadowRoot.querySelector('.actions');
    if (!live || !progress || !title || !body || !actions) return;

    live.textContent = m.title || '';
    if (m.showProgress) {
      progress.hidden = false;
      progress.textContent = m.progressText || '';
    } else {
      progress.hidden = true;
      progress.textContent = '';
    }
    title.textContent = m.title || '';
    if (m.html) {
      body.innerHTML = m.html;
    } else {
      body.textContent = m.body || '';
    }

    const labels = m.labels || {};
    const bits = [
      `<button part="skip" type="button" class="quiet" data-act="skip">${escapeHtml(labels.skip)}</button>`,
    ];
    if (!m.isFirst) {
      bits.push(`<button part="prev" type="button" data-act="prev">${escapeHtml(labels.prev)}</button>`);
    }
    if (!m.awaitingAdvance) {
      bits.push(
        m.isLast
          ? `<button part="done" type="button" class="primary" data-act="done">${escapeHtml(labels.done)}</button>`
          : `<button part="next" type="button" class="primary" data-act="next">${escapeHtml(labels.next)}</button>`
      );
    }
    actions.innerHTML = bits.join('');
  }
}

class AhWebtourHelp extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._items = [];
    this._labels = {};
    this._onStart = null;
  }

  set items(value) {
    this._items = Array.isArray(value) ? value : [];
    this.render();
  }

  set labels(value) {
    this._labels = value || {};
    this.render();
  }

  set onStart(fn) {
    this._onStart = fn;
  }

  render() {
    const labels = this._labels;
    const groups = {
      new: [],
      available: [],
      completed: [],
      snoozed: [],
    };
    for (const item of this._items) {
      if (item.status === 'never') continue;
      if (item.status === 'completed') groups.completed.push(item);
      else if (item.status === 'snoozed') groups.snoozed.push(item);
      else if (item.isNew) groups.new.push(item);
      else groups.available.push(item);
    }
    const section = (key, title, list) => {
      if (!list.length) return '';
      return `
        <section>
          <h3>${escapeHtml(title)}</h3>
          <ul>
            ${list
              .map(
                (item) => `
              <li part="help-item">
                <div>
                  <strong>${escapeHtml(item.title)}</strong>
                  ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
                </div>
                <button type="button" class="primary" data-tour="${escapeHtml(item.id)}">${escapeHtml(labels.start || 'Start')}</button>
              </li>`
              )
              .join('')}
          </ul>
        </section>`;
    };
    const empty = !this._items.filter((i) => i.status !== 'never').length;
    this.shadowRoot.innerHTML = `
      <style>
        ${baseStyles()}
        :host { display: block; }
        .panel {
          border: 1px solid var(--ah-webtour-border, #d4d4d8);
          border-radius: var(--ah-webtour-radius-md, 8px);
          background-color: #ffffff;
          background-color: var(--ah-webtour-surface, Canvas);
          color: var(--ah-webtour-fg, CanvasText);
          padding: var(--ah-webtour-space-4, 16px);
        }
        h2 { margin: 0 0 var(--ah-webtour-space-3, 12px); font-size: 18px; font-weight: 600; }
        h3 { margin: var(--ah-webtour-space-4, 16px) 0 var(--ah-webtour-space-2, 8px); font-size: 12px; font-weight: 500; color: var(--ah-webtour-muted, var(--ah-muted, GrayText)); text-transform: uppercase; letter-spacing: 0.04em; }
        ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ah-webtour-space-2, 8px); }
        li { display: flex; gap: var(--ah-webtour-space-3, 12px); align-items: center; justify-content: space-between; border: 1px solid var(--ah-webtour-border, var(--border, color-mix(in srgb, CanvasText 18%, transparent))); border-radius: var(--ah-webtour-radius-sm, 4px); padding: var(--ah-webtour-space-3, 12px); }
        p { margin: var(--ah-webtour-space-1, 4px) 0 0; color: var(--ah-webtour-muted, var(--ah-muted, GrayText)); font-size: 13px; }
        .empty { color: var(--ah-webtour-muted); }
      </style>
      <div part="help" class="panel">
        <h2>${escapeHtml(labels.helpTitle || 'Product tours')}</h2>
        ${empty ? `<p class="empty">${escapeHtml(labels.helpEmpty || '')}</p>` : ''}
        ${section('new', labels.helpNew || 'New', groups.new)}
        ${section('available', labels.helpAvailable || 'Available', groups.available)}
        ${section('snoozed', labels.helpSnoozed || 'Remind later', groups.snoozed)}
        ${section('completed', labels.helpCompleted || 'Completed', groups.completed)}
      </div>
    `;
    this.shadowRoot.querySelectorAll('button[data-tour]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this._onStart) this._onStart(btn.getAttribute('data-tour'));
      });
    });
  }
}

class AhWebtourOffer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._tour = null;
    this._labels = {};
    this._handlers = {};
  }

  set tour(value) {
    this._tour = value;
    this.render();
  }

  set labels(value) {
    this._labels = value || {};
    this.render();
  }

  set handlers(value) {
    this._handlers = value || {};
  }

  render() {
    const tour = this._tour;
    const labels = this._labels;
    if (!tour) {
      this.hidden = true;
      this.shadowRoot.innerHTML = '';
      return;
    }
    this.hidden = false;
    this.shadowRoot.innerHTML = `
      <style>
        ${baseStyles()}
        :host {
          position: fixed;
          right: var(--ah-webtour-space-4, 16px);
          bottom: var(--ah-webtour-space-4, 16px);
          z-index: calc(var(--ah-webtour-z, 10000) + 3);
          width: min(360px, calc(100vw - 32px));
        }
        .card {
          background-color: #ffffff;
          background-color: var(--ah-webtour-surface, Canvas);
          color: var(--ah-webtour-fg, CanvasText);
          border: 1px solid var(--ah-webtour-border, #d4d4d8);
          border-radius: var(--ah-webtour-radius-md, 8px);
          padding: var(--ah-webtour-space-4, 16px);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
        }
        h2 { margin: 0 0 var(--ah-webtour-space-2, 8px); font-size: 14px; font-weight: 600; }
        p { margin: 0 0 var(--ah-webtour-space-4, 16px); color: var(--ah-webtour-muted, var(--ah-muted, GrayText)); font-size: 13px; }
        .actions { display: flex; flex-wrap: wrap; gap: var(--ah-webtour-space-4, 16px); justify-content: flex-end; align-items: center; }
        .actions button[data-act="never"] { margin-right: auto; }
      </style>
      <div part="offer" class="card" role="status">
        <h2>${escapeHtml(labels.offerTitle || 'New tour available')}</h2>
        <p>${escapeHtml(tour.title || labels.offerBody || '')}</p>
        <div class="actions">
          <button part="never" type="button" class="quiet" data-act="never">${escapeHtml(labels.never)}</button>
          <button part="remind" type="button" data-act="remind">${escapeHtml(labels.remind)}</button>
          <button part="next" type="button" class="primary" data-act="start">${escapeHtml(labels.start)}</button>
        </div>
      </div>
    `;
    this.shadowRoot.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-act');
        if (act === 'start' && this._handlers.onStart) this._handlers.onStart(tour.id);
        if (act === 'remind' && this._handlers.onRemind) this._handlers.onRemind(tour.id, tour.version);
        if (act === 'never' && this._handlers.onNever) this._handlers.onNever(tour.id, tour.version);
      });
    });
  }
}

defineOnce('ah-webtour-spotlight', AhWebtourSpotlight);
defineOnce('ah-webtour-coachmark', AhWebtourCoachmark);
defineOnce('ah-webtour-help', AhWebtourHelp);
defineOnce('ah-webtour-offer', AhWebtourOffer);

export { AhWebtourSpotlight, AhWebtourCoachmark, AhWebtourHelp, AhWebtourOffer };
