function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function push(errors, path, message) {
  errors.push({ path, message });
}

export function validateTour(tour) {
  const errors = [];
  if (!isObject(tour)) {
    return { ok: false, errors: [{ path: '', message: 'Tour must be an object' }] };
  }
  if (!tour.id || typeof tour.id !== 'string') push(errors, 'id', 'id is required');
  if (!tour.version || typeof tour.version !== 'string') push(errors, 'version', 'version is required');
  if (!Array.isArray(tour.steps) || tour.steps.length < 1) {
    push(errors, 'steps', 'steps must be a non-empty array');
  } else {
    const ids = new Set();
    tour.steps.forEach((step, index) => {
      const p = `steps[${index}]`;
      if (!isObject(step)) {
        push(errors, p, 'step must be an object');
        return;
      }
      if (!step.id || typeof step.id !== 'string') push(errors, `${p}.id`, 'step id is required');
      else if (ids.has(step.id)) push(errors, `${p}.id`, 'duplicate step id');
      else ids.add(step.id);
      if (step.target != null) {
        const t = step.target;
        if (typeof t !== 'string' && !isObject(t)) {
          push(errors, `${p}.target`, 'target must be a string or object');
        }
      }
    });
  }
  if (tour.locales != null && !isObject(tour.locales)) {
    push(errors, 'locales', 'locales must be an object');
  }
  return { ok: errors.length === 0, errors };
}

export function validateCatalog(manifest) {
  const errors = [];
  if (!isObject(manifest)) {
    return { ok: false, errors: [{ path: '', message: 'Manifest must be an object' }] };
  }
  if (!Array.isArray(manifest.tours)) {
    push(errors, 'tours', 'tours must be an array');
  } else {
    manifest.tours.forEach((entry, index) => {
      const p = `tours[${index}]`;
      if (!isObject(entry)) {
        push(errors, p, 'entry must be an object');
        return;
      }
      if (!entry.id) push(errors, `${p}.id`, 'id is required');
      if (!entry.version) push(errors, `${p}.version`, 'version is required');
      if (!entry.href) push(errors, `${p}.href`, 'href is required');
    });
  }
  return { ok: errors.length === 0, errors };
}

export function localizeTour(tour, locale = 'en') {
  const lang = String(locale || 'en').toLowerCase().split('-')[0];
  const pack = (tour.locales && (tour.locales[lang] || tour.locales.en)) || {};
  const stepCopy = pack.steps || {};
  return {
    ...tour,
    title: pack.title || tour.id,
    description: pack.description || '',
    steps: (tour.steps || []).map((step) => {
      const copy = stepCopy[step.id] || {};
      return {
        ...step,
        title: copy.title || step.id,
        body: copy.body || '',
        html: copy.html,
      };
    }),
  };
}
