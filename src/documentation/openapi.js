import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const MAX_BYTES = 1_000_000;
const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
const MAX_TEXT = 4000;
const MAX_CELL = 240;
const MAX_PROPERTIES = 30;
const MAX_ENUM = 8;

export async function loadOpenApiDocuments(specPath, spec) {
  const byReference = new Map();
  const byResolved = new Map();
  for (const section of spec.sections ?? []) {
    for (const block of section.blocks ?? []) {
      if (block.kind !== "openapi" || byReference.has(block.document)) continue;
      assertRelativeDocument(block.document);
      const resolved = path.resolve(path.dirname(specPath), block.document);
      if (!byResolved.has(resolved)) {
        try {
          byResolved.set(resolved, await readOpenApiDocument(resolved));
        } catch (error) {
          throw new Error(`OpenAPI document ${block.document} could not be read: ${error.message}`);
        }
      }
      byReference.set(block.document, byResolved.get(resolved));
    }
  }
  return byReference;
}

export async function readOpenApiDocument(file) {
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("File not found.");
    throw error;
  }
  if (!info.isFile()) throw new Error("Path is not a file.");
  if (info.size > MAX_BYTES) throw new Error("Document exceeds 1 MB.");
  const text = await readFile(file, "utf8");
  let document;
  try {
    document = parseDocument(text, path.extname(file).toLowerCase());
  } catch (error) {
    throw new Error(`Could not parse JSON or YAML (${error.message}).`);
  }
  assertSupported(document);
  return { document, normalized: new Map() };
}

export function operationFor(loaded, operationKey) {
  if (!loaded.index) loaded.index = indexOperations(loaded.document);
  if (!loaded.normalized.has(operationKey)) {
    const entry = loaded.index.get(operationKey);
    loaded.normalized.set(operationKey, entry ? normalizeEntry(loaded.document, entry) : null);
  }
  return loaded.normalized.get(operationKey);
}

export function renderOpenApiMarkdown(operation) {
  const lines = [`**\`${inlineCode(`${operation.method} ${operation.path}`)}\`**`];
  if (operation.operationId) lines.push("", `Operation ID: \`${inlineCode(operation.operationId)}\``);
  for (const paragraph of paragraphs(operation.summary)) lines.push("", paragraph);
  for (const paragraph of paragraphs(operation.description)) lines.push("", paragraph);
  if (operation.deprecated) lines.push("", "This operation is deprecated.");
  if (operation.security) lines.push("", `Security: ${operation.security}`);
  if (operation.parameters.length) {
    lines.push("", "Parameters", "", "| Name | In | Required | Schema | Description |", "| --- | --- | --- | --- | --- |");
    for (const parameter of operation.parameters) {
      lines.push(`| ${cell(parameter.name)} | ${cell(parameter.in)} | ${parameter.required ? "yes" : "no"} | ${cell(parameter.schema)} | ${cell(parameter.description)} |`);
    }
  }
  for (const body of operation.requestBodies) {
    lines.push("", `Request body${body.required ? " (required)" : ""}: \`${inlineCode(body.mediaType)}\``);
    for (const paragraph of paragraphs(body.description)) lines.push("", paragraph);
    if (body.properties.length) {
      lines.push("", "| Property | Required | Schema | Description |", "| --- | --- | --- | --- |");
      for (const property of body.properties) {
        lines.push(`| ${cell(property.name)} | ${property.required ? "yes" : "no"} | ${cell(property.schema)} | ${cell(property.description)} |`);
      }
      if (body.propertiesTruncated) lines.push("", "Additional properties remain in the OpenAPI document.");
    } else if (body.schema) lines.push("", `Schema: ${body.schema}`);
  }
  if (operation.responses.length) {
    lines.push("", "Responses", "", "| Status | Description | Content |", "| --- | --- | --- |");
    for (const response of operation.responses) {
      lines.push(`| ${cell(response.status)} | ${cell(response.description)} | ${cell(response.content)} |`);
    }
  }
  return lines.join("\n");
}

