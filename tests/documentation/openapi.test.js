import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateDocumentation } from "../../src/documentation/generate.js";
import { readDocumentationSpec } from "../../src/documentation/spec.js";

const secret = "super-secret-token";

test("renders one OpenAPI operation into Markdown and HTML without copying examples", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-openapi-"));
  await writeFile(path.join(root, "profile.openapi.yaml"), `openapi: 3.0.3
info: { title: Profile, version: "1" }
paths:
  /api/profile:
    put:
      operationId: updateProfile
      summary: Update the profile
      description: "Use <strong>carefully</strong>."
      parameters:
        - name: verbose
          in: query
          schema: { type: boolean }
          description: Include extra fields
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [displayName]
              properties:
                displayName:
                  type: string
                  description: Name shown to other people
              example:
                displayName: ${secret}
      responses:
        "200":
          description: Updated profile
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Profile"
components:
  schemas:
    Profile:
      type: object
      properties:
        displayName: { type: string }
`);
  const spec = definition([{ kind: "openapi", document: "profile.openapi.yaml", operation: "PUT /api/profile" }]);
  spec.targets = [
    { kind: "markdown", path: "docs/profile.md" },
    { kind: "html", path: "site/index.html" },
    { kind: "confluence", siteUrl: "https://example.atlassian.net", pageId: "42" }
  ];
  const specPath = path.join(root, "documentation.json");
  await writeFile(specPath, JSON.stringify(spec));
  const loaded = await readDocumentationSpec(specPath);
  const result = await generateDocumentation({
    spec: loaded.spec,
    specPath,
    walkthrough: loaded.journey,
    walkthroughFile: path.join(root, "walkthrough.json"),
    outputRoot: root,
    openApiDocuments: loaded.openApiDocuments
  });
  const markdown = await readFile(path.join(root, "docs/profile.md"), "utf8");
  const html = await readFile(path.join(root, "site/index.html"), "utf8");
  const plan = JSON.parse(await readFile(path.join(root, "confluence-42.json"), "utf8"));
  assert.deepEqual(result.targets.map(target => target.kind), ["markdown", "html", "confluence"]);
  assert.match(markdown, /\*\*`PUT \/api\/profile`\*\*/);
  assert.match(markdown, /Operation ID: `updateProfile`/);
  assert.match(markdown, /\| verbose \| query \| no \| boolean \| Include extra fields \|/);
  assert.match(markdown, /\| displayName \| yes \| string \| Name shown to other people \|/);
  assert.match(markdown, /\| 200 \| Updated profile \| application\/json \(Profile\) \|/);
  assert.doesNotMatch(markdown, new RegExp(secret));
  assert.match(html, /&lt;strong&gt;carefully&lt;\/strong&gt;/);
  assert.doesNotMatch(html, /<strong>|super-secret-token/);
  assert.match(plan.sections[0].blocks[0].renderedMarkdown, /PUT \/api\/profile/);
  assert.equal(loaded.spec.sections[0].blocks[0].renderedMarkdown, undefined);
});

