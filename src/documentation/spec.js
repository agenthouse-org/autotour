import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateDependencyMapDocument } from "../invalidation/index.js";

export const documentationSchemaPath = fileURLToPath(new URL("../../schemas/documentation.schema.json", import.meta.url));
let validator;

export async function validateDocumentationSpec(spec, { journey, dependencyMap } = {}) {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    validator = ajv.compile(JSON.parse(await readFile(documentationSchemaPath, "utf8")));
  }
  if (!validator(spec)) return { valid: false, errors: structuredClone(validator.errors) };
  if (spec.targets && spec.destination) return { valid: false, errors: [{ message: "Use targets or destination, not both." }] };
  if (spec.targets?.length && new Set(spec.targets.map(target => target.kind)).size !== spec.targets.length) {
    return { valid: false, errors: [{ message: "Documentation targets must have unique kinds." }] };
  }
  const errors = [];
  const fail = (message) => errors.push({ message });
  if (journey && journey.id !== spec.walkthroughId) fail("walkthroughId does not match the journey.");
  if (journey && (!Array.isArray(journey.modules) || new Set(journey.modules.map(m => m.id)).size !== journey.modules.length)) {
    fail("Journey modules must have unique IDs.");
    return { valid: false, errors };
  }
  if (dependencyMap) {
    const result = await validateDependencyMapDocument(dependencyMap);
    if (!result.valid) return { valid: false, errors: [...errors, ...result.errors] };
  }
  const seen = new Set();
  for (const section of spec.sections) {
    if (/autotour:module=|[\r\n]/.test(section.heading)) fail("Section headings must be single-line text without managed-region markers.");
    if (seen.has(section.moduleId)) fail(`Duplicate documentation section for ${section.moduleId}.`);
    seen.add(section.moduleId);
    const module = journey?.modules?.find(m => m.id === section.moduleId);
    if (journey && !module) fail(`Unknown module ${section.moduleId}.`);
    if (module && (!Array.isArray(module.steps) || new Set(module.steps.map(step => step.id)).size !== module.steps.length)) {
      fail(`${section.moduleId}: journey steps must have unique IDs.`);
    }
    for (const [kind, values] of Object.entries(section.dependencies)) {
      for (const value of values) {
        if (module && (!Array.isArray(module.dependencies?.[kind]) || !module.dependencies[kind].includes(value))) {
          fail(`${section.moduleId}: dependency ${kind}:${value} is not recorded by the journey.`);
        }
        if (dependencyMap && !dependencyMap.rules?.some(rule => rule.dependencies?.[kind]?.includes(value))) {
          fail(`${section.moduleId}: dependency ${kind}:${value} has no source-file mapping.`);
        }
      }
    }
    const screenshots = new Set();
    for (const block of section.blocks) {
      if ([block.text, block.caption, block.alt, block.label].some(value => /autotour:module=/.test(value ?? ""))) {
        fail("Documentation blocks cannot contain managed-region markers.");
      }
      if (block.alt && /[\r\n]/.test(block.alt)) fail("Screenshot alt text must be a single line.");
      if (block.kind !== "screenshot") continue;
      if (screenshots.has(block.stepId)) fail(`${section.moduleId}: duplicate screenshot step ${block.stepId}.`);
      screenshots.add(block.stepId);
      if (!section.dependencies.views?.includes(block.sourceView)) fail(`${section.moduleId}: sourceView ${block.sourceView} must be a section view dependency.`);
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
  const [journey, dependencyMap] = await Promise.all([
    readJsonReference(specPath, spec.journey), readJsonReference(specPath, spec.dependencyMap)
  ]);
  const result = await validateDocumentationSpec(spec, { journey, dependencyMap });
  if (!result.valid) throw new Error(`Documentation references are invalid: ${JSON.stringify(result.errors)}`);
  return { spec, journey, dependencyMap, specPath };
}

async function readJsonReference(specPath, reference) {
  if (typeof reference === "object") return structuredClone(reference);
  if (path.isAbsolute(reference) || /^[a-z][a-z0-9+.-]*:/i.test(reference)) throw new Error("Documentation references must be relative file paths.");
  return JSON.parse(await readFile(path.resolve(path.dirname(specPath), reference), "utf8"));
}

export async function prepareDocumentationCapture({ spec, journey, dependencyMap }) {
  if (!journey || !dependencyMap) throw new Error("Documentation capture requires both journey and dependencyMap.");
  const result = await validateDocumentationSpec(spec, { journey, dependencyMap });
  if (!result.valid) throw new Error(`Cannot prepare documentation capture: ${JSON.stringify(result.errors)}`);
  const prepared = structuredClone(journey);
  for (const section of spec.sections) {
    const module = prepared.modules.find(m => m.id === section.moduleId);
    for (const block of section.blocks.filter(b => b.kind === "screenshot")) {
      const step = module.steps.find(s => s.id === block.stepId);
      step.annotation = {
        ...step.annotation,
        caption: block.caption,
        callout: block.callout ?? 1,
        timing: block.timing,
        ...(block.target ? { target: block.target } : {})
      };
    }
  }
  return { journey: prepared, recordScreenshots: { viewport: spec.viewport ?? { width: 1280, height: 720 } } };
}