export function renderOpenApiHtml(operation) {
  const parts = [`<section class="autotour-openapi"><p><code>${escapeHtml(`${operation.method} ${operation.path}`)}</code></p>`];
  if (operation.operationId) parts.push(`<p>Operation ID: <code>${escapeHtml(operation.operationId)}</code></p>`);
  for (const paragraph of paragraphs(operation.summary)) parts.push(`<p>${htmlText(paragraph)}</p>`);
  for (const paragraph of paragraphs(operation.description)) parts.push(`<p>${htmlText(paragraph)}</p>`);
  if (operation.deprecated) parts.push("<p>This operation is deprecated.</p>");
  if (operation.security) parts.push(`<p>Security: ${escapeHtml(operation.security)}</p>`);
  if (operation.parameters.length) {
    parts.push("<h3>Parameters</h3><table><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Schema</th><th>Description</th></tr></thead><tbody>");
    for (const parameter of operation.parameters) {
      parts.push(`<tr><td><code>${escapeHtml(parameter.name)}</code></td><td>${escapeHtml(parameter.in)}</td><td>${parameter.required ? "yes" : "no"}</td><td>${escapeHtml(parameter.schema)}</td><td>${escapeHtml(oneLine(parameter.description))}</td></tr>`);
    }
    parts.push("</tbody></table>");
  }
  for (const body of operation.requestBodies) {
    parts.push(`<h3>Request body${body.required ? " (required)" : ""}</h3><p><code>${escapeHtml(body.mediaType)}</code></p>`);
    for (const paragraph of paragraphs(body.description)) parts.push(`<p>${htmlText(paragraph)}</p>`);
    if (body.properties.length) {
      parts.push("<table><thead><tr><th>Property</th><th>Required</th><th>Schema</th><th>Description</th></tr></thead><tbody>");
      for (const property of body.properties) {
        parts.push(`<tr><td><code>${escapeHtml(property.name)}</code></td><td>${property.required ? "yes" : "no"}</td><td>${escapeHtml(property.schema)}</td><td>${escapeHtml(oneLine(property.description))}</td></tr>`);
      }
      parts.push("</tbody></table>");
      if (body.propertiesTruncated) parts.push("<p>Additional properties remain in the OpenAPI document.</p>");
    } else if (body.schema) parts.push(`<p>Schema: ${escapeHtml(body.schema)}</p>`);
  }
  if (operation.responses.length) {
    parts.push("<h3>Responses</h3><table><thead><tr><th>Status</th><th>Description</th><th>Content</th></tr></thead><tbody>");
    for (const response of operation.responses) {
      parts.push(`<tr><td><code>${escapeHtml(response.status)}</code></td><td>${escapeHtml(oneLine(response.description))}</td><td>${escapeHtml(response.content)}</td></tr>`);
    }
    parts.push("</tbody></table>");
  }
  parts.push("</section>");
  return parts.join("");
}

function assertRelativeDocument(reference) {
  if (typeof reference !== "string" || reference.length === 0 || reference.includes("\0")) {
    throw new Error("OpenAPI documents must be relative file paths.");
  }
  if (path.isAbsolute(reference) || /^[a-z][a-z0-9+.-]*:/i.test(reference)) {
    throw new Error("OpenAPI documents must be relative file paths.");
  }
}

function parseDocument(text, extension) {
  if (extension === ".json") return JSON.parse(text);
  if (extension === ".yaml" || extension === ".yml") return parseYaml(text, yamlOptions);
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[") ? JSON.parse(text) : parseYaml(text, yamlOptions);
}

const yamlOptions = { maxAliasCount: 100, uniqueKeys: true };

function assertSupported(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Document must be a JSON object.");
  }
  if (typeof document.openapi === "string" && /^3\.\d+\.\d+/.test(document.openapi)) return;
  if (document.swagger === "2.0") return;
  throw new Error("Document must be OpenAPI 3.x or Swagger 2.0.");
}

