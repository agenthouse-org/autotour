import { localizeTour } from './validate.js';
import { emit, EVENTS } from './events.js';
import { placeNear, placeDocked, waitForTarget, isUsableRect, isVisibleTarget, resolveAdvanceWhen } from './placement.js';
import { chromeStrings, formatChrome } from './i18n/chrome.js';

export class TourRunner {
  constructor({ host, catalog, preferences, settings, ui }) {
    this.host = host;
    this.catalog = catalog;
    this.preferences = preferences;
    this.settings = settings;
    this.ui = ui;
    this.active = null;
    this.index = 0;
    this._waitAbort = null;
    this._advanceTimer = null;
    this._advanceWhenGaveUpIndex = null;
    this._awaitingAdvance = false;
    this._showToken = 0;
    this._onKey = this._onKey.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  updateSettings(settings) {
    this.settings = settings;
  }

  get chrome() {
    return chromeStrings(this.settings.locale);
  }

  async start(tourId, options = {}) {
    const tour = this.catalog.get(tourId);
    if (!tour) {
      emit(this.host, EVENTS.error, { message: `Unknown tour: ${tourId}` });
      return false;
    }
    const startEvent = emit(this.host, EVENTS.start, { tourId: tour.id, version: tour.version }, { cancelable: true });
    if (startEvent.defaultPrevented && !options.force) return false;

    this.active = localizeTour(tour, this.settings.locale);
    this.index = Number.isInteger(options.stepIndex) ? options.stepIndex : 0;
    this._advanceWhenGaveUpIndex = null;
    this.preferences.markInProgress(tour.id, tour.version, this.index);
    if (this.settings.keyboard && typeof document !== 'undefined') {
      document.addEventListener('keydown', this._onKey);
      window.addEventListener('resize', this._onResize);
      window.addEventListener('scroll', this._onResize, true);
    }
    await this.showCurrent();
    return true;
  }

  async showCurrent() {
    if (!this.active) return;
    const token = ++this._showToken;
    this._abortTargetWait();
    this._clearAdvanceTimer();
    const steps = this.active.steps || [];
    if (this.index < 0 || this.index >= steps.length) {
      await this.complete();
      return;
    }
    const step = steps[this.index];
    const advanceWhen = resolveAdvanceWhen(step);
    const waiting =
      !!advanceWhen && this._advanceWhenGaveUpIndex !== this.index && !this._advanceWhenReady(advanceWhen);
    if (advanceWhen && this._advanceWhenGaveUpIndex !== this.index && this._advanceWhenReady(advanceWhen)) {
      this.index += 1;
      this.preferences.markInProgress(this.active.id, this.active.version, this.index);
      await this.showCurrent();
      return;
    }

    emit(this.host, EVENTS.beforeStep, {
      tourId: this.active.id,
      stepId: step.id,
      index: this.index,
      total: steps.length,
    });
    if (token !== this._showToken || !this.active) return;

    let el = null;
    let orphan = !!step.orphan || !step.target;
    if (!orphan) {
      this._waitAbort = typeof AbortController === 'function' ? new AbortController() : null;
      el = await waitForTarget(step, this.settings.waitTimeoutMs, {
        signal: this._waitAbort ? this._waitAbort.signal : undefined,
      });
      if (token !== this._showToken || !this.active) return;
      if (el && typeof requestAnimationFrame === 'function') {
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      }
      if (token !== this._showToken || !this.active) return;
      if (el && !isUsableRect(el.getBoundingClientRect())) el = null;
      if (!el) {
        emit(this.host, EVENTS.missingTarget, {
          tourId: this.active.id,
          stepId: step.id,
          index: this.index,
        });
        const missing = step.onMissing || this.settings.onMissing || 'orphan';
        if (missing === 'skip') {
          this.index += 1;
          await this.showCurrent();
          return;
        }
        if (missing === 'end') {
          await this.end();
          return;
        }
        if (missing === 'error') {
          emit(this.host, EVENTS.error, { message: `Missing target for step ${step.id}` });
          await this.end();
          return;
        }
        orphan = true;
      }
    }

    if (el && this.settings.scrollIntoView) {
      try {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      } catch {
        el.scrollIntoView();
      }
    }

    const rect = el ? el.getBoundingClientRect() : null;
    const popoverSize = { width: 320, height: 200 };
    const pos = waiting
      ? placeDocked(popoverSize)
      : placeNear(rect, popoverSize, orphan ? null : step.placement || 'auto');
    const total = steps.length;
    const chrome = this.chrome;
    this._awaitingAdvance = waiting;
    const model = {
      tourId: this.active.id,
      tourTitle: this.active.title,
      stepId: step.id,
      title: step.title,
      body: step.body,
      html: step.html,
      index: this.index,
      total,
      progressText: formatChrome(chrome.progress, { current: this.index + 1, total }),
      orphan,
      targetRect: rect,
      placement: pos,
      blockTarget: !!step.blockTarget,
      advanceOnTarget: !!step.advanceOnTarget,
      awaitingAdvance: waiting,
      showProgress: this.settings.progress !== false,
      labels: chrome,
      isFirst: this.index === 0,
      isLast: this.index >= total - 1,
      zIndex: this.settings.zIndex,
      backdrop: this.settings.backdrop !== false,
    };

    emit(this.host, EVENTS.step, {
      tourId: this.active.id,
      stepId: step.id,
      index: this.index,
      total,
    });

    if (this.ui && typeof this.ui.renderStep === 'function') {
      this.ui.renderStep(model, {
        onNext: () => this.next(),
        onPrev: () => this.prev(),
        onSkip: () => this.end(),
        onDone: () => this.complete(),
        onTargetClick: step.advanceOnTarget ? () => this.next() : null,
      });
    }

    if (waiting) this._watchAdvanceWhen(advanceWhen, token);
  }

  async next() {
    if (!this.active || this._awaitingAdvance) return;
    const ev = emit(
      this.host,
      EVENTS.next,
      { tourId: this.active.id, stepId: this.active.steps[this.index]?.id, index: this.index },
      { cancelable: true }
    );
    if (ev.defaultPrevented) return;
    this.index += 1;
    this.preferences.markInProgress(this.active.id, this.active.version, this.index);
    await this.showCurrent();
  }

  async prev() {
    if (!this.active || this.index <= 0) return;
    const ev = emit(
      this.host,
      EVENTS.prev,
      { tourId: this.active.id, stepId: this.active.steps[this.index]?.id, index: this.index },
      { cancelable: true }
    );
    if (ev.defaultPrevented) return;
    this.index -= 1;
    this._advanceWhenGaveUpIndex = null;
    this.preferences.markInProgress(this.active.id, this.active.version, this.index);
    await this.showCurrent();
  }

  async complete() {
    if (!this.active) return;
    const tour = this.active;
    this.preferences.markCompleted(tour.id, tour.version);
    emit(this.host, EVENTS.complete, { tourId: tour.id, version: tour.version });
    await this.end(false);
  }

  async end(emitEnd = true) {
    this._abortTargetWait();
    this._clearAdvanceTimer();
    this._awaitingAdvance = false;
    this._advanceWhenGaveUpIndex = null;
    this._showToken += 1;
    if (emitEnd && this.active) {
      emit(this.host, EVENTS.end, { tourId: this.active.id, version: this.active.version });
    }
    this.active = null;
    this.index = 0;
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('scroll', this._onResize, true);
    }
    if (this.ui && typeof this.ui.clearStep === 'function') this.ui.clearStep();
  }

