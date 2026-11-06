import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { readDocumentationSpec, validateDocumentationSpec } from "../spec.js";
import { buildPage, pickSettings, printPdf, resolveTarget } from "../generate.js";
import { generateLaRecipe } from "../larecipe.js";
import { escapeMarkdown, renderBlocks } from "../blocks.js";
import { resolveLabels } from "./labels.js";
import { aiDisclosureWarnings, aiLabel, sectionAiItems, sectionOrigin } from "./ai.js";

export const manualSchemaPath = fileURLToPath(new URL("../../../schemas/manual.schema.json", import.meta.url));
let validator;

/** True when a parsed JSON document is a manual file rather than a documentation specification. */
export function isManualDocument(document) {
  return Boolean(document && Array.isArray(document.languages) && Array.isArray(document.contents));
}

export async function validateManualDocument(manual) {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    validator = ajv.compile(JSON.parse(await readFile(manualSchemaPath, "utf8")));
  }
  if (!validator(manual)) return { valid: false, errors: structuredClone(validator.errors) };
  const errors = [];
  const fail = message => errors.push({ message });
  const languages = manual.languages.map(language => language.language);
  if (new Set(languages).size !== languages.length) fail("Manual languages must be unique.");
  const specKeys = new Set(Object.keys(manual.languages[0].specs));
  const partIds = manual.contents.filter(entry => entry.part).map(entry => entry.part);
  if (new Set(partIds).size !== partIds.length) fail("Each part may appear once in the contents.");
  for (const language of manual.languages) {
    const keys = Object.keys(language.specs);
    if (keys.length !== specKeys.size || keys.some(key => !specKeys.has(key))) {
      fail(`${language.language}: every language must name the same specifications (${[...specKeys].join(", ")}).`);
    }
    for (const part of partIds) {
      if (!language.parts?.[part]) fail(`${language.language}: part ${part} needs a label in parts.`);
    }
    const kinds = language.targets.map(target => target.kind);
    if (new Set(kinds).size !== kinds.length) fail(`${language.language}: targets must have unique kinds.`);
    for (const reference of Object.values(language.specs)) {
      for (const value of [reference.spec, reference.walkthrough].filter(Boolean)) {
        if (path.isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) fail(`${language.language}: ${value} must be a relative path.`);
      }
    }
  }
  for (const entry of manual.contents) {
    if (entry.spec && !specKeys.has(entry.spec)) fail(`Contents name an unknown specification ${entry.spec}.`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Read a manual, every specification it names, and the captured walkthroughs, and resolve the contents.
 * @param {string} file
 * @param {{ draft?: boolean }} [options]
 */
export async function readManual(file, { draft = false } = {}) {
  const manualPath = path.resolve(file);
  const manual = JSON.parse(await readFile(manualPath, "utf8"));
  const shape = await validateManualDocument(manual);
  if (!shape.valid) throw new Error(`Manual is invalid: ${JSON.stringify(shape.errors)}`);
  const baseDir = path.dirname(manualPath);
  const languages = [];
  for (const language of manual.languages) {
    const sources = {};
    for (const [key, reference] of Object.entries(language.specs)) {
      const loaded = await readDocumentationSpec(path.resolve(baseDir, reference.spec));
      let walkthrough;
      let manifestDir = path.dirname(loaded.specPath);
      if (reference.walkthrough) {
        const walkthroughPath = path.resolve(baseDir, reference.walkthrough);
        try {
          walkthrough = JSON.parse(await readFile(walkthroughPath, "utf8"));
          manifestDir = path.dirname(walkthroughPath);
        } catch (error) {
          if (!draft) throw new Error(`${language.language}/${key}: walkthrough ${reference.walkthrough} could not be read. Capture it with run-docs ${reference.spec} first, or build a draft with --draft.`);
        }
      } else if (!draft) {
        throw new Error(`${language.language}/${key}: no walkthrough is named. Capture ${reference.spec} with run-docs and add its walkthrough.json, or build a draft with --draft.`);
      }
      if (walkthrough) {
        const result = await validateDocumentationSpec(loaded.spec, { journey: walkthrough, openApiDocuments: loaded.openApiDocuments });
        if (!result.valid) throw new Error(`${language.language}/${key}: ${JSON.stringify(result.errors)}`);
      }
      sources[key] = {
        key,
        spec: loaded.spec,
        specPath: loaded.specPath,
        walkthrough: walkthrough ?? { ...loaded.journey, modules: (loaded.journey.modules ?? []).map(module => ({ ...module, assets: {} })) },
        manifestDir,
        specDir: path.dirname(loaded.specPath),
        openApiDocuments: loaded.openApiDocuments
      };
    }
    languages.push({ ...language, sources, items: resolveContents(manual, language, sources) });
  }
  return { manual, manualPath, baseDir, languages };
}

function resolveContents(manual, language, sources) {
  const items = [];
  const used = new Map();
  const anchors = new Set();
  for (const entry of manual.contents) {
    if (entry.part) {
      const anchor = `part-${entry.part}`;
      items.push({ kind: "part", anchor, label: language.parts[entry.part] });
      anchors.add(anchor);
      continue;
    }
    const source = sources[entry.spec];
    const sections = entry.section
      ? [source.spec.sections.find(section => section.moduleId === entry.section)]
      : source.spec.sections;
    if (entry.section && !sections[0]) throw new Error(`${language.language}: ${entry.spec} has no section ${entry.section}.`);
    if (entry.anchor && sections.length !== 1) throw new Error(`${language.language}: anchor ${entry.anchor} needs a single section.`);
    for (const section of sections) {
      const id = `${entry.spec}/${section.moduleId}`;
      if (used.has(id)) throw new Error(`${language.language}: section ${id} appears twice in the contents.`);
      used.set(id, true);
      const anchor = entry.anchor ?? section.moduleId;
      if (anchors.has(anchor)) throw new Error(`${language.language}: anchor ${anchor} is used twice. Set "anchor" on the contents entry for ${id}.`);
      anchors.add(anchor);
      items.push({ kind: "section", anchor, section, source });
    }
  }
  return items;
}

/** Warnings about a loaded manual: AI disclosure, unused sections, missing navigation choice. */
export function manualWarnings(loaded, presentation = {}) {
  const warnings = [];
  const first = loaded.languages[0];
  for (const language of loaded.languages) {
    const sections = language.items.filter(item => item.kind === "section").map(item => item.section);
    warnings.push(...aiDisclosureWarnings({ sections, aiDisclosure: loaded.manual.aiDisclosure, where: `${loaded.manual.id} (${language.language})` }));
  }
  for (const [key, source] of Object.entries(first.sources)) {
    const used = new Set(first.items.filter(item => item.source === source).map(item => item.section.moduleId));
    const unused = source.spec.sections.filter(section => !used.has(section.moduleId)).map(section => section.moduleId);
    if (unused.length) warnings.push(`${loaded.manual.id}: sections of ${key} not in the manual: ${unused.join(", ")}.`);
  }
  if (loaded.languages.some(language => language.targets.some(target => target.kind === "html")) && !loaded.manual.navigation && !presentation.navigation) {
    warnings.push(`${loaded.manual.id}: no navigation flavour was chosen, so the HTML uses "sidebar". Ask the author (sidebar, topbar, minimal) and save it with autotour configure-presentation --navigation <flavour>.`);
  }
  return [...new Set(warnings)];
}

/**
 * Generate every target of every language of a manual.
 * @param {object} options
 * @param {string} options.manualFile
 * @param {string} options.outputRoot
 * @param {string[]} [options.targets] target kinds to build
 * @param {string[]} [options.languages] languages to build
 * @param {boolean} [options.draft]
 * @param {object} [options.presentation] project defaults
 */
export async function generateManual({ manualFile, outputRoot, targets, languages: only, draft = false, presentation = {} }) {
  const loaded = await readManual(manualFile, { draft });
  const root = path.resolve(outputRoot ?? ".autotour/output/documentation");
  const settings = { numbering: true, ...presentation, ...pickSettings(loaded.manual) };
  for (const language of loaded.languages) {
    for (const target of language.targets) if (target.path) resolveTarget(root, target.path);
  }
  const htmlPaths = Object.fromEntries(loaded.languages.map(language => [language.language, language.targets.find(target => target.kind === "html")?.path]).filter(([, value]) => value));
  const results = [];
  for (const language of loaded.languages) {
    if (only?.length && !only.includes(language.language)) continue;
    const labels = resolveLabels(language.language, language.labels);
    for (const target of language.targets) {
      if (targets?.length && !targets.includes(target.kind)) continue;
      const destination = resolveTarget(root, target.path);
      if (target.kind === "html") {
        const links = Object.keys(htmlPaths).length > 1
          ? loaded.manual.languages.filter(other => htmlPaths[other.language]).map(other => ({
            language: other.language,
            label: other.label,
            href: path.relative(path.dirname(destination), resolveTarget(root, htmlPaths[other.language])).split(path.sep).join("/"),
            current: other.language === language.language
          })).sort((a, b) => Number(b.current) - Number(a.current))
          : [];
        const htmlMode = target.mode ?? "site";
        const page = await buildPage({ title: language.title, language: language.language, labels, items: language.items, settings, destination, embedImages: htmlMode === "single-file", draft, brandingDir: loaded.baseDir, languages: links });
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, page, "utf8");
        results.push({ kind: "html", language: language.language, path: destination, mode: htmlMode });
      } else if (target.kind === "pdf") {
        const pdf = await printPdf({ title: language.title, language: language.language, labels, items: language.items, settings, destination, draft, brandingDir: loaded.baseDir });
        await writeFile(destination, pdf);
        results.push({ kind: "pdf", language: language.language, path: destination });
      } else if (target.kind === "markdown") {
        await writeManualMarkdown({ language, labels, settings, destination, draft });
        results.push({ kind: "markdown", language: language.language, path: destination });
      } else if (target.kind === "larecipe") {
        results.push({ language: language.language, ...await generateLaRecipe({ target, root, labels, items: language.items, title: language.title, numbering: settings.numbering, aiPlacement: settings.aiDisclosure?.placement ?? "none", draft }) });
      }
    }
  }
  const warnings = manualWarnings(loaded, presentation);
  return { manual: loaded.manual.id, targets: results, ...(warnings.length ? { warnings } : {}) };
}

async function writeManualMarkdown({ language, labels, settings, destination, draft }) {
  const placement = settings.aiDisclosure?.placement ?? "none";
  const assetsDir = path.join(path.dirname(destination), "assets");
  const lines = [`# ${escapeMarkdown(language.title)}`];
  const aiSections = [];
  for (const item of language.items) {
    if (item.kind === "part") {
      lines.push(`---\n\n**${escapeMarkdown(item.label)}**`);
      continue;
    }
    const { section, source } = item;
    const origin = sectionOrigin(section);
    if (origin) aiSections.push(item);
    const badge = origin && placement === "chapter" ? ` *(${aiLabel(origin, labels)})*` : "";
    const blocks = await renderBlocks({ section, walkthrough: source.walkthrough, manifestDir: source.manifestDir, specDir: source.specDir, assetsDir, documentDir: path.dirname(destination), format: "markdown", draft, openApiDocuments: source.openApiDocuments, labels, aiPlacement: placement });
    lines.push(`<a id="${item.anchor}"></a>\n\n${"#".repeat(section.headingLevel ?? 2)} ${escapeMarkdown(section.heading)}${badge}`, ...blocks);
  }
  if (aiSections.length && placement !== "none") lines.splice(1, 0, `*${labels.aiNote}*`);
  if (aiSections.length && placement === "document") {
    lines.push(`## ${escapeMarkdown(labels.aiSection)}`, labels.aiSectionIntro, aiSections.map(item => `- [${escapeMarkdown(item.section.heading)}](#${item.anchor}): ${sectionAiItems(item.section, labels).map(entry => `${entry.kind} (${entry.label})`).join(", ")}`).join("\n"));
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${lines.join("\n\n").trim()}\n`, "utf8");
}
