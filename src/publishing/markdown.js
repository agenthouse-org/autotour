import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { validateWalkthroughDocument } from "../capture/index.js";
import { validateDocumentationSpec } from "../documentation/spec.js";

const MARKER = /^[\t ]*<!--[\t ]*autotour:module=([a-z0-9]+(?:-[a-z0-9]+)*):(start|end)[\t ]*-->[\t ]*$/;

export class PublishingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PublishingError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Synchronize publish-enabled walkthrough screenshots into managed Markdown regions.
 * @param {object} options
 * @param {object} options.walkthrough
 * @param {string} options.walkthroughFile
 * @param {string} options.markdownFile
 * @param {string} options.assetsDir
 * @param {boolean} [options.dryRun]
 */
export async function syncMarkdownScreenshots({
  walkthrough,
  walkthroughFile,
  markdownFile,
  assetsDir,
  dryRun = false,
  documentationSpec
}) {
  const validation = await validateWalkthroughDocument(walkthrough);
  if (!validation.valid) {
    throw new PublishingError(
      "AUTOTOUR_INVALID_WALKTHROUGH",
      `Walkthrough is invalid: ${JSON.stringify(validation.errors)}`
    );
  }
  if (walkthrough.publish !== true) {
    throw new PublishingError(
      "AUTOTOUR_NOT_PUBLISHABLE",
      "Walkthrough publish must be true before documentation can be updated."
    );
  }
  if (documentationSpec) {
    const specValidation = await validateDocumentationSpec(documentationSpec, { journey: walkthrough });
    if (!specValidation.valid) throw new PublishingError("AUTOTOUR_INVALID_DOCUMENTATION", JSON.stringify(specValidation.errors));
    if (documentationSpec.destination?.kind === "confluence") {
      throw new PublishingError("AUTOTOUR_INVALID_DOCUMENTATION", "Confluence specifications must be published through connected tools, not sync-markdown.");
    }
  }

  const resolvedWalkthroughFile = path.resolve(walkthroughFile);
  const resolvedMarkdownFile = path.resolve(markdownFile);
  const resolvedAssetsDir = path.resolve(assetsDir);
  const manifestDir = path.dirname(resolvedWalkthroughFile);
  const markdown = await readFile(resolvedMarkdownFile, "utf8");
  const modules = new Map(walkthrough.modules.map((module) => [module.id, module]));
  const regions = parseManagedRegions(markdown, modules, { requireScreenshots: !documentationSpec });
  if (documentationSpec && (documentationSpec.sections.length !== regions.length ||
      documentationSpec.sections.some((section, index) => section.moduleId !== regions[index]))) {
    throw new PublishingError("AUTOTOUR_INVALID_DOCUMENTATION", "Specification sections must match the Markdown managed regions exactly.");
  }
  const assetPlan = await buildAssetPlan({
    walkthrough,
    manifestDir,
    markdownFile: resolvedMarkdownFile,
    assetsDir: resolvedAssetsDir,
    regions,
    documentationSpec
  });
  const linksByModule = new Map();
  for (const asset of assetPlan) {
    const links = linksByModule.get(asset.moduleId) ?? [];
    links.push(asset.markdown);
    linksByModule.set(asset.moduleId, links);
  }
  if (documentationSpec) {
    for (const section of documentationSpec.sections) {
      const blocks = [`## ${escapeAlt(section.heading)}`];
      for (const block of section.blocks) {
        if (block.kind === "text") blocks.push(block.text);
        else if (block.kind === "tour") blocks.push(`[${escapeAlt(block.label)}](<${block.url.replaceAll(">", "%3E").replaceAll("<", "%3C")}>)`);
        else {
          const asset = assetPlan.find(item => item.moduleId === section.moduleId && item.stepId === block.stepId);
          blocks.push(asset.markdown, block.caption);
        }
      }
      linksByModule.set(section.moduleId, [blocks.join("\n\n")]);
    }
  }
  const renderedMarkdown = renderManagedRegions(markdown, linksByModule);
  const markdownChanged = renderedMarkdown !== markdown;
  const changed = markdownChanged || assetPlan.some((asset) => asset.changed);

  if (!dryRun) {
    for (const asset of assetPlan) {
      if (!asset.changed) continue;
      await mkdir(path.dirname(asset.destination), { recursive: true });
      await copyFile(asset.source, asset.destination);
    }
    if (markdownChanged) await replaceFile(resolvedMarkdownFile, renderedMarkdown);
  }

  return {
    status: changed ? "changed" : "unchanged",
    changed,
    dryRun,
    markdownFile: resolvedMarkdownFile,
    renderedMarkdown,
    modules: regions,
    assets: assetPlan.map(({ source, destination, moduleId, changed: assetChanged }) => ({
      moduleId,
      source,
      destination,
      changed: assetChanged
    }))
  };
}

