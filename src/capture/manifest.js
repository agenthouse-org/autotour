import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { redactValue } from "./redact.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schemaPath = path.join(packageRoot, "schemas", "walkthrough.schema.json");

let validatorPromise;

async function getValidator() {
  if (!validatorPromise) {
    validatorPromise = (async () => {
      const { readFile } = await import("node:fs/promises");
      const schema = JSON.parse(await readFile(schemaPath, "utf8"));
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      return ajv.compile(schema);
    })();
  }
  return validatorPromise;
}

/**
 * Validate a walkthrough document against the shared schema.
 * @param {object} document
 * @returns {Promise<{ valid: boolean, errors: object[] }>}
 */
export async function validateWalkthroughDocument(document) {
  const validate = await getValidator();
  const valid = validate(document);
  return { valid: Boolean(valid), errors: validate.errors ?? [] };
}

/**
 * Build a schema-valid walkthrough from capture results.
 * Only observed API endpoints are recorded as dependencies.
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.title
 * @param {string} options.baseUrl
 * @param {string} options.goal
 * @param {object[]} options.modules
 * @param {Iterable<string>} [options.secrets]
 */
export function buildWalkthrough({
  id,
  title,
  baseUrl,
  goal,
  modules,
  outputs = ["screenshots"],
  publish = false,
  secrets = []
}) {
  const walkthrough = {
    schemaVersion: 1,
    id,
    title,
    target: {
      baseUrl,
      goal
    },
    publish,
    outputs,
    modules: modules.map((module) => ({
      id: module.id,
      title: module.title,
      route: module.route,
      publish: module.publish ?? true,
      steps: module.steps.map((step) => {
        /** @type {Record<string, unknown>} */
        const entry = {
          id: step.id,
          action: step.action,
          description: step.description
        };
        if (step.target?.name) {
          entry.selector = `role=${step.target.role}[name=${JSON.stringify(step.target.name)}]`;
        } else if (step.target?.text) {
          entry.selector = `text=${JSON.stringify(step.target.text)}`;
        }
        if (step.valueEnv) {
          entry.valueEnv = step.valueEnv;
        }
        copyActionDetails(entry, step);
        return entry;
      }),
      dependencies: mergeDependencies(module.dependencies, module.observedRequests),
      assets: { ...(module.assets ?? {}) }
    }))
  };

  return redactValue(walkthrough, secrets);
}

/**
 * Build ST-03 capture-step records from executed modules.
 * @param {object[]} modules
 * @param {Iterable<string>} [secrets]
 */
export function buildCaptureSteps(modules, secrets = []) {
  const steps = [];
  for (const module of modules) {
    for (const step of module.steps) {
      /** @type {Record<string, unknown>} */
      const entry = {
        id: step.id,
        moduleId: module.id,
        action: step.action,
        description: step.description,
        route: module.route,
        observedRequests: [...(step.observedRequests ?? [])],
        annotation: step.annotation ?? {
          callout: 1,
          caption: step.description
        }
      };
      if (step.target) {
        entry.target = step.target.text
          ? { text: step.target.text }
          : { role: step.target.role, name: step.target.name };
      }
      if (step.valueEnv) {
        entry.valueEnv = step.valueEnv;
      }
      copyActionDetails(entry, step);
      steps.push(entry);
    }
  }
  return redactValue(steps, secrets);
}

/**
 * Write walkthrough and capture-step artifacts.
 * @param {string} outputDir
 * @param {object} walkthrough
 * @param {object[]} captureSteps
 */
export async function writeCaptureArtifacts(outputDir, walkthrough, captureSteps) {
  await mkdir(outputDir, { recursive: true });
  const walkthroughPath = path.join(outputDir, "walkthrough.json");
  const stepsPath = path.join(outputDir, "capture-steps.json");
  await writeFile(walkthroughPath, `${JSON.stringify(walkthrough, null, 2)}\n`, "utf8");
  await writeFile(stepsPath, `${JSON.stringify(captureSteps, null, 2)}\n`, "utf8");
  return { walkthroughPath, stepsPath };
}

export { schemaPath };

function copyActionDetails(entry, step) {
  for (const key of ["path", "value", "durationMs", "timeoutMs", "url", "state"]) {
    if (step[key] !== undefined) entry[key] = step[key];
  }
  if (step.scroll) {
    entry.scroll = {
      mode: step.scroll.mode ?? "by",
      x: step.scroll.x ?? 0,
      y: step.scroll.y ?? 0,
      durationMs: step.scroll.durationMs ?? 0
    };
  }
}

function mergeDependencies(existing = {}, observedRequests = []) {
  const dependencies = { ...existing };
  const apiEndpoints = [...new Set([
    ...(existing.apiEndpoints ?? []),
    ...observedRequests
  ])];
  if (apiEndpoints.length > 0) dependencies.apiEndpoints = apiEndpoints;
  return dependencies;
}
