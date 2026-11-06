import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateDocumentationSpec } from "./spec.js";

export async function checkTranslationLinks(spec, specPath) {
  if (!spec.translations?.length) return;
  const current = path.resolve(specPath);
  for (const item of spec.translations) {
    const otherPath = path.resolve(path.dirname(current), item.spec);
    const other = await readTranslationSpec(item, otherPath);
    const shape = await validateDocumentationSpec(other);
    if (!shape.valid) throw new Error(`Translation ${item.language} specification is invalid: ${JSON.stringify(shape.errors)}`);
    if (other.language !== item.language) throw new Error(`Translation ${item.language} points at a specification whose language is ${other.language ?? "missing"}.`);
    const back = (other.translations ?? []).find(candidate => candidate.language === spec.language && path.resolve(path.dirname(otherPath), candidate.spec) === current);
    if (!back) throw new Error(`Translation ${item.language} does not point back at this ${spec.language} specification.`);
  }
}

/** Links to every language of this manual, the current one first. Empty without translations. */
export async function languageLinks({ spec, specPath, outputRoot, currentHtmlPath }) {
  if (!spec.translations?.length) return [];
  if (!specPath) throw new Error("A language switch needs the documentation specification path.");
  await checkTranslationLinks(spec, specPath);
  const links = [{
    language: spec.language,
    label: spec.languageLabel || spec.language,
    href: portable(path.relative(path.dirname(currentHtmlPath), currentHtmlPath)),
    current: true
  }];
  for (const item of spec.translations) {
    const otherPath = path.resolve(path.dirname(specPath), item.spec);
    const other = await readTranslationSpec(item, otherPath);
    const otherHtml = other.targets?.find(target => target.kind === "html")?.path;
    if (!otherHtml) throw new Error(`Translation ${item.language} has no HTML target to link.`);
    const destination = resolveOutput(outputRoot, otherHtml);
    if (destination === currentHtmlPath) throw new Error("Each language needs its own HTML file.");
    links.push({
      language: item.language,
      label: item.label,
      href: portable(path.relative(path.dirname(currentHtmlPath), destination)),
      current: false
    });
  }
  return links;
}

async function readTranslationSpec(item, otherPath) {
  try {
    return JSON.parse(await readFile(otherPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Translation ${item.language} specification is not valid JSON: ${item.spec}`);
    throw new Error(`Translation ${item.language} specification could not be read: ${item.spec}`);
  }
}

function resolveOutput(root, targetPath) {
  const destination = path.resolve(root, targetPath);
  const relative = path.relative(root, destination);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Documentation target escapes the chosen output folder; ask the user and configure that destination first.");
  }
  return destination;
}

function portable(value) {
  return value.split(path.sep).join("/");
}