function indexOperations(document) {
  const operations = new Map();
  const swagger = document.swagger === "2.0";
  for (const [rawPath, pathItem] of Object.entries(document.paths ?? {})) {
    if (rawPath.startsWith("x-") || !pathItem || typeof pathItem !== "object") continue;
    const item = deref(pathItem, document);
    const operationPath = swagger ? joinBase(document.basePath, rawPath) : rawPath;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation || typeof operation !== "object") continue;
      operations.set(`${method.toUpperCase()} ${operationPath}`, {
        method: method.toUpperCase(),
        path: operationPath,
        operation,
        shared
      });
    }
  }
  return operations;
}

function joinBase(basePath, operationPath) {
  const suffix = operationPath.startsWith("/") ? operationPath : `/${operationPath}`;
  if (!basePath || basePath === "/") return suffix;
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  return `${base}${suffix}`;
}

function normalizeEntry(document, entry) {
  const operation = deref(entry.operation, document);
  const parameters = collectParameters(entry.shared, operation, document);
  const requestBodies = collectRequestBodies(operation, document);
  return {
    method: entry.method,
    path: entry.path,
    operationId: bounded(operation.operationId, 200),
    summary: bounded(operation.summary),
    description: bounded(operation.description),
    deprecated: operation.deprecated === true,
    security: securityLabel(operation, document),
    parameters,
    requestBodies,
    responses: collectResponses(operation, document)
  };
}

function collectParameters(shared, operation, document) {
  const merged = new Map();
  for (const parameter of [...shared, ...(operation.parameters ?? [])]) {
    const resolved = deref(parameter, document);
    if (!resolved || resolved.in === "body") continue;
    const key = `${resolved.in}:${resolved.name}`;
    merged.set(key, {
      name: bounded(resolved.name, 120),
      in: bounded(resolved.in, 40),
      required: Boolean(resolved.required) || resolved.in === "path",
      schema: schemaLabel(resolved.schema ?? swaggerSchema(resolved), document),
      description: bounded(resolved.description)
    });
  }
  return [...merged.values()];
}

function collectRequestBodies(operation, document) {
  if (operation.requestBody) {
    const body = deref(operation.requestBody, document);
    return Object.entries(body.content ?? {}).map(([mediaType, content]) => requestBody({
      mediaType,
      schema: content?.schema,
      required: Boolean(body.required),
      description: content?.description ?? body.description,
      document
    }));
  }
  return (operation.parameters ?? [])
    .map(parameter => deref(parameter, document))
    .filter(parameter => parameter?.in === "body" && parameter.schema)
    .map(parameter => requestBody({
      mediaType: "application/json",
      schema: parameter.schema,
      required: Boolean(parameter.required),
      description: parameter.description,
      document
    }));
}

function requestBody({ mediaType, schema, required, description, document }) {
  const properties = propertyRows(schema, document);
  return {
    mediaType: bounded(mediaType, 120),
    required,
    description: bounded(description),
    schema: schema ? schemaLabel(schema, document) : "",
    properties: properties.rows,
    propertiesTruncated: properties.truncated
  };
}

function collectResponses(operation, document) {
  const produces = Array.isArray(document.produces) && document.produces.length ? document.produces : ["application/json"];
  return Object.entries(operation.responses ?? {}).map(([status, response]) => {
    const resolved = deref(response, document) ?? {};
    const contents = [];
    for (const [mediaType, content] of Object.entries(resolved.content ?? {})) {
      const label = content?.schema ? schemaLabel(content.schema, document) : "";
      contents.push(label && label !== "value" ? `${mediaType} (${label})` : mediaType);
    }
    if (!contents.length && resolved.schema) {
      contents.push(`${produces[0]} (${schemaLabel(resolved.schema, document)})`);
    }
    return {
      status: bounded(status, 40),
      description: bounded(resolved.description),
      content: contents.join(", ")
    };
  }).sort((left, right) => statusRank(left.status) - statusRank(right.status) || left.status.localeCompare(right.status));
}