  remind(tourId, version) {
    const tour = this.catalog.get(tourId) || { id: tourId, version };
    const pref = this.preferences.markSnoozed(tour.id, tour.version, this.settings.remindAfterMs);
    emit(this.host, EVENTS.remind, { tourId: tour.id, remindAt: pref.remindAt });
    return pref;
  }

  never(tourId, version) {
    const tour = this.catalog.get(tourId) || { id: tourId, version };
    const pref = this.preferences.markNever(tour.id, tour.version);
    emit(this.host, EVENTS.never, { tourId: tour.id });
    return pref;
  }

  _advanceWhenReady(spec) {
    if (!spec || typeof document === 'undefined') return false;
    return isVisibleTarget(document.querySelector(spec.selector));
  }

  _watchAdvanceWhen(spec, token) {
    const started = Date.now();
    const forever = !spec.timeout;
    this._advanceTimer = setInterval(() => {
      if (token !== this._showToken || !this.active) {
        this._clearAdvanceTimer();
        return;
      }
      if (this._advanceWhenReady(spec)) {
        this._awaitingAdvance = false;
        this._clearAdvanceTimer();
        this.next();
        return;
      }
      if (!forever && Date.now() - started >= spec.timeout) {
        this._advanceWhenGaveUpIndex = this.index;
        this._awaitingAdvance = false;
        this._clearAdvanceTimer();
        this.showCurrent();
      }
    }, 50);
  }

  _abortTargetWait() {
    if (this._waitAbort) {
      this._waitAbort.abort();
      this._waitAbort = null;
    }
  }

  _clearAdvanceTimer() {
    if (this._advanceTimer) {
      clearInterval(this._advanceTimer);
      this._advanceTimer = null;
    }
  }

  _onKey(event) {
    if (!this.active || !this.settings.keyboard) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.end();
    } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
      if (this._awaitingAdvance) return;
      event.preventDefault();
      this.next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.prev();
    }
  }

  _onResize() {
    if (this.active) this.showCurrent();
  }
}
