import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(packageRoot, "schemas", "walkthrough.schema.json");

export function createProjectConfig(projectName = path.basename(process.cwd())) {
  return {
    $schema: "../node_modules/autotour/schemas/project.schema.json",
    schemaVersion: 1,
    project: projectName,
    walkthroughs: ".autotour/walkthroughs",
    documentation: ".autotour/documentation.json",
    output: ".autotour/output",
    storage: { confirmed: false },
    auth: {
      usernameEnv: "AUTOTOUR_USERNAME",
      passwordEnv: "AUTOTOUR_PASSWORD"
    },
    publish: {
      default: false
    }
  };
}

export async function initializeProject(directory, { force = false } = {}) {
  const root = path.resolve(directory);
  const configDirectory = path.join(root, ".autotour");
  const walkthroughDirectory = path.join(configDirectory, "walkthroughs");
  const configPath = path.join(configDirectory, "autotour.json");

  await mkdir(walkthroughDirectory, { recursive: true });
  const config = createProjectConfig(path.basename(root));
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    flag: force ? "w" : "wx"
  });
  return configPath;
}

// Only call after the user has chosen both destinations and the Git policy.
export async function configureStorage(directory, choices) {
  const root = path.resolve(directory);
  const configPath = await projectConfigPath(root);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  for (const key of ["output", "documentationOutput"]) {
    if (typeof choices[key] !== "string" || !choices[key].trim()) throw new Error(`Storage choice ${key} is required`);
    if (/[\r\n\0]/.test(choices[key])) throw new Error(`${key} contains invalid path characters`);
    if (path.resolve(root, choices[key]) === root) throw new Error(`${key} must be a dedicated folder, not the repository root`);
  }
  for (const key of ["artifacts", "documentation"]) {
    if (!["local", "versioned"].includes(choices[key])) throw new Error(`${key} must be local or versioned`);
  }
  if (!["modify", "keep"].includes(choices.gitignore)) throw new Error("gitignore must be modify or keep (explicit user choice)");
  if (choices.artifacts !== choices.documentation) {
    const local = choices.artifacts === "local" ? choices.output : choices.documentationOutput;
    const versioned = choices.artifacts === "versioned" ? choices.output : choices.documentationOutput;
    const relative = path.relative(path.resolve(root, local), path.resolve(root, versioned));
    if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
      throw new Error("A versioned folder cannot be inside a local-only folder; choose separate destinations.");
    }
  }
  const storage = { confirmed: true, documentationOutput: choices.documentationOutput,
    artifacts: choices.artifacts, documentation: choices.documentation, gitignore: choices.gitignore };
  const rules = [];
  for (const [folder, retention] of [[choices.output, choices.artifacts], [choices.documentationOutput, choices.documentation]]) {
    const relative = path.relative(root, path.resolve(root, folder));
    if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative) && retention === "local") {
      // Escape glob metacharacters: these are exact folder choices, not patterns.
      rules.push("/" + relative.split(path.sep).join("/").replace(/[\\*?\[\]#! ]/g, "\\$&") + "/");
    }
  }
  config.output = choices.output;
  config.storage = storage;
  if (choices.gitignore === "modify" && rules.length) await ensureIgnoreRules(path.join(root, ".gitignore"), rules);
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { configPath, storage, output: config.output, ignoreRules: rules,
    note: choices.gitignore === "keep" ? "Git ignore files were not changed. Local files inside the repository may still appear in Git." : "Existing ignore rules and tracked files were preserved." };
}

async function projectConfigPath(root) {
  const nested = path.join(root, ".autotour", "autotour.json");
  try { await readFile(nested); return nested; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return path.join(root, "autotour.json");
}

export async function readStorageConfiguration(directory = process.cwd()) {
  const root = path.resolve(directory);
  let config;
  try { config = JSON.parse(await readFile(await projectConfigPath(root), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (config?.storage?.confirmed !== true || typeof config.output !== "string" || !config.output ||
      typeof config.storage.documentationOutput !== "string" || !config.storage.documentationOutput ||
      !["local", "versioned"].includes(config.storage.artifacts) || !["local", "versioned"].includes(config.storage.documentation) ||
      !["modify", "keep"].includes(config.storage.gitignore)) {
    throw new Error("Storage choices are missing. Ask where captures and documentation should live (this repository or elsewhere), whether each should be versioned, and whether AutoTour may modify .gitignore. Save the answers with autotour configure-storage before generating artifacts.");
  }
  return { ...config, output: path.resolve(root, config.output),
    documentationOutput: path.resolve(root, config.storage.documentationOutput) };
}

export async function ensureIgnoreRules(file, rules) {
  let existing = "";
  try { existing = await readFile(file, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const lines = new Set(existing.split(/\r?\n/));
  const missing = rules.filter(rule => !lines.has(rule));
  if (!missing.length) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, existing + (existing && !existing.endsWith("\n") ? "\n" : "") +
    "# AutoTour generated/local files\n" + missing.join("\n") + "\n", "utf8");
}

export async function validateWalkthrough(file) {
  const [schemaText, documentText] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(file, "utf8")
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(schemaText));
  const valid = validate(JSON.parse(documentText));
  return { valid, errors: validate.errors ?? [] };
}

export { schemaPath };
