import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeProject, validateWalkthrough } from "./project.js";
import {
  collectGitChangedFiles,
  createInvalidationPlan,
  readJsonDocument,
  validateDependencyMapDocument,
  writeInvalidationPlan
} from "./invalidation/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));

const help = `AutoTour ${packageJson.version}

Usage:
  autotour init [directory] [--force]
  autotour validate <walkthrough.json>
  autotour invalidate <walkthrough.json> --map <dependency-map.json> (--changed-file <path>... | --base <ref> [--head <ref>]) [--output <plan.json>]
  autotour doctor
  autotour --version

Commands:
  init      Create .autotour/autotour.json in a project
  validate  Validate a walkthrough manifest
  invalidate  Identify modules affected by repository changes
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

  if (command === "invalidate") {
    try {
      return await invalidate(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  console.error(`Unknown command: ${command}\n\n${help}`);
  return 1;
}

async function invalidate(args) {
  const options = parseInvalidateArgs(args);
  const walkthroughValidation = await validateWalkthrough(options.walkthroughFile);
  if (!walkthroughValidation.valid) {
    throw new Error(`Walkthrough is invalid: ${JSON.stringify(walkthroughValidation.errors)}`);
  }
  const [walkthrough, dependencyMap] = await Promise.all([
    readJsonDocument(options.walkthroughFile),
    readJsonDocument(options.mapFile)
  ]);
  const mapValidation = await validateDependencyMapDocument(dependencyMap);
  if (!mapValidation.valid) {
    throw new Error(`Dependency map is invalid: ${JSON.stringify(mapValidation.errors)}`);
  }
  const changedFiles = options.changedFiles.length > 0
    ? options.changedFiles
    : await collectGitChangedFiles({
      cwd: process.cwd(),
      base: options.base,
      head: options.head
    });
  const plan = createInvalidationPlan({ walkthrough, dependencyMap, changedFiles });
  if (options.outputFile) await writeInvalidationPlan(options.outputFile, plan);
  console.log(JSON.stringify(plan, null, 2));
  return plan.reviewRequired ? 2 : 0;
}

function parseInvalidateArgs(args) {
  let walkthroughFile;
  let mapFile;
  let outputFile;
  let base;
  let head = "HEAD";
  const changedFiles = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--map") mapFile = requireOptionValue(args, ++index, argument);
    else if (argument === "--output") outputFile = requireOptionValue(args, ++index, argument);
    else if (argument === "--base") base = requireOptionValue(args, ++index, argument);
    else if (argument === "--head") head = requireOptionValue(args, ++index, argument);
    else if (argument === "--changed-file") {
      changedFiles.push(requireOptionValue(args, ++index, argument));
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown invalidate option: ${argument}`);
    } else if (!walkthroughFile) {
      walkthroughFile = path.resolve(argument);
    } else {
      throw new Error(`Unexpected invalidate argument: ${argument}`);
    }
  }

  if (!walkthroughFile || !mapFile) {
    throw new Error("invalidate requires a walkthrough file and --map");
  }
  if ((changedFiles.length > 0) === Boolean(base)) {
    throw new Error("invalidate requires either --changed-file or --base, but not both");
  }
  return {
    walkthroughFile,
    mapFile: path.resolve(mapFile),
    outputFile: outputFile ? path.resolve(outputFile) : undefined,
    changedFiles,
    base,
    head
  };
}

function requireOptionValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}
