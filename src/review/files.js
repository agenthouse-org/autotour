import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const digest = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
export const readJson = async file => JSON.parse(await readFile(file, "utf8"));
export const html = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function within(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Reject junctions/symlinks in generated destinations, including their ancestors.
export async function safePath(root, relative = "") {
  const file = path.resolve(root, relative);
  if (!within(root, file)) throw new Error("Path escapes the approved folder.");
  let current = file;
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Symlinked output paths are not supported; choose a direct folder."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return file;
}

export async function saveJson(file, value) {
  await safePath(path.dirname(file), path.basename(file));
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  await rename(temporary, file);
}

export async function filesIn(root, relative = "") {
  const directory = await safePath(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Captured assets must not be symlinks.");
    if (entry.isDirectory()) files.push(...await filesIn(root, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

export async function copyTree(source, destination) {
  for (const name of await filesIn(source)) {
    const target = await safePath(destination, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(await safePath(source, name)), { flag: "wx" });
  }
}
