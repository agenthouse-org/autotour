const STATES = Object.freeze({
  unseen: 'unseen',
  inProgress: 'in-progress',
  completed: 'completed',
  snoozed: 'snoozed',
  never: 'never',
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private mode */
  }
  return memoryStorage();
}

export class PreferenceStore {
  constructor(options = {}) {
    this.productId = options.productId || 'default';
    this.userKey = options.userKey || '';
    this.storage = options.storage || defaultStorage();
    this.remindAfterMs = options.remindAfterMs ?? 3 * 24 * 60 * 60 * 1000;
  }

  key() {
    const user = this.userKey ? `:${this.userKey}` : '';
    return `ah-webtour:${this.productId}${user}`;
  }

  readAll() {
    try {
      const raw = this.storage.getItem(this.key());
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  writeAll(data) {
    this.storage.setItem(this.key(), JSON.stringify(data || {}));
  }

  tourKey(tourId, version) {
    return `${tourId}@${version || '0'}`;
  }

  get(tourId, version) {
    const all = this.readAll();
    const entry = all[this.tourKey(tourId, version)];
    if (!entry || typeof entry !== 'object') {
      return { status: STATES.unseen };
    }
    if (entry.status === STATES.snoozed && entry.remindAt && Date.now() >= Number(entry.remindAt)) {
      return { ...entry, status: STATES.unseen, remindAt: undefined };
    }
    return entry;
  }

  set(tourId, version, patch) {
    const all = this.readAll();
    const k = this.tourKey(tourId, version);
    all[k] = { ...(all[k] || {}), ...patch, updatedAt: new Date().toISOString() };
    this.writeAll(all);
    return all[k];
  }

  markInProgress(tourId, version, stepIndex = 0) {
    return this.set(tourId, version, { status: STATES.inProgress, stepIndex });
  }

  markCompleted(tourId, version) {
    return this.set(tourId, version, { status: STATES.completed, remindAt: undefined });
  }

  markNever(tourId, version) {
    return this.set(tourId, version, { status: STATES.never, remindAt: undefined });
  }

  markSnoozed(tourId, version, remindAfterMs = this.remindAfterMs) {
    const remindAt = Date.now() + Number(remindAfterMs || this.remindAfterMs);
    return this.set(tourId, version, { status: STATES.snoozed, remindAt });
  }

  shouldAutoOffer(tour) {
    if (!tour || tour.autoOffer === false) return false;
    const pref = this.get(tour.id, tour.version);
    return pref.status === STATES.unseen;
  }
}

export { STATES, memoryStorage };
