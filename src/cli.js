import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeProject, validateWalkthrough } from "./project.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));

const help = `AutoTour ${packageJson.version}

Usage:
  autotour init [directory] [--force]
  autotour validate <walkthrough.json>
  autotour doctor
  autotour --version

Commands:
  init      Create .autotour/autotour.json in a project
  validate  Validate a walkthrough manifest
  doctor    Check the local Node.js and Playwright installation
`;

function parseInitArgs(args) {
  return {
    directory: args.find((arg) => !arg.startsWith("-")) ?? process.cwd(),
    force: args.includes("--force")
  };
}

async function doctor() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  const checks = [{ name: "Node.js >= 20", ok: major >= 20, detail: process.version }];

  try {
    const playwright = await import("playwright");
    checks.push({ name: "Playwright", ok: Boolean(playwright.chromium), detail: "installed" });
  } catch (error) {
    checks.push({ name: "Playwright", ok: false, detail: error.message });
  }

  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "not ok"} - ${check.name} (${check.detail})`);
  }
  return checks.every((check) => check.ok) ? 0 : 1;
}

export async function run(args) {
  const [command, ...rest] = args;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(help);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(packageJson.version);
    return 0;
  }
  if (command === "doctor") return doctor();

  if (command === "init") {
    const options = parseInitArgs(rest);
    try {
      const configPath = await initializeProject(options.directory, options);
      console.log(`Created ${configPath}`);
      return 0;
    } catch (error) {
      if (error.code === "EEXIST") {
        console.error("AutoTour is already initialized. Use --force to replace its project configuration.");
        return 1;
      }
      throw error;
    }
  }

  if (command === "validate") {
    const file = rest[0];
    if (!file) {
      console.error("Usage: autotour validate <walkthrough.json>");
      return 1;
    }
    const result = await validateWalkthrough(path.resolve(file));
    if (result.valid) {
      console.log(`${file} is valid.`);
      return 0;
    }
    console.error(JSON.stringify(result.errors, null, 2));
    return 1;
  }

  console.error(`Unknown command: ${command}\n\n${help}`);
  return 1;
}
