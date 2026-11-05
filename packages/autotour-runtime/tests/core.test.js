import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TourCatalog, compareVersions } from '../src/catalog.js';
import { PreferenceStore, memoryStorage, STATES } from '../src/preferences.js';
import { mergeSettings } from '../src/settings.js';
import { validateTour, validateCatalog, localizeTour } from '../src/validate.js';
import { placeNear, placeDocked, isUsableRect } from '../src/placement.js';
import { chromeStrings } from '../src/i18n/chrome.js';
import { startMcpServer } from '../mcp/server.js';
import { Readable, Writable } from 'node:stream';

test('chromeStrings covers DealDesk locales', () => {
  assert.equal(chromeStrings('en').helpTitle, 'Product tours');
  assert.equal(chromeStrings('de').helpTitle, 'Produktführungen');
  assert.equal(chromeStrings('fr').start, 'Démarrer');
  assert.equal(chromeStrings('it').remind, 'Ricordatelo');
  assert.equal(chromeStrings('es').helpEmpty, 'Aún no hay visitas disponibles.');
  assert.equal(chromeStrings('ja').start, '開始');
  assert.equal(chromeStrings('es-ES').helpTitle, 'Visitas guiadas');
});

test('compareVersions orders semver-ish strings', () => {
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('catalog register keeps newer version', () => {
  const catalog = new TourCatalog();
  catalog.register({ id: 'a', version: '1.0.0', steps: [{ id: 's1' }] });
  catalog.register({ id: 'a', version: '1.1.0', steps: [{ id: 's1' }, { id: 's2' }] });
  catalog.register({ id: 'a', version: '1.0.5', steps: [{ id: 'old' }] });
  assert.equal(catalog.get('a').version, '1.1.0');
  assert.equal(catalog.get('a').steps.length, 2);
});

test('catalog ingest merges manifest entries', async () => {
  const catalog = new TourCatalog();
  const tours = {
    'http://example.test/manifest.json': {
      tours: [
        { id: 'one', version: '1.0.0', href: './one.json' },
        { id: 'two', version: '1.0.0', href: './two.json' },
      ],
    },
    'http://example.test/one.json': {
      id: 'one',
      version: '1.0.0',
      steps: [{ id: 'a' }],
      locales: { en: { title: 'One', steps: { a: { title: 'A', body: 'Body' } } } },
    },
    'http://example.test/two.json': {
      id: 'two',
      version: '1.0.0',
      autoOffer: true,
      steps: [{ id: 'b' }],
    },
  };
  const fetchImpl = async (url) => {
    const body = tours[url];
    if (!body) return { ok: false, status: 404 };
    return {
      ok: true,
      status: 200,
      json: async () => body,
    };
  };
  const loaded = await catalog.ingest('http://example.test/manifest.json', fetchImpl);
  assert.equal(loaded.length, 2);
  assert.equal(catalog.list().length, 2);
  assert.equal(catalog.get('two').autoOffer, true);
});

test('preference store snooze and never', () => {
  const store = new PreferenceStore({
    productId: 'demo',
    storage: memoryStorage(),
    remindAfterMs: 1000,
  });
  assert.equal(store.get('t', '1').status, STATES.unseen);
  store.markNever('t', '1');
  assert.equal(store.get('t', '1').status, STATES.never);
  store.markSnoozed('t2', '1', 60_000);
  assert.equal(store.get('t2', '1').status, STATES.snoozed);
  store.markSnoozed('t3', '1', -1);
  assert.equal(store.get('t3', '1').status, STATES.unseen);
});

test('settings merge preserves defaults', () => {
  const settings = mergeSettings({ locale: 'de', autoOffer: false });
  assert.equal(settings.locale, 'de');
  assert.equal(settings.autoOffer, false);
  assert.equal(settings.waitTimeoutMs, 2000);
});

test('validate and localize tour', () => {
  const tour = {
    id: 'demo',
    version: '1.0.0',
    steps: [{ id: 'nav', target: '#nav' }],
    locales: {
      en: { title: 'Demo', steps: { nav: { title: 'Nav', body: 'Hello' } } },
      de: { title: 'Demo DE', steps: { nav: { title: 'Navigation', body: 'Hallo' } } },
    },
  };
  assert.equal(validateTour(tour).ok, true);
  const de = localizeTour(tour, 'de');
  assert.equal(de.title, 'Demo DE');
  assert.equal(de.steps[0].title, 'Navigation');
  assert.equal(validateTour({ id: 'x' }).ok, false);
  assert.equal(validateCatalog({ tours: [{ id: 'a', version: '1', href: './a.json' }] }).ok, true);
  assert.equal(
    validateTour({
      id: 'gate',
      version: '1.0.0',
      steps: [{ id: 'open', target: '#nav', advanceWhen: { selector: '#record', timeout: 0 } }],
    }).ok,
    true
  );
});

test('placeDocked parks the card in the bottom-right', () => {
  const pos = placeDocked({ width: 320, height: 180 }, { width: 1000, height: 800 });
  assert.equal(pos.placement, 'dock');
  assert.equal(pos.left, 1000 - 320 - 12);
  assert.equal(pos.top, 800 - 180 - 12);
});

test('placeNear treats an empty rect as orphan', () => {
  const pos = placeNear(
    { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
    { width: 320, height: 180 },
    'right',
    { width: 1000, height: 800 }
  );
  assert.equal(isUsableRect({ width: 0, height: 0 }), false);
  assert.equal(pos.placement, 'orphan');
  assert.ok(pos.left > 12);
  assert.ok(pos.top > 12);
});

test('placeNear keeps a right popover beside a bottom-left target', () => {
  const pos = placeNear(
    { left: 16, top: 520, right: 280, bottom: 740, width: 264, height: 220 },
    { width: 320, height: 180 },
    'right',
    { width: 1280, height: 800 }
  );
  assert.equal(pos.placement, 'right');
  assert.ok(pos.left >= 280);
  assert.ok(pos.top > 200);
});

test('placeNear clamps inside viewport', () => {
  const pos = placeNear(
    { left: 900, top: 10, right: 980, bottom: 40, width: 80, height: 30 },
    { width: 320, height: 180 },
    'right',
    { width: 1000, height: 800 }
  );
  assert.ok(pos.left + 320 <= 1000);
  assert.ok(pos.top >= 0);
});

test('default theme CSS has no agenthouse palette hexes', () => {
  const css = fs.readFileSync(new URL('../src/theme/default.css', import.meta.url), 'utf8');
  for (const hex of ['#090B09', '#1B201B', '#F0F0F0', '#A7ADA7', '#9EFF3D', '#2F6B00', '#5B635B']) {
    assert.equal(css.includes(hex), false, `unexpected palette hex ${hex}`);
  }
});

test('MCP create validate publish flow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webtour-mcp-'));
  const input = new Readable({ read() {} });
  const chunks = [];
  const output = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  startMcpServer({ toursDir: dir, stdin: input, stdout: output });

  function send(msg) {
    input.push(`${JSON.stringify(msg)}\n`);
  }

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  await new Promise((r) => setTimeout(r, 20));
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'webtour.create_tour', arguments: { id: 'demo.tour', title: 'Demo' } },
  });
  await new Promise((r) => setTimeout(r, 20));
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'webtour.add_step',
      arguments: { id: 'demo.tour', stepId: 'one', target: '#x', title: 'One', body: 'Body' },
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  send({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'webtour.validate', arguments: { id: 'demo.tour' } },
  });
  await new Promise((r) => setTimeout(r, 20));
  send({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'webtour.publish', arguments: { id: 'demo.tour' } },
  });
  await new Promise((r) => setTimeout(r, 40));
  input.push(null);

  const joined = chunks.join('');
  assert.match(joined, /\\"ok\\": true|"ok":\s*true/);
  assert.equal(fs.existsSync(path.join(dir, 'demo.tour.json')), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.tours[0].id, 'demo.tour');
});
