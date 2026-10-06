import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const execFileAsync = promisify(execFile);
const dependencyKinds = ["views", "controllers", "apiEndpoints", "backend"];
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schemaPath = path.join(packageRoot, "schemas", "dependency-map.schema.json");
let validatorPromise;

export async function validateDependencyMapDocument(document) {
  const validate = await getValidator();
  const valid = validate(document);
  return { valid: Boolean(valid), errors: validate.errors ?? [] };
}

export function createInvalidationPlan({ walkthrough, changedFiles, dependencyMap }) {
  if (!walkthrough?.id || !Array.isArray(walkthrough.modules)) {
    throw new TypeError("walkthrough must contain an id and modules");
  }
  if (!Array.isArray(dependencyMap?.rules)) {
    throw new TypeError("dependencyMap must contain rules");
  }

  const files = [...new Set(changedFiles.map(normalizeRepositoryPath))].sort();
  const reasonsByModule = new Map(walkthrough.modules.map((module) => [module.id, []]));
  const unmappedFiles = [];
  const unmatchedDependencies = [];

  for (const file of files) {
    const matchingRules = dependencyMap.rules.filter((rule) =>
      rule.files.some((pattern) => matchesFilePattern(file, pattern))
    );
    if (matchingRules.length === 0) {
      unmappedFiles.push(file);
      continue;
    }

    for (const rule of matchingRules) {
      for (const kind of dependencyKinds) {
        for (const value of rule.dependencies[kind] ?? []) {
          const consumers = walkthrough.modules.filter((module) =>
            (module.dependencies?.[kind] ?? []).includes(value)
          );
          if (consumers.length === 0) {
            unmatchedDependencies.push({ file, ruleId: rule.id, kind, value });
            continue;
          }
          for (const module of consumers) {
            addReason(reasonsByModule.get(module.id), {
              file,
              ruleId: rule.id,
              kind,
              value
            });
          }
        }
      }
    }
  }

  const uniqueUnmatched = uniqueRecords(unmatchedDependencies);
  const reviewRequired = unmappedFiles.length > 0 || uniqueUnmatched.length > 0;
  const modules = walkthrough.modules.map((module) => {
    const reasons = reasonsByModule.get(module.id);
    return {
      id: module.id,
      title: module.title,
      status: reasons.length > 0 ? "regenerate" : reviewRequired ? "review" : "reusable",
      reasons
    };
  });

  return {
    schemaVersion: 1,
    walkthroughId: walkthrough.id,
    changedFiles: files,
    reviewRequired,
    unmappedFiles,
    unmatchedDependencies: uniqueUnmatched,
    modules,
    summary: {
      regenerate: modules.filter((module) => module.status === "regenerate").map((module) => module.id),
      reusable: modules.filter((module) => module.status === "reusable").map((module) => module.id),
      review: modules.filter((module) => module.status === "review").map((module) => module.id)
    }
  };
}

export async function collectGitChangedFiles({ cwd = process.cwd(), base, head = "HEAD" }) {
  validateGitRef(base, "base");
  validateGitRef(head, "head");
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-status", "-z", "--diff-filter=ACMRD", `${base}...${head}`, "--"],
    { cwd, encoding: "utf8", windowsHide: true }
  );
  return parseGitNameStatus(stdout);
}

export async function readJsonDocument(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeInvalidationPlan(file, plan) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return target;
}

export function matchesFilePattern(file, pattern) {
  const normalizedFile = normalizeRepositoryPath(file);
  const normalizedPattern = normalizeRepositoryPath(pattern);
  let expression = "^";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    if (character === "*" && normalizedPattern[index + 1] === "*") {
      if (normalizedPattern[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += escapeRegex(character);
    }
  }
  return new RegExp(`${expression}$`).test(normalizedFile);
}

export { schemaPath as dependencyMapSchemaPath };

async function getValidator() {
  if (!validatorPromise) {
    validatorPromise = (async () => {
      const schema = JSON.parse(await readFile(schemaPath, "utf8"));
      return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    })();
  }
  return validatorPromise;
}

function normalizeRepositoryPath(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("changed files and patterns must be non-empty strings");
  }
  const normalized = path.posix.normalize(value.trim().replaceAll("\\", "/").replace(/^\.\//, ""));
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new TypeError(`path must stay within the repository: ${value}`);
  }
  return normalized;
}

function validateGitRef(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/@{}~^:+-]*$/.test(value)) {
    throw new TypeError(`${label} must be a safe Git revision`);
  }
}

function parseGitNameStatus(output) {
  const tokens = output.split("\0");
  const files = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) break;
    const firstPath = tokens[index++];
    if (!firstPath) throw new Error("Git returned an incomplete changed-file record");
    files.push(normalizeRepositoryPath(firstPath));
    if (status.startsWith("R") || status.startsWith("C")) {
      const secondPath = tokens[index++];
      if (!secondPath) throw new Error("Git returned an incomplete rename record");
      files.push(normalizeRepositoryPath(secondPath));
    }
  }
  return [...new Set(files)].sort();
}

function addReason(reasons, reason) {
  if (!reasons.some((entry) => recordsEqual(entry, reason))) reasons.push(reason);
}

function uniqueRecords(records) {
  const result = [];
  for (const record of records) addReason(result, record);
  return result;
}

function recordsEqual(left, right) {
  return left.file === right.file && left.ruleId === right.ruleId &&
    left.kind === right.kind && left.value === right.value;
}

function escapeRegex(character) {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}
