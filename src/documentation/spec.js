import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateDependencyMapDocument } from "../invalidation/index.js";
import { checkTranslationLinks } from "./languages.js";
import { MAX_WAIT_MS } from "../capture/limits.js";
import { loadOpenApiDocuments, operationFor } from "./openapi.js";

export const documentationSchemaPath = fileURLToPath(new URL("../../schemas/documentation.schema.json", import.meta.url));
let validator;

export async function validateDocumentationSpec(spec, { journey, dependencyMap, openApiDocuments } = {}) {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    validator = ajv.compile(JSON.parse(await readFile(documentationSchemaPath, "utf8")));
  }
  if (!validator(spec)) return { valid: false, errors: structuredClone(validator.errors) };
  if (spec.targets?.length && new Set(spec.targets.map(target => target.kind)).size !== spec.targets.length) {
    return { valid: false, errors: [{ message: "Documentation targets must have unique kinds." }] };
  }
  const errors = [];
  const fail = (message) => errors.push({ message });
  if (spec.translations?.length) {
    if (!spec.language) fail("A language switch needs the specification language.");
    if (new Set(spec.translations.map(item => item.language)).size !== spec.translations.length) fail("Translation languages must be unique.");
    for (const item of spec.translations) {
      if (item.language === spec.language) fail(`Translation ${item.language} repeats the current language.`);
      if (path.isAbsolute(item.spec) || /^[a-z][a-z0-9+.-]*:/i.test(item.spec)) fail(`Translation ${item.language} must use a relative specification path.`);
    }
  }
  if (journey && journey.id !== spec.walkthroughId) fail("walkthroughId does not match the journey.");
  if (journey && (!Array.isArray(journey.modules) || new Set(journey.modules.map(m => m.id)).size !== journey.modules.length)) {
    fail("Journey modules must have unique IDs.");
    return { valid: false, errors };
  }
  if (dependencyMap) {
    const result = await validateDependencyMapDocument(dependencyMap);
    if (!result.valid) return { valid: false, errors: [...errors, ...result.errors] };
  }
  if (Array.isArray(journey?.modules)) {
    for (const module of journey.modules) {
      for (const step of [...(module.setup ?? []), ...(module.steps ?? [])]) {
        checkWaitLimit(fail, module, step, "timeoutMs", step.timeoutMs, 1);
        checkWaitLimit(fail, module, step, "stableForMs", step.stableForMs, 0);
        for (const field of ["until", "expect"]) {
          checkWaitLimit(fail, module, step, `${field}.timeoutMs`, step[field]?.timeoutMs, 1);
          checkWaitLimit(fail, module, step, `${field}.stableForMs`, step[field]?.stableForMs, 0);
        }
      }
    }
  }
  const seen = new Set();
  for (const section of spec.sections) {
    const status = section.status ?? "ready";
    if (/autotour:module=|[\r\n]/.test(section.heading)) fail("Section headings must be single-line text without managed-region markers.");
    if (seen.has(section.moduleId)) fail(`Duplicate documentation section for ${section.moduleId}.`);
    seen.add(section.moduleId);
    const module = journey?.modules?.find(m => m.id === section.moduleId);
    if (status === "ready" && journey && !module) fail(`Unknown module ${section.moduleId}.`);
    if (module && (!Array.isArray(module.steps) || new Set(module.steps.map(step => step.id)).size !== module.steps.length)) {
      fail(`${section.moduleId}: journey steps must have unique IDs.`);
    }
    if (status === "ready" && (!section.dependencies || Object.keys(section.dependencies).length === 0)) {
      fail(`${section.moduleId}: a ready chapter needs at least one recorded dependency.`);
    }
    if (status === "ready") {
      for (const [kind, values] of Object.entries(section.dependencies ?? {})) {
        for (const value of values) {
          if (module && (!Array.isArray(module.dependencies?.[kind]) || !module.dependencies[kind].includes(value))) {
            fail(`${section.moduleId}: dependency ${kind}:${value} is not recorded by the journey.`);
          }
          if (dependencyMap && !dependencyMap.rules?.some(rule => rule.dependencies?.[kind]?.includes(value))) {
            fail(`${section.moduleId}: dependency ${kind}:${value} has no source-file mapping.`);
          }
        }
      }
    }
    const screenshots = new Set();
    const operations = new Set();
    for (const block of section.blocks) {
      if ([block.text, block.caption, block.alt, block.label, block.document, block.operation].some(value => /autotour:module=/.test(value ?? ""))) {
        fail("Documentation blocks cannot contain managed-region markers.");
      }
      if (block.alt && /[\r\n]/.test(block.alt)) fail("Screenshot alt text must be a single line.");
      if (status === "text" && !["text", "embed"].includes(block.kind)) {
        fail(`${section.moduleId}: a text chapter can only contain prose and embedded pages.`);
        continue;
      }
      if (block.kind === "openapi") {
        if (operations.has(block.operation)) fail(`${section.moduleId}: duplicate OpenAPI operation ${block.operation}.`);
        operations.add(block.operation);
        if (!section.dependencies?.apiEndpoints?.includes(block.operation)) {
          fail(`${section.moduleId}: OpenAPI operation ${block.operation} must be an apiEndpoints dependency.`);
        }
        if (openApiDocuments) {
          const loaded = openApiDocuments.get(block.document);
          if (!loaded) fail(`${section.moduleId}: OpenAPI document ${block.document} was not loaded.`);
          else {
            try {
              const operation = operationFor(loaded, block.operation);
              if (!operation) fail(`${section.moduleId}: OpenAPI document does not define ${block.operation}.`);
            } catch (error) {
              fail(`${section.moduleId}: ${error.message}`);
            }
          }
        }
      }
      if (block.kind !== "screenshot") continue;
      if (screenshots.has(block.stepId)) fail(`${section.moduleId}: duplicate screenshot step ${block.stepId}.`);
      screenshots.add(block.stepId);
      if (status !== "ready") continue;
      if (!section.dependencies?.views?.includes(block.sourceView)) fail(`${section.moduleId}: sourceView ${block.sourceView} must be a section view dependency.`);
      if (module && (!Array.isArray(module.steps) || module.steps.filter(step => step.id === block.stepId).length !== 1)) {
        fail(`${section.moduleId}: screenshot step ${block.stepId} is missing or ambiguous.`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export async function readDocumentationSpec(file) {
  const specPath = path.resolve(file);
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const shape = await validateDocumentationSpec(spec);
  if (!shape.valid) throw new Error(`Documentation specification is invalid: ${JSON.stringify(shape.errors)}`);
  const [journey, dependencyMap, openApiDocuments] = await Promise.all([
    readJsonReference(specPath, spec.journey),
    readJsonReference(specPath, spec.dependencyMap),
    loadOpenApiDocuments(specPath, spec)
  ]);
  const result = await validateDocumentationSpec(spec, { journey, dependencyMap, openApiDocuments });
  if (!result.valid) throw new Error(`Documentation references are invalid: ${JSON.stringify(result.errors)}`);
  await checkTranslationLinks(spec, specPath);
  return { spec, journey, dependencyMap, specPath, openApiDocuments };
}

function checkWaitLimit(fail, module, step, label, value, minimum) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < minimum || value > MAX_WAIT_MS) {
    fail(`${module.id} step ${step.id}: ${label} must be an integer between ${minimum} and ${MAX_WAIT_MS}.`);
  }
}

async function readJsonReference(specPath, reference) {
  if (typeof reference === "object") return structuredClone(reference);
  if (path.isAbsolute(reference) || /^[a-z][a-z0-9+.-]*:/i.test(reference)) throw new Error("Documentation references must be relative file paths.");
  return JSON.parse(await readFile(path.resolve(path.dirname(specPath), reference), "utf8"));
}

export async function prepareDocumentationCapture({ spec, journey, dependencyMap, openApiDocuments }) {
  if (!journey || !dependencyMap) throw new Error("Documentation capture requires both journey and dependencyMap.");
  const result = await validateDocumentationSpec(spec, { journey, dependencyMap, openApiDocuments });
  if (!result.valid) throw new Error(`Cannot prepare documentation capture: ${JSON.stringify(result.errors)}`);
  const prepared = structuredClone(journey);
  for (const section of spec.sections) {
    const status = section.status ?? "ready";
    if (status === "text") continue;
    const module = prepared.modules.find(m => m.id === section.moduleId);
    if (!module) continue;
    for (const block of section.blocks.filter(b => b.kind === "screenshot")) {
      const step = module.steps.find(s => s.id === block.stepId);
      if (!step) continue;
      // Block, then spec; when neither sets it, recordScreenshots.captionInImage decides (default on).
      const captionInImage = block.captionInImage ?? spec.captionInImage;
      step.annotation = {
        ...step.annotation,
        caption: block.caption,
        callout: block.callout ?? 1,
        ...(captionInImage === undefined ? {} : { captionInImage }),
        ...(block.captionPlacement ? { captionPlacement: block.captionPlacement } : {}),
        timing: block.timing,
        ...(block.target ? { target: block.target } : {})
      };
    }
  }
  return { journey: prepared, recordScreenshots: { viewport: spec.viewport ?? { width: 1280, height: 720 } } };
}
