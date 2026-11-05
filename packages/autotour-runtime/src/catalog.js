function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || '0').split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export class TourCatalog {
  constructor() {
    this._tours = new Map();
    this._listeners = new Set();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const list = this.list();
    for (const fn of this._listeners) {
      try {
        fn(list);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  register(tour) {
    if (!tour || !tour.id) throw new Error('Tour requires id');
    const existing = this._tours.get(tour.id);
    if (existing && compareVersions(existing.version, tour.version) > 0) {
      return existing;
    }
    const next = structuredClone ? structuredClone(tour) : JSON.parse(JSON.stringify(tour));
    this._tours.set(tour.id, next);
    this._emit();
    return next;
  }

  get(id) {
    return this._tours.get(id) || null;
  }

  list() {
    return [...this._tours.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  clear() {
    this._tours.clear();
    this._emit();
  }

  async ingest(url, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Catalog ingest failed: ${res.status}`);
    const manifest = await res.json();
    const tours = Array.isArray(manifest?.tours) ? manifest.tours : [];
    const base = new URL(url, typeof location !== 'undefined' ? location.href : 'file:///');
    const loaded = [];
    for (const entry of tours) {
      const href = new URL(entry.href, base).href;
      const tourRes = await fetchImpl(href);
      if (!tourRes.ok) throw new Error(`Tour fetch failed for ${entry.id}: ${tourRes.status}`);
      const tour = await tourRes.json();
      if (!tour.id) tour.id = entry.id;
      if (!tour.version) tour.version = entry.version;
      if (entry.autoOffer != null && tour.autoOffer == null) tour.autoOffer = entry.autoOffer;
      if (entry.feature && !tour.feature) tour.feature = entry.feature;
      loaded.push(this.register(tour));
    }
    return loaded;
  }
}

export { compareVersions };