export function parseManagedRegions(markdown, modules, { requireScreenshots = true } = {}) {
  const lines = markdown.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  const seen = new Set();
  const regions = [];
  let active;

  for (const line of lines) {
    const body = line.replace(/(?:\r\n|\n|\r)$/, "");
    const marker = MARKER.exec(body);
    if (!marker) {
      if (body.includes("autotour:module=")) {
        throw new PublishingError("AUTOTOUR_INVALID_MARKER", `Malformed AutoTour marker: ${body.trim()}`);
      }
      continue;
    }
    const [, moduleId, boundary] = marker;
    if (boundary === "start") {
      if (active) {
        throw new PublishingError(
          "AUTOTOUR_NESTED_MARKER",
          `Module ${moduleId} starts inside module ${active}.`
        );
      }
      if (seen.has(moduleId)) {
        throw new PublishingError(
          "AUTOTOUR_DUPLICATE_MARKER",
          `Module ${moduleId} has more than one managed region.`
        );
      }
      requirePublishableModule(modules, moduleId, requireScreenshots);
      active = moduleId;
      seen.add(moduleId);
    } else {
      if (!active || active !== moduleId) {
        throw new PublishingError(
          "AUTOTOUR_UNPAIRED_MARKER",
          `End marker for module ${moduleId} has no matching start marker.`
        );
      }
      regions.push(moduleId);
      active = undefined;
    }
  }
  if (active) {
    throw new PublishingError(
      "AUTOTOUR_UNPAIRED_MARKER",
      `Start marker for module ${active} has no matching end marker.`
    );
  }
  if (regions.length === 0) {
    throw new PublishingError("AUTOTOUR_NO_MARKERS", "Markdown contains no AutoTour module regions.");
  }
  return regions;
}

function requirePublishableModule(modules, moduleId, requireScreenshots) {
  const module = modules.get(moduleId);
  if (!module) {
    throw new PublishingError("AUTOTOUR_UNKNOWN_MODULE", `Unknown walkthrough module: ${moduleId}`);
  }
  if (module.publish !== true) {
    throw new PublishingError(
      "AUTOTOUR_NOT_PUBLISHABLE",
      `Module ${moduleId} publish must be true before documentation can be updated.`
    );
  }
  if (requireScreenshots && !module.assets?.screenshots?.length) {
    throw new PublishingError(
      "AUTOTOUR_MISSING_SCREENSHOTS",
      `Module ${moduleId} has no screenshot assets.`
    );
  }
  return module;
}

async function buildAssetPlan({ walkthrough, manifestDir, markdownFile, assetsDir, regions, documentationSpec }) {
  const realManifestDir = await realpath(manifestDir);
  const plan = [];
  for (const moduleId of regions) {
    const module = walkthrough.modules.find((candidate) => candidate.id === moduleId);
    const screenshotBlocks = documentationSpec?.sections.find(section => section.moduleId === moduleId).blocks.filter(block => block.kind === "screenshot");
    const selected = screenshotBlocks
      ? screenshotBlocks.map(block => {
        const assetPath = `modules/${moduleId}/screenshots/${block.stepId}.png`;
        if (!module.assets.screenshots?.includes(assetPath)) {
          throw new PublishingError("AUTOTOUR_MISSING_SCREENSHOTS", `No captured screenshot for ${moduleId}/${block.stepId}.`);
        }
        return { assetPath, block };
      })
      : module.assets.screenshots.map(assetPath => ({ assetPath }));
    for (const [index, { assetPath, block }] of selected.entries()) {
      const source = await resolveSourceAsset(realManifestDir, assetPath, moduleId);
      const filename = `${String(index + 1).padStart(2, "0")}-${path.basename(source)}`;
      const destination = path.join(assetsDir, walkthrough.id, moduleId, filename);
      await validateDestinationPath(assetsDir, destination, moduleId);
      const relative = toPortablePath(path.relative(path.dirname(markdownFile), destination));
      const alt = block?.alt ?? (module.assets.screenshots.length === 1
        ? module.title
        : `${module.title} ${index + 1}`);
      plan.push({
        moduleId,
        stepId: block?.stepId,
        source,
        destination,
        markdown: `![${escapeAlt(alt)}](${encodeMarkdownPath(relative)})`,
        changed: await filesDiffer(source, destination)
      });
    }
  }
  return plan;
}

