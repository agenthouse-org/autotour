const DEFAULTS = Object.freeze({
  locale: 'en',
  autoOffer: true,
  keyboard: true,
  backdrop: true,
  scrollIntoView: true,
  waitTimeoutMs: 2000,
  zIndex: 10000,
  progress: true,
  orphanPlacement: 'center',
  reducedMotion: null,
  remindAfterMs: 3 * 24 * 60 * 60 * 1000,
  theme: 'inherit',
  productId: 'default',
  userKey: '',
  sanitize: null,
  onMissing: 'orphan',
  storage: null,
});

export function mergeSettings(...layers) {
  const out = { ...DEFAULTS };
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      if (!(key in DEFAULTS) && key !== 'buttons') continue;
      out[key] = value;
    }
  }
  return out;
}

export { DEFAULTS };
