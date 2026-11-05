import { TourCatalog } from '../catalog.js';
import { PreferenceStore } from '../preferences.js';
import { mergeSettings } from '../settings.js';
import { TourRunner } from '../runner.js';
import { emit, EVENTS } from '../events.js';
import { chromeStrings } from '../i18n/chrome.js';
import { localizeTour } from '../validate.js';
import { defineOnce, syncObservedAttribute } from './shared.js';
import './primitives.js';

class AhWebtour extends HTMLElement {
  static get observedAttributes() {
    return ['product-id', 'locale', 'catalog-url', 'theme', 'user-key', 'auto-offer'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.catalog = new TourCatalog();
    this._settings = mergeSettings();
    this._syncingAttrs = false;
    this.preferences = new PreferenceStore(this._settings);
    this.runner = null;
    this._themeSheets = [];
    this._offerTourId = null;
    this._unsubscribe = null;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .layer { display: contents; }
      </style>
      <div class="layer" part="root">
        <ah-webtour-spotlight hidden></ah-webtour-spotlight>
        <ah-webtour-coachmark hidden></ah-webtour-coachmark>
        <ah-webtour-offer hidden></ah-webtour-offer>
        <slot name="help"></slot>
        <slot></slot>
      </div>
    `;
  }

  get spotlight() {
    return this.shadowRoot.querySelector('ah-webtour-spotlight');
  }

  get coachmark() {
    return this.shadowRoot.querySelector('ah-webtour-coachmark');
  }

  get offer() {
    return this.shadowRoot.querySelector('ah-webtour-offer');
  }

  connectedCallback() {
    this._syncFromAttributes();
    this.runner = new TourRunner({
      host: this,
      catalog: this.catalog,
      preferences: this.preferences,
      settings: this._settings,
      ui: {
        renderStep: (model, handlers) => this._renderStep(model, handlers),
        clearStep: () => this._clearStep(),
      },
    });
    this._unsubscribe = this.catalog.onChange(() => {
      emit(this, EVENTS.catalogChange, { tours: this.catalog.list() });
      this.refreshHelp();
      this.maybeAutoOffer();
    });
    [
      EVENTS.complete,
      EVENTS.remind,
      EVENTS.never,
      EVENTS.end,
    ].forEach((type) => {
      this.addEventListener(type, () => this.refreshHelp());
    });
    this.offer.handlers = {
      onStart: (id) => {
        this._hideOffer();
        this.start(id);
      },
      onRemind: (id, version) => {
        this.runner.remind(id, version);
        this._hideOffer();
        this.refreshHelp();
      },
      onNever: (id, version) => {
        this.runner.never(id, version);
        this._hideOffer();
        this.refreshHelp();
      },
    };
    const catalogUrl = this.getAttribute('catalog-url');
    if (catalogUrl) {
      this.ingest(catalogUrl).catch((err) => {
        emit(this, EVENTS.error, { message: String(err && err.message ? err.message : err) });
      });
    }
    emit(this, EVENTS.ready, { productId: this._settings.productId });
    this.refreshHelp();
  }

  disconnectedCallback() {
    if (this._unsubscribe) this._unsubscribe();
    if (this.runner) this.runner.end(false);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.isConnected || oldValue === newValue || this._syncingAttrs) return;
    this._syncFromAttributes();
    if (this.runner) this.runner.updateSettings(this._settings);
    this.refreshHelp();
  }

  _syncFromAttributes() {
    if (this._syncingAttrs) return;
    this._syncingAttrs = true;
    try {
      this._settings = mergeSettings(this._settings, {
        productId: this.getAttribute('product-id') || 'default',
        locale: this.getAttribute('locale') || 'en',
        userKey: this.getAttribute('user-key') || '',
        theme: this.getAttribute('theme') || 'inherit',
        autoOffer: this.getAttribute('auto-offer') !== 'false',
      });
      this.preferences = new PreferenceStore(this._settings);
      if (this.runner) this.runner.preferences = this.preferences;
      const theme = this._settings.theme && this._settings.theme !== 'inherit' ? this._settings.theme : null;
      syncObservedAttribute(this, 'theme', theme);
    } finally {
      this._syncingAttrs = false;
    }
  }

  configure(settings = {}) {
    this._settings = mergeSettings(this._settings, settings);
    this.preferences = new PreferenceStore(this._settings);
    if (this.runner) {
      this.runner.updateSettings(this._settings);
      this.runner.preferences = this.preferences;
    }
    this.refreshHelp();
    return this._settings;
  }

  adoptThemeSheet(sheet) {
    if (!sheet) return;
    this._themeSheets.push(sheet);
    const root = this.shadowRoot;
    root.adoptedStyleSheets = [...(root.adoptedStyleSheets || []), sheet];
    for (const el of [this.spotlight, this.coachmark, this.offer]) {
      if (el?.shadowRoot) {
        el.shadowRoot.adoptedStyleSheets = [...(el.shadowRoot.adoptedStyleSheets || []), sheet];
      }
    }
  }

  register(tour) {
    return this.catalog.register(tour);
  }

  async ingest(url) {
    return this.catalog.ingest(url);
  }

  list() {
    return this.catalog.list();
  }

  start(tourId, options) {
    return this.runner.start(tourId, options);
  }

  helpItems() {
    const locale = this._settings.locale;
    return this.catalog.list().map((tour) => {
      const localized = localizeTour(tour, locale);
      const pref = this.preferences.get(tour.id, tour.version);
      return {
        id: tour.id,
        version: tour.version,
        title: localized.title,
        description: localized.description,
        status: pref.status,
        isNew: pref.status === 'unseen' && tour.autoOffer,
        feature: tour.feature,
      };
    });
  }

  refreshHelp() {
    const labels = chromeStrings(this._settings.locale);
    const items = this.helpItems();
    const slotted = this.querySelectorAll('ah-webtour-help');
    const targets = slotted.length ? [...slotted] : [];
    for (const help of targets) {
      help.labels = labels;
      help.items = items;
      help.onStart = (id) => this.start(id);
    }
  }

  maybeAutoOffer() {
    if (!this._settings.autoOffer) return;
    if (this.runner?.active) return;
    if (this._offerTourId) return;
    const candidate = this.catalog.list().find((tour) => this.preferences.shouldAutoOffer(tour));
    if (!candidate) return;
    const localized = localizeTour(candidate, this._settings.locale);
    const ev = emit(
      this,
      EVENTS.offer,
      { tourId: candidate.id, version: candidate.version },
      { cancelable: true }
    );
    if (ev.defaultPrevented) return;
    this._offerTourId = candidate.id;
    this.offer.labels = chromeStrings(this._settings.locale);
    this.offer.tour = { id: candidate.id, version: candidate.version, title: localized.title };
  }

  _hideOffer() {
    this._offerTourId = null;
    this.offer.tour = null;
  }

  _renderStep(model, handlers) {
    this._hideOffer();
    const spotlight = this.spotlight;
    const coachmark = this.coachmark;
    if (model.backdrop && !model.awaitingAdvance) {
      spotlight.hidden = false;
      spotlight.targetRect = model.orphan ? null : model.targetRect;
    } else {
      spotlight.hidden = true;
    }
    coachmark.hidden = false;
    coachmark.handlers = handlers;
    if (model.html && typeof this._settings.sanitize === 'function') {
      model = { ...model, html: this._settings.sanitize(model.html) };
    } else if (model.html && !this._settings.sanitize) {
      model = { ...model, html: undefined, body: model.body || '' };
    }
    coachmark.model = model;
    if (model.advanceOnTarget && model.targetRect && handlers.onTargetClick) {
      const selector =
        this.runner.active?.steps?.[model.index]?.target;
      const el =
        typeof selector === 'string'
          ? document.querySelector(selector)
          : selector && selector.selector
            ? document.querySelector(selector.selector)
            : null;
      if (el) {
        const once = () => {
          el.removeEventListener('click', once, true);
          handlers.onTargetClick();
        };
        el.addEventListener('click', once, true);
      }
    }
  }

  _clearStep() {
    this.spotlight.hidden = true;
    this.spotlight.targetRect = null;
    this.coachmark.hidden = true;
    this.coachmark.model = null;
  }
}

defineOnce('ah-webtour', AhWebtour);

export { AhWebtour };
