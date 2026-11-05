import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWaitTimeout,
  resolveAdvanceWhen,
  waitForTarget,
  isVisibleTarget,
  placeDocked,
} from '../src/placement.js';
import { TourCatalog } from '../src/catalog.js';
import { PreferenceStore, memoryStorage } from '../src/preferences.js';
import { mergeSettings } from '../src/settings.js';
import { TourRunner } from '../src/runner.js';
import { syncObservedAttribute } from '../src/components/shared.js';

function fakeEl(width = 40, height = 20) {
  return {
    isConnected: true,
    getBoundingClientRect() {
      return { width, height, left: 8, top: 8, right: 8 + width, bottom: 8 + height };
    },
    scrollIntoView() {},
  };
}

function installDom(map = {}) {
  const store = { ...map };
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
  };
  const listeners = { document: new Map(), window: new Map() };
  function listen(bucket, type, fn) {
    const list = bucket.get(type) || [];
    list.push(fn);
    bucket.set(type, list);
  }
  function unlisten(bucket, type, fn) {
    const list = (bucket.get(type) || []).filter((item) => item !== fn);
    bucket.set(type, list);
  }
  globalThis.window = {
    addEventListener(type, fn) {
      listen(listeners.window, type, fn);
    },
    removeEventListener(type, fn) {
      unlisten(listeners.window, type, fn);
    },
    innerWidth: 1280,
    innerHeight: 800,
  };
  globalThis.document = {
    querySelector(selector) {
      return store[selector] || null;
    },
    addEventListener(type, fn) {
      listen(listeners.document, type, fn);
    },
    removeEventListener(type, fn) {
      unlisten(listeners.document, type, fn);
    },
  };
  return {
    set(selector, el) {
      store[selector] = el;
    },
    restore() {
      if (prev.document === undefined) delete globalThis.document;
      else globalThis.document = prev.document;
      if (prev.window === undefined) delete globalThis.window;
      else globalThis.window = prev.window;
    },
  };
}

test('resolveWaitTimeout treats 0 as an indefinite wait', () => {
  assert.equal(resolveWaitTimeout(undefined, 2000), 2000);
  assert.equal(resolveWaitTimeout(0, 2000), 0);
  assert.equal(resolveWaitTimeout(-1, 2000), 0);
  assert.equal(resolveWaitTimeout(Number.POSITIVE_INFINITY, 2000), 0);
  assert.equal(resolveWaitTimeout(1500, 2000), 1500);
});

test('resolveAdvanceWhen defaults to an indefinite wait', () => {
  assert.equal(resolveAdvanceWhen({}), null);
  assert.deepEqual(resolveAdvanceWhen({ advanceWhen: '#ready' }), { selector: '#ready', timeout: 0 });
  assert.deepEqual(resolveAdvanceWhen({ advanceWhen: { selector: '#ready', timeout: 0 } }), {
    selector: '#ready',
    timeout: 0,
  });
  assert.deepEqual(resolveAdvanceWhen({ advanceWhen: { selector: '#ready', timeout: 4000 } }), {
    selector: '#ready',
    timeout: 4000,
  });
});

test('waitForTarget keeps polling when timeout is 0', async () => {
  const dom = installDom();
  try {
    let done = false;
    const pending = waitForTarget({ target: { selector: '#late', timeout: 0 } }, 2000).then((el) => {
      done = true;
      return el;
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(done, false);
    const el = fakeEl();
    dom.set('#late', el);
    const found = await pending;
    assert.equal(found, el);
    assert.equal(isVisibleTarget(found), true);
  } finally {
    dom.restore();
  }
});

test('waitForTarget aborts when the signal fires', async () => {
  const dom = installDom();
  try {
    const controller = new AbortController();
    const pending = waitForTarget({ target: { selector: '#never', timeout: 0 } }, 2000, {
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    assert.equal(await pending, null);
  } finally {
    dom.restore();
  }
});

function makeRunner(ui) {
  const catalog = new TourCatalog();
  catalog.register({
    id: 'record.tour',
    version: '1.0.0',
    locales: {
      en: {
        title: 'Record',
        steps: {
          open: { title: 'Open', body: 'Open a record.' },
          detail: { title: 'Detail', body: 'On the record.' },
        },
      },
    },
    steps: [
      { id: 'open', target: '#nav', advanceWhen: { selector: '#record', timeout: 0 } },
      { id: 'detail', target: '#record' },
    ],
  });
  const host = new EventTarget();
  return new TourRunner({
    host,
    catalog,
    preferences: new PreferenceStore({ productId: 'test', storage: memoryStorage() }),
    settings: mergeSettings({ keyboard: false, scrollIntoView: false, waitTimeoutMs: 2000 }),
    ui,
  });
}

test('advanceWhen holds the current step until the selector appears', async () => {
  const models = [];
  const dom = installDom({ '#nav': fakeEl() });
  try {
    const runner = makeRunner({
      renderStep(model) {
        models.push(model);
      },
      clearStep() {},
    });
    await runner.start('record.tour');
    assert.equal(models[0].stepId, 'open');
    assert.equal(models[0].awaitingAdvance, true);
    assert.equal(models[0].placement.placement, 'dock');
    assert.equal(runner._awaitingAdvance, true);
    assert.equal(runner.index, 0);
    await runner.next();
    assert.equal(runner.index, 0);
    dom.set('#record', fakeEl());
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(models.some((model) => model.stepId === 'detail'));
    assert.equal(runner.index, 1);
    assert.equal(runner._awaitingAdvance, false);
    await runner.end(false);
  } finally {
    dom.restore();
  }
});

test('syncObservedAttribute does not rewrite an unchanged theme', () => {
  let writes = 0;
  const attrs = { theme: 'dark' };
  const el = {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name, value) {
      writes += 1;
      attrs[name] = String(value);
    },
    removeAttribute(name) {
      writes += 1;
      delete attrs[name];
    },
  };
  assert.equal(syncObservedAttribute(el, 'theme', 'dark'), false);
  assert.equal(writes, 0);
  assert.equal(syncObservedAttribute(el, 'theme', 'light'), true);
  assert.equal(writes, 1);
  assert.equal(attrs.theme, 'light');
  assert.equal(syncObservedAttribute(el, 'theme', null), true);
  assert.equal(writes, 2);
  assert.equal(el.getAttribute('theme'), null);
  assert.equal(syncObservedAttribute(el, 'theme', null), false);
  assert.equal(writes, 2);
});

test('advanceWhen skips a gate that is already satisfied', async () => {
  const models = [];
  const dom = installDom({
    '#nav': fakeEl(),
    '#record': fakeEl(),
  });
  try {
    const runner = makeRunner({
      renderStep(model) {
        models.push(model.stepId);
      },
      clearStep() {},
    });
    await runner.start('record.tour');
    assert.deepEqual(models, ['detail']);
    assert.equal(runner.index, 1);
    await runner.end(false);
  } finally {
    dom.restore();
  }
});