function propertyRows(schema, document) {
  if (!schema) return { rows: [], truncated: false };
  const resolved = deref(schema, document);
  if (!resolved?.properties || typeof resolved.properties !== "object") return { rows: [], truncated: false };
  const required = new Set(Array.isArray(resolved.required) ? resolved.required : []);
  const entries = Object.entries(resolved.properties);
  return {
    truncated: entries.length > MAX_PROPERTIES,
    rows: entries.slice(0, MAX_PROPERTIES).map(([name, property]) => {
      const item = property && typeof property === "object" ? property : {};
      return {
        name: bounded(name, 120),
        required: required.has(name),
        schema: schemaLabel(item, document),
        description: bounded(item.description)
      };
    })
  };
}

function schemaLabel(schema, document) {
  if (!schema || typeof schema !== "object") return "value";
  if (schema.$ref) {
    const name = refName(schema.$ref);
    const resolved = deref(schema, document);
    if (resolved?.type && resolved.type !== "object" && !resolved.properties) return `${name} (${typeLabel(resolved, document)})`;
    return name;
  }
  return typeLabel(schema, document);
}

function typeLabel(schema, document) {
  if (!schema || typeof schema !== "object") return "value";
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (Array.isArray(schema.enum)) return `enum: ${schema.enum.slice(0, MAX_ENUM).map(item => JSON.stringify(item)).join(", ")}`;
  if (schema.type === "array") return `array of ${schema.items ? schemaLabel(schema.items, document) : "items"}`;
  if (schema.allOf) return "allOf";
  if (schema.oneOf) return "oneOf";
  if (schema.anyOf) return "anyOf";
  if (schema.type === "object" || schema.properties) return "object";
  if (typeof schema.type === "string") return schema.format ? `${schema.type} (${schema.format})` : schema.type;
  return "value";
}

function swaggerSchema(parameter) {
  if (!parameter || parameter.schema) return parameter?.schema;
  const { type, format, items, enum: values } = parameter;
  if (!type && !values) return undefined;
  return { type, format, items, enum: values };
}

function securityLabel(operation, document) {
  const requirements = operation.security ?? document.security;
  if (!Array.isArray(requirements) || requirements.length === 0) return "";
  const names = [...new Set(requirements.flatMap(item => item && typeof item === "object" ? Object.keys(item) : []))];
  return names.map(name => bounded(name, 80)).filter(Boolean).join(", ");
}

function deref(node, document, seen = new Set()) {
  if (!node || typeof node !== "object" || !node.$ref) return node;
  const ref = node.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    throw new Error(`External OpenAPI reference is not supported: ${ref}`);
  }
  if (seen.has(ref)) throw new Error(`OpenAPI reference cycle: ${ref}`);
  const next = new Set(seen);
  next.add(ref);
  return deref(resolvePointer(document, ref), document, next);
}

function resolvePointer(document, ref) {
  let node = document;
  for (const part of ref.slice(2).split("/").map(decodePointer)) {
    if (!node || typeof node !== "object" || !Object.hasOwn(node, part)) {
      throw new Error(`OpenAPI reference does not resolve: ${ref}`);
    }
    node = node[part];
  }
  return node;
}

function decodePointer(part) {
  return part.replaceAll("~1", "/").replaceAll("~0", "~");
}

function refName(ref) {
  const name = decodePointer(String(ref).split("/").filter(Boolean).at(-1) ?? "value");
  return bounded(name, 120);
}

function bounded(value, max = MAX_TEXT) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (/autotour:module=/.test(text)) throw new Error("OpenAPI text cannot contain managed-region markers.");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function statusRank(status) {
  const value = Number(status);
  return Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

function paragraphs(text) {
  return String(text ?? "").split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
}

function oneLine(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL - 1)}…` : text;
}

function cell(value) {
  return oneLine(value).replaceAll("|", "\\|");
}

function inlineCode(value) {
  return String(value).replaceAll("`", "");
}

function htmlText(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