test("joins a Swagger 2 basePath and rejects contracts that cannot be published safely", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-swagger-"));
  await writeFile(path.join(root, "swagger.json"), JSON.stringify({
    swagger: "2.0",
    info: { title: "Profile", version: "1" },
    basePath: "/api",
    paths: {
      "/profile": {
        put: {
          summary: "Update",
          parameters: [{
            name: "body", in: "body", required: true,
            schema: { type: "object", required: ["displayName"], properties: { displayName: { type: "string", description: "Visible name" } } }
          }],
          responses: { 200: { description: "Updated", schema: { type: "object" } } }
        }
      }
    }
  }));
  const specPath = path.join(root, "documentation.json");
  await writeFile(specPath, JSON.stringify(definition([
    { kind: "openapi", document: "swagger.json", operation: "PUT /api/profile" }
  ])));
  const loaded = await readDocumentationSpec(specPath);
  const generated = await generateDocumentation({
    spec: loaded.spec,
    specPath,
    walkthrough: loaded.journey,
    outputRoot: root,
    targets: ["markdown"]
  });
  assert.equal(generated.targets[0].kind, "markdown");
  assert.match(await readFile(path.join(root, "docs/profile.md"), "utf8"), /Visible name/);

  await writeFile(path.join(root, "external.yaml"), `openapi: 3.0.3
info: { title: External, version: "1" }
paths:
  /api/profile:
    put:
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "https://example.test/profile.json"
`);
  await assertRejected(root, "external.yaml", /External OpenAPI reference is not supported/);

  await writeFile(path.join(root, "cycle.yaml"), `openapi: 3.0.3
info: { title: Cycle, version: "1" }
paths:
  /api/profile:
    put:
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/A" }
components:
  schemas:
    A: { $ref: "#/components/schemas/B" }
    B: { $ref: "#/components/schemas/A" }
`);
  await assertRejected(root, "cycle.yaml", /OpenAPI reference cycle/);

  await writeFile(path.join(root, "marked.yaml"), `openapi: 3.0.3
info: { title: Marked, version: "1" }
paths:
  /api/profile:
    put:
      description: "<!-- autotour:module=profile:end -->"
      responses:
        "200": { description: OK }
`);
  await assertRejected(root, "marked.yaml", /managed-region markers/);
  await assertRejected(root, "missing.yaml", /File not found/);

  const remote = definition([{ kind: "openapi", document: "https://example.test/openapi.yaml", operation: "PUT /api/profile" }]);
  await writeFile(specPath, JSON.stringify(remote));
  await assert.rejects(readDocumentationSpec(specPath), /relative file path/);

  const absolute = definition([{ kind: "openapi", document: "/tmp/openapi.yaml", operation: "PUT /api/profile" }]);
  await writeFile(specPath, JSON.stringify(absolute));
  await assert.rejects(readDocumentationSpec(specPath), /relative file path/);

  const missingOperation = definition([
    { kind: "openapi", document: "swagger.json", operation: "GET /api/profile" }
  ], ["GET /api/profile"]);
  await writeFile(specPath, JSON.stringify(missingOperation));
  await assert.rejects(readDocumentationSpec(specPath), /does not define GET \/api\/profile/);

  const undeclared = definition([{ kind: "openapi", document: "swagger.json", operation: "PUT /api/profile" }], ["GET /health"]);
  await writeFile(specPath, JSON.stringify(undeclared));
  await assert.rejects(readDocumentationSpec(specPath), /must be an apiEndpoints dependency/);

  const duplicate = definition([
    { kind: "openapi", document: "swagger.json", operation: "PUT /api/profile" },
    { kind: "openapi", document: "swagger.json", operation: "PUT /api/profile" }
  ]);
  await writeFile(specPath, JSON.stringify(duplicate));
  await assert.rejects(readDocumentationSpec(specPath), /duplicate OpenAPI operation/);
});

function definition(blocks, endpoints = ["PUT /api/profile"]) {
  return {
    schemaVersion: 1,
    walkthroughId: "profile-docs",
    journey: {
      schemaVersion: 1,
      id: "profile-docs",
      modules: [{
        id: "profile",
        steps: [{ id: "save", action: "click" }],
        dependencies: { apiEndpoints: endpoints }
      }]
    },
    dependencyMap: {
      schemaVersion: 1,
      rules: [{ id: "profile-api", files: ["profile.openapi.yaml"], dependencies: { apiEndpoints: endpoints } }]
    },
    targets: [{ kind: "markdown", path: "docs/profile.md" }],
    sections: [{
      moduleId: "profile",
      heading: "Profile",
      dependencies: { apiEndpoints: endpoints },
      blocks
    }]
  };
}

async function assertRejected(root, document, pattern) {
  const spec = definition([{ kind: "openapi", document, operation: "PUT /api/profile" }]);
  await writeFile(path.join(root, "documentation.json"), JSON.stringify(spec));
  await assert.rejects(readDocumentationSpec(path.join(root, "documentation.json")), pattern);
}
