import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateDocumentationSpec } from "./spec.js";

export async function generateDocumentation({ spec, specPath, walkthrough, walkthroughFile, targets, outputRoot, mode = "create" }) {
  const validation = await validateDocumentationSpec(spec, { journey: walkthrough });
  if (!validation.valid) throw new Error(`Cannot generate documentation: ${JSON.stringify(validation.errors)}`);
  const selected = (targets?.length ? targetList(spec).filter(target => targets.includes(target.kind)) : targetList(spec));
  if (!selected.length) throw new Error("No documentation targets were selected.");
  const manifestFile = walkthroughFile ? path.resolve(walkthroughFile) : (specPath ? path.resolve(specPath) : process.cwd());
  const manifestDir = path.dirname(manifestFile);
  const root = path.resolve(outputRoot ?? manifestDir);
  const results = [];
  for (const target of selected) {
    if (target.kind === "markdown") results.push(await generateMarkdown({ spec, walkthrough, target, manifestDir, root, mode }));
    else if (target.kind === "html") results.push(await generateHtml({ spec, walkthrough, target, manifestDir, root, mode }));
    else results.push(await generateConfluencePlan({ spec, target, root }));
  }
  return { mode, targets: results };
}

function targetList(spec) {
  return spec.targets ?? (spec.destination ? [spec.destination] : []);
}

async function generateMarkdown({ spec, walkthrough, target, manifestDir, root, mode }) {
  const destination = resolveTarget(root, target.path);
  const assetsDir = path.join(path.dirname(destination), "assets", "autotour", walkthrough.id);
  const generated = [];
  for (const section of spec.sections) {
    generated.push({
      moduleId: section.moduleId,
      content: [`## ${escapeMarkdown(section.heading)}`, `<!-- autotour:module=${section.moduleId}:start -->`, ...await renderBlocks({ section, walkthrough, manifestDir, assetsDir, documentDir: path.dirname(destination), format: "markdown" }), `<!-- autotour:module=${section.moduleId}:end -->`].join("\n")
    });
  }
  const existing = mode === "adapt" && await exists(destination) ? await readFile(destination, "utf8") : undefined;
  const body = existing ? adaptMarkdown(existing, generated) : [`# ${escapeMarkdown(spec.title ?? walkthrough.title ?? walkthrough.id)}`, "", ...generated.map(item => item.content)].join("\n\n");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${body.trim()}\n`, "utf8");
  return { kind: "markdown", path: destination, mode, assetsDir };
}

async function generateHtml({ spec, walkthrough, target, manifestDir, root, mode }) {
  const destination = resolveTarget(root, target.path);
  const sections = [];
  for (const section of spec.sections) {
    const blocks = await renderBlocks({ section, walkthrough, manifestDir, assetsDir: path.join(path.dirname(destination), "assets"), documentDir: path.dirname(destination), format: "html" });
    sections.push(`<section id="${section.moduleId}"><h2>${escapeHtml(section.heading)}</h2>${blocks.join("\n")}</section>`);
  }
  const title = escapeHtml(spec.title ?? walkthrough.title ?? walkthrough.id);
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><header><h1>${title}</h1><nav><ol>${spec.sections.map(section => `<li><a href="#${section.moduleId}">${escapeHtml(section.heading)}</a></li>`).join("")}</ol></nav></header><main>${sections.join("\n")}</main></body></html>\n`;
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, html, "utf8");
  return { kind: "html", path: destination, mode: target.mode ?? spec.generation?.htmlMode ?? "site" };
}

async function generateConfluencePlan({ spec, target, root }) {
  const destination = resolveTarget(root, `confluence-${target.pageId}.json`);
  const plan = { kind: "confluence", siteUrl: target.siteUrl, pageId: target.pageId, sections: spec.sections.map(section => ({ moduleId: section.moduleId, heading: section.heading, blocks: section.blocks })) };
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return { kind: "confluence", path: destination, pageId: target.pageId, status: "plan-created" };
}

async function renderBlocks({ section, walkthrough, manifestDir, assetsDir, documentDir, format }) {
  const module = walkthrough.modules.find(candidate => candidate.id === section.moduleId);
  const output = [];
  for (const block of section.blocks) {
    if (block.kind === "text") output.push(format === "html" ? `<p>${escapeHtml(block.text)}</p>` : block.text);
    if (block.kind === "tour") output.push(format === "html" ? `<p><a href="${escapeHtml(block.url)}">${escapeHtml(block.label)}</a></p>` : `[${block.label}](${block.url})`);
    if (block.kind === "video") output.push(format === "html" ? `<p><a href="${escapeHtml(block.path)}">${escapeHtml(block.label)}</a></p>${block.caption ? `<p>${escapeHtml(block.caption)}</p>` : ""}` : `[${block.label}](${block.path})${block.caption ? `\n\n${block.caption}` : ""}`);
    if (block.kind !== "screenshot") continue;
    const assetPath = module.assets?.screenshots?.find(candidate => candidate.endsWith(`/${block.stepId}.png`)) ?? `modules/${module.id}/screenshots/${block.stepId}.png`;
    const source = safeResolve(manifestDir, assetPath);
    const destination = path.join(assetsDir, module.id, path.basename(source));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    const relative = portable(path.relative(documentDir, destination));
    output.push(format === "html" ? `<figure><img src="${escapeHtml(relative)}" alt="${escapeHtml(block.alt)}"><figcaption>${escapeHtml(block.caption)}</figcaption></figure>` : `![${escapeMarkdown(block.alt)}](${relative})\n\n${block.caption}`);
  }
  return output;
}

function resolveTarget(root, target) { return path.resolve(root, target); }
function adaptMarkdown(existing, generated) {
  let result = existing;
  for (const item of generated) {
    const marker = new RegExp(`<!-- autotour:module=${item.moduleId}:start -->[\\s\\S]*?<!-- autotour:module=${item.moduleId}:end -->`);
    result = marker.test(result) ? result.replace(marker, item.content) : `${result.trim()}\n\n${item.content}\n`;
  }
  return result;
}
function safeResolve(root, relative) {
  const resolved = path.resolve(root, relative);
  if (path.relative(root, resolved).startsWith("..")) throw new Error(`Documentation asset escapes its capture directory: ${relative}`);
  return resolved;
}
async function exists(file) { try { await readFile(file); return true; } catch { return false; } }
function portable(value) { return value.split(path.sep).join("/"); }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function escapeMarkdown(value) { return String(value).replace(/[\\[\]]/g, "\\$&"); }
