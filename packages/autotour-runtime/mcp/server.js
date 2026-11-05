import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { validateTour, validateCatalog } from '../src/validate.js';

const PROTOCOL_VERSION = '2025-06-18';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function tourPath(toursDir, id) {
  const safe = String(id).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return path.join(toursDir, `${safe}.json`);
}

function manifestPath(toursDir) {
  return path.join(toursDir, 'manifest.json');
}

function loadManifest(toursDir) {
  const file = manifestPath(toursDir);
  if (!fs.existsSync(file)) return { schemaVersion: 1, tours: [] };
  return readJson(file);
}

function saveManifest(toursDir, manifest) {
  writeJson(manifestPath(toursDir), manifest);
}

function textResult(payload) {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
  };
}

function createTools(toursDir) {
  ensureDir(toursDir);
  return {
    'webtour.list_tours': {
      description: 'List tour JSON files and manifest entries in the tours directory',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler() {
        const files = fs.readdirSync(toursDir).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
        const tours = files.map((file) => {
          const data = readJson(path.join(toursDir, file));
          return { file, id: data.id, version: data.version, feature: data.feature || null };
        });
        return textResult({ toursDir, tours, manifest: loadManifest(toursDir) });
      },
    },
    'webtour.create_tour': {
      description: 'Create a new tour JSON file',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
          feature: { type: 'string' },
          autoOffer: { type: 'boolean' },
          title: { type: 'string' },
          locale: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler(args) {
        const id = args.id;
        const file = tourPath(toursDir, id);
        if (fs.existsSync(file)) throw new Error(`Tour already exists: ${id}`);
        const locale = args.locale || 'en';
        const tour = {
          id,
          version: args.version || '1.0.0',
          feature: args.feature || undefined,
          autoOffer: args.autoOffer !== false,
          locales: {
            [locale]: {
              title: args.title || id,
              steps: {},
            },
          },
          steps: [],
        };
        writeJson(file, tour);
        return textResult({ ok: true, file, tour });
      },
    },
    'webtour.add_step': {
      description: 'Add a step to an existing tour',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          stepId: { type: 'string' },
          target: { type: 'string' },
          placement: { type: 'string' },
          orphan: { type: 'boolean' },
          title: { type: 'string' },
          body: { type: 'string' },
          locale: { type: 'string' },
        },
        required: ['id', 'stepId'],
        additionalProperties: false,
      },
      handler(args) {
        const file = tourPath(toursDir, args.id);
        const tour = readJson(file);
        if ((tour.steps || []).some((s) => s.id === args.stepId)) {
          throw new Error(`Step already exists: ${args.stepId}`);
        }
        const step = {
          id: args.stepId,
          target: args.target,
          placement: args.placement || 'auto',
          orphan: args.orphan || undefined,
        };
        tour.steps = tour.steps || [];
        tour.steps.push(step);
        const locale = args.locale || 'en';
        tour.locales = tour.locales || {};
        tour.locales[locale] = tour.locales[locale] || { title: tour.id, steps: {} };
        tour.locales[locale].steps = tour.locales[locale].steps || {};
        tour.locales[locale].steps[args.stepId] = {
          title: args.title || args.stepId,
          body: args.body || '',
        };
        const result = validateTour(tour);
        if (!result.ok) throw new Error(`Invalid tour: ${JSON.stringify(result.errors)}`);
        writeJson(file, tour);
        return textResult({ ok: true, file, step });
      },
    },
    'webtour.update_step': {
      description: 'Update an existing tour step',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          stepId: { type: 'string' },
          target: { type: 'string' },
          placement: { type: 'string' },
          orphan: { type: 'boolean' },
          title: { type: 'string' },
          body: { type: 'string' },
          locale: { type: 'string' },
        },
        required: ['id', 'stepId'],
        additionalProperties: false,
      },
      handler(args) {
        const file = tourPath(toursDir, args.id);
        const tour = readJson(file);
        const step = (tour.steps || []).find((s) => s.id === args.stepId);
        if (!step) throw new Error(`Unknown step: ${args.stepId}`);
        if (args.target !== undefined) step.target = args.target;
        if (args.placement !== undefined) step.placement = args.placement;
        if (args.orphan !== undefined) step.orphan = args.orphan;
        if (args.title !== undefined || args.body !== undefined) {
          const locale = args.locale || 'en';
          tour.locales = tour.locales || {};
          tour.locales[locale] = tour.locales[locale] || { title: tour.id, steps: {} };
          tour.locales[locale].steps = tour.locales[locale].steps || {};
          tour.locales[locale].steps[args.stepId] = {
            ...(tour.locales[locale].steps[args.stepId] || {}),
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.body !== undefined ? { body: args.body } : {}),
          };
        }
        writeJson(file, tour);
        return textResult({ ok: true, file, step });
      },
    },
    'webtour.set_locale': {
      description: 'Add or update localized copy for a tour',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          locale: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          steps: { type: 'object' },
        },
        required: ['id', 'locale'],
        additionalProperties: false,
      },
      handler(args) {
        const file = tourPath(toursDir, args.id);
        const tour = readJson(file);
        tour.locales = tour.locales || {};
        tour.locales[args.locale] = {
          ...(tour.locales[args.locale] || {}),
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          steps: {
            ...((tour.locales[args.locale] && tour.locales[args.locale].steps) || {}),
            ...(args.steps || {}),
          },
        };
        writeJson(file, tour);
        return textResult({ ok: true, file, locale: args.locale, pack: tour.locales[args.locale] });
      },
    },
    'webtour.validate': {
      description: 'Validate a tour file or the catalog manifest',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          manifest: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      handler(args) {
        if (args.manifest) {
          return textResult(validateCatalog(loadManifest(toursDir)));
        }
        if (!args.id) throw new Error('id or manifest=true is required');
        const tour = readJson(tourPath(toursDir, args.id));
        return textResult(validateTour(tour));
      },
    },
    'webtour.publish': {
      description: 'Append or update a tour entry in the catalog manifest',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          href: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler(args) {
        const file = tourPath(toursDir, args.id);
        const tour = readJson(file);
        const result = validateTour(tour);
        if (!result.ok) throw new Error(`Invalid tour: ${JSON.stringify(result.errors)}`);
        const manifest = loadManifest(toursDir);
        const href = args.href || `./${path.basename(file)}`;
        const entry = {
          id: tour.id,
          version: tour.version,
          href,
          feature: tour.feature,
          autoOffer: tour.autoOffer,
        };
        const idx = manifest.tours.findIndex((t) => t.id === tour.id);
        if (idx >= 0) manifest.tours[idx] = entry;
        else manifest.tours.push(entry);
        const catalogResult = validateCatalog(manifest);
        if (!catalogResult.ok) throw new Error(`Invalid manifest: ${JSON.stringify(catalogResult.errors)}`);
        saveManifest(toursDir, manifest);
        return textResult({ ok: true, entry, manifest });
      },
    },
  };
}

export function startMcpServer({ toursDir = './tours', stdin = process.stdin, stdout = process.stdout } = {}) {
  const tools = createTools(path.resolve(toursDir));
  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });

  function write(message) {
    stdout.write(`${JSON.stringify(message)}\n`);
  }

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      write({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error', data: String(err) } });
      return;
    }
    const { id, method, params } = msg;
    try {
      if (method === 'initialize') {
        write({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'agenthouse-webtour', version: '0.1.0' },
          },
        });
        return;
      }
      if (method === 'notifications/initialized') return;
      if (method === 'tools/list') {
        write({
          jsonrpc: '2.0',
          id,
          result: {
            tools: Object.entries(tools).map(([name, tool]) => ({
              name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          },
        });
        return;
      }
      if (method === 'tools/call') {
        const name = params?.name;
        const tool = tools[name];
        if (!tool) throw new Error(`Unknown tool: ${name}`);
        const result = await tool.handler(params?.arguments || {});
        write({ jsonrpc: '2.0', id, result });
        return;
      }
      write({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (err) {
      write({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message || String(err) },
      });
    }
  });

  return { tools };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startMcpServer({ toursDir: process.env.AH_WEBTOUR_DIR || process.argv[2] || './tours' });
}
