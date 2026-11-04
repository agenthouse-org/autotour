import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Compare dotted numeric versions. Pre-release suffixes are ignored.
 * @param {string} left
 * @param {string} right
 * @returns {-1 | 0 | 1}
 */
export function compareSemver(left, right) {
  const parse = (value) => String(value).replace(/^v/, "").split("-")[0].split(".").map(part => {
    const number = Number.parseInt(part, 10);
    return Number.isInteger(number) ? number : 0;
  });
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * @param {object} manifest
 * @returns {string | undefined}
 */
export function declaredAutotourVersion(manifest) {
  if (!manifest || typeof manifest !== "object") return undefined;
  const range = manifest.dependencies?.autotour ?? manifest.devDependencies?.autotour;
  if (typeof range === "string") {
    const match = range.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
    if (match) return match[1];
  }
  if (manifest.name === "autotour" && typeof manifest.version === "string") return manifest.version;
  return undefined;
}

/**
 * Prefer the installed package over a declared range.
 * @param {string} cwd
 */
export async function readProjectAutotourVersion(cwd) {
  try {
    const installed = JSON.parse(await readFile(path.join(cwd, "node_modules", "autotour", "package.json"), "utf8"));
    if (installed?.name === "autotour" && typeof installed.version === "string") {
      return { version: installed.version, source: "installed" };
    }
  } catch {
    // The project may declare autotour without installing it.
  }
  try {
    const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
    const version = declaredAutotourVersion(manifest);
    if (!version) return undefined;
    return { version, source: manifest.name === "autotour" ? "package" : "declared" };
  } catch {
    return undefined;
  }
}

/**
 * @param {{ cliVersion: string, project?: { version: string, source: string } }} options
 */
export function packageVersionCheck({ cliVersion, project }) {
  if (!project?.version) {
    return { name: "Project autotour package", ok: true, advisory: false, detail: "no project package found" };
  }
  if (project.source === "package" || compareSemver(project.version, cliVersion) >= 0) {
    return { name: "Project autotour package", ok: true, advisory: false, detail: project.version };
  }
  return {
    name: "Project autotour package",
    ok: true,
    advisory: true,
    detail: `${project.version} is older than this CLI ${cliVersion}. Capture still runs; the skill may describe behavior this package does not have.`
  };
}
