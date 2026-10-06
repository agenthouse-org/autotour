import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

let recorderBundlePromise;

export function loadRecorderBundle() {
  if (!recorderBundlePromise) {
    const entry = fileURLToPath(import.meta.resolve("@rrweb/record"));
    const bundlePath = path.join(path.dirname(entry), "record.umd.min.cjs");
    recorderBundlePromise = readFile(bundlePath, "utf8");
  }
  return recorderBundlePromise;
}

export async function ensureReplayRuntime(outputDir) {
  const replayEntry = fileURLToPath(import.meta.resolve("@rrweb/replay"));
  const replayDirectory = path.dirname(replayEntry);
  const licenseSource = path.join(path.dirname(fileURLToPath(import.meta.url)), "rrweb-license.txt");
  const runtimeDirectory = path.join(outputDir, "runtime");
  const scriptPath = path.join(runtimeDirectory, "rrweb-replay.js");
  const stylePath = path.join(runtimeDirectory, "rrweb-replay.css");
  const licensePath = path.join(runtimeDirectory, "rrweb-LICENSE.txt");

  await mkdir(runtimeDirectory, { recursive: true });
  await copyFile(path.join(replayDirectory, "replay.umd.min.cjs"), scriptPath);
  await copyFile(path.join(replayDirectory, "style.min.css"), stylePath);
  await copyFile(licenseSource, licensePath);

  return { scriptPath, stylePath, licensePath };
}

