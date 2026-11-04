import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const manifests = [
  "plugin.json",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json"
];

for (const manifest of manifests) {
  const value = JSON.parse(await readFile(path.join(root, manifest), "utf8"));
  if (value.name !== packageJson.name || value.version !== packageJson.version) {
    throw new Error(`${manifest} identity does not match package.json`);
  }
}

const marketplace = JSON.parse(await readFile(path.join(root, ".claude-plugin/marketplace.json"), "utf8"));
const listed = marketplace.plugins?.find(plugin => plugin.name === packageJson.name);
if (!listed || listed.version !== packageJson.version) {
  throw new Error(`.claude-plugin/marketplace.json version does not match package.json (${listed?.version ?? "missing"} != ${packageJson.version})`);
}

if (packageJson.license !== "MIT" || !packageJson.bin?.autotour) {
  throw new Error("package.json is missing required license or executable metadata");
}

console.log(`Package metadata is consistent for ${packageJson.name}@${packageJson.version}.`);