async function validateDestinationPath(assetsDir, destination, moduleId) {
  if (!isInside(assetsDir, destination)) {
    throw new PublishingError(
      "AUTOTOUR_UNSAFE_DESTINATION",
      `Module ${moduleId} destination escapes the selected assets directory.`
    );
  }
  const relativeParts = path.relative(assetsDir, destination).split(path.sep);
  let current = assetsDir;
  for (const [index, part] of relativeParts.entries()) {
    current = path.join(current, part);
    try {
      const entry = await lstat(current);
      const isDestination = index === relativeParts.length - 1;
      if (entry.isSymbolicLink() || (isDestination ? !entry.isFile() : !entry.isDirectory())) {
        throw new PublishingError(
          "AUTOTOUR_UNSAFE_DESTINATION",
          `Module ${moduleId} destination contains a symbolic link or incompatible entry: ${current}`
        );
      }
    } catch (error) {
      if (error instanceof PublishingError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function resolveSourceAsset(manifestDir, assetPath, moduleId) {
  if (path.isAbsolute(assetPath) || /^[a-z][a-z0-9+.-]*:/i.test(assetPath)) {
    throw new PublishingError(
      "AUTOTOUR_UNSAFE_ASSET_PATH",
      `Module ${moduleId} screenshot must be a relative local path: ${assetPath}`
    );
  }
  const candidate = path.resolve(manifestDir, assetPath);
  if (!isInside(manifestDir, candidate)) {
    throw new PublishingError(
      "AUTOTOUR_UNSAFE_ASSET_PATH",
      `Module ${moduleId} screenshot escapes the walkthrough directory: ${assetPath}`
    );
  }
  try {
    const [realSource, sourceStat] = await Promise.all([realpath(candidate), stat(candidate)]);
    if (!isInside(manifestDir, realSource) || !sourceStat.isFile()) throw new Error("not a contained file");
    return realSource;
  } catch {
    throw new PublishingError(
      "AUTOTOUR_MISSING_ASSET",
      `Module ${moduleId} screenshot is missing or not a safe file: ${assetPath}`
    );
  }
}

function renderManagedRegions(markdown, linksByModule) {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  const rendered = [];
  let active;
  for (const line of lines) {
    const body = line.replace(/(?:\r\n|\n|\r)$/, "");
    const marker = MARKER.exec(body);
    if (marker?.[2] === "start") {
      active = marker[1];
      rendered.push(line.endsWith("\n") || line.endsWith("\r") ? line : `${line}${eol}`);
      continue;
    }
    if (marker?.[2] === "end") {
      for (const link of linksByModule.get(active) ?? []) rendered.push(`${link}${eol}`);
      rendered.push(line);
      active = undefined;
      continue;
    }
    if (!active) rendered.push(line);
  }
  return rendered.join("");
}

async function filesDiffer(source, destination) {
  try {
    const destinationStat = await lstat(destination);
    if (!destinationStat.isFile()) return true;
    const [sourceBytes, destinationBytes] = await Promise.all([
      readFile(source),
      readFile(destination)
    ]);
    return !sourceBytes.equals(destinationBytes);
  } catch {
    return true;
  }
}

async function replaceFile(file, contents) {
  const temporary = `${file}.autotour-${process.pid}.tmp`;
  try {
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

function encodeMarkdownPath(value) {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function escapeAlt(value) {
  return value.replace(/[\\\[\]]/g, "\\$&");
}
