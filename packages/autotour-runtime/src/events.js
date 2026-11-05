export function emit(host, type, detail = {}, options = {}) {
  const event = new CustomEvent(type, {
    detail,
    bubbles: true,
    composed: true,
    cancelable: !!options.cancelable,
  });
  const target = host || (typeof document !== 'undefined' ? document : null);
  if (!target) return event;
  target.dispatchEvent(event);
  return event;
}

export const EVENTS = Object.freeze({
  ready: 'ah-webtour-ready',
  catalogChange: 'ah-webtour-catalog-change',
  offer: 'ah-webtour-offer',
  start: 'ah-webtour-start',
  beforeStep: 'ah-webtour-before-step',
  step: 'ah-webtour-step',
  next: 'ah-webtour-next',
  prev: 'ah-webtour-prev',
  complete: 'ah-webtour-complete',
  end: 'ah-webtour-end',
  remind: 'ah-webtour-remind',
  never: 'ah-webtour-never',
  missingTarget: 'ah-webtour-missing-target',
  error: 'ah-webtour-error',
});
