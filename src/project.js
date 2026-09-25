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
    output: ".autotour/output",
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
