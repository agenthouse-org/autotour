import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CaptureError,
  REDACTED,
  captureJourney,
  containsSecret,
  createProfileJourney,
  redactString,
  toStableId,
  validateWalkthroughDocument
} from "../../src/capture/index.js";
import { createFixturePageDouble } from "./fixture-page.js";

const USERNAME = "capture-user@example.test";
const PASSWORD = "capture-secret-value";
const BASE_URL = "https://fixture.test";
const GOAL = "Show a signed-in user how to update their display name.";

function testEnv(overrides = {}) {
  return {
    AUTOTOUR_USERNAME: USERNAME,
    AUTOTOUR_PASSWORD: PASSWORD,
    ...overrides
  };
}

async function runCapture(overrides = {}) {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-capture-"));
  const page = createFixturePageDouble({
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD
  });
  const result = await captureJourney({
    baseUrl: BASE_URL,
    goal: GOAL,
    outputDir,
    env: testEnv(),
    page,
    ...overrides
  });
  return { result, page, outputDir };
}

test("toStableId derives deterministic kebab-case ids", () => {
  assert.equal(toStableId("Update Profile"), "update-profile");
  assert.equal(toStableId("Save profile"), "save-profile");
  assert.equal(toStableId("Update Profile"), toStableId("update profile"));
});

test("capture accepts base URL, goal, and credential environment names", async () => {
  const { result } = await runCapture({
    usernameEnv: "AUTOTOUR_USERNAME",
    passwordEnv: "AUTOTOUR_PASSWORD"
  });

  assert.equal(result.walkthrough.target.baseUrl, BASE_URL);
  assert.equal(result.walkthrough.target.goal, GOAL);
  assert.equal(
    result.walkthrough.modules
      .flatMap((module) => module.steps)
      .some((step) => step.valueEnv === "AUTOTOUR_USERNAME"),
    true
  );
  assert.equal(
    result.walkthrough.modules
      .flatMap((module) => module.steps)
      .some((step) => step.valueEnv === "AUTOTOUR_PASSWORD"),
    true
  );
});

test("capture executes login and profile update through stable controls", async () => {
  const { page } = await runCapture();
  const actions = page.actions();

  assert.deepEqual(
    actions.map((action) => [action.type, action.role ?? null, action.name ?? null]),
    [
      ["goto", null, null],
      ["fill", "textbox", "Email"],
      ["fill", "textbox", "Password"],
      ["click", "button", "Sign in"],
      ["goto", null, null],
      ["fill", "textbox", "Display name"],
      ["click", "button", "Save profile"]
    ]
  );
  assert.equal(page.state().authenticated, true);
  assert.equal(page.state().displayName, "Ada Lovelace");
});

test("module and step ids stay stable across equivalent runs", async () => {
  const first = await runCapture();
  const second = await runCapture();

  const identities = (result) =>
    result.walkthrough.modules.map((module) => ({
      id: module.id,
      route: module.route,
      steps: module.steps.map((step) => step.id)
    }));

  assert.deepEqual(identities(first.result), identities(second.result));
  assert.deepEqual(
    first.result.captureSteps.map((step) => [step.moduleId, step.id]),
    second.result.captureSteps.map((step) => [step.moduleId, step.id])
  );
  assert.deepEqual(identities(first.result), [
    { id: "sign-in", route: "/login", steps: ["open-login", "enter-email", "enter-password", "submit-login"] },
    {
      id: "update-profile",
      route: "/settings/profile",
      steps: ["open-profile", "enter-display-name", "save-profile"]
    }
  ]);
});

test("manifest records observed routes and login/profile API endpoints only", async () => {
  const { result } = await runCapture();
  const byId = Object.fromEntries(result.walkthrough.modules.map((module) => [module.id, module]));

  assert.equal(byId["sign-in"].route, "/login");
  assert.deepEqual(byId["sign-in"].dependencies.apiEndpoints, ["POST /api/login"]);
  assert.equal(byId["update-profile"].route, "/settings/profile");
  assert.deepEqual(byId["update-profile"].dependencies.apiEndpoints, [
    "GET /api/profile",
    "PUT /api/profile"
  ]);
  assert.equal(byId["sign-in"].dependencies.views, undefined);
  assert.equal(byId["sign-in"].dependencies.controllers, undefined);
  assert.equal(byId["sign-in"].dependencies.backend, undefined);

  const save = result.captureSteps.find((step) => step.id === "save-profile");
  assert.deepEqual(save, {
    id: "save-profile",
    moduleId: "update-profile",
    action: "click",
    description: "Save the updated display name.",
    route: "/settings/profile",
    observedRequests: ["PUT /api/profile"],
    annotation: {
      callout: 3,
      caption: "Save the updated profile."
    },
    target: {
      role: "button",
      name: "Save profile"
    }
  });
});

test("generated walkthrough validates against the shared schema", async () => {
  const { result } = await runCapture();
  const validation = await validateWalkthroughDocument(result.walkthrough);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));

  const written = JSON.parse(await readFile(result.walkthroughPath, "utf8"));
  const writtenValidation = await validateWalkthroughDocument(written);
  assert.equal(writtenValidation.valid, true, JSON.stringify(writtenValidation.errors));
});

test("artifacts and diagnostics never contain credential values", async () => {
  const { result } = await runCapture();
  const walkthroughText = await readFile(result.walkthroughPath, "utf8");
  const stepsText = await readFile(result.stepsPath, "utf8");
  const secrets = [USERNAME, PASSWORD];

  assert.equal(containsSecret(walkthroughText, secrets), false);
  assert.equal(containsSecret(stepsText, secrets), false);
  assert.equal(containsSecret(result, secrets), false);
  assert.equal(walkthroughText.includes(PASSWORD), false);
  assert.equal(stepsText.includes("cookie"), false);
  assert.equal(redactString(`token=${PASSWORD}; path=/`, secrets).includes(PASSWORD), false);
  assert.match(redactString(`Bearer ${PASSWORD}`, secrets), new RegExp(REDACTED));
});

test("failed steps identify module, step, and safe cause", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-capture-"));
  const page = createFixturePageDouble({
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD
  });

  await assert.rejects(
    () =>
      captureJourney({
        baseUrl: BASE_URL,
        goal: GOAL,
        outputDir,
        env: testEnv({ AUTOTOUR_PASSWORD: "wrong-password-value" }),
        page
      }),
    (error) => {
      assert.equal(error instanceof CaptureError, true);
      assert.equal(error.moduleId, "sign-in");
      assert.equal(error.stepId, "submit-login");
      assert.match(error.cause, /Invalid credentials/i);
      assert.equal(error.message.includes("wrong-password-value"), false);
      assert.equal(error.cause.includes("wrong-password-value"), false);
      assert.equal(JSON.stringify(error.toJSON()).includes("wrong-password-value"), false);
      return true;
    }
  );
});

test("missing credential environment variables fail safely before browsing", async () => {
  await assert.rejects(
    () =>
      captureJourney({
        baseUrl: BASE_URL,
        goal: GOAL,
        env: { AUTOTOUR_USERNAME: USERNAME },
        page: createFixturePageDouble()
      }),
    (error) => {
      assert.equal(error instanceof CaptureError, true);
      assert.match(error.message, /AUTOTOUR_PASSWORD/);
      assert.equal(error.message.includes(PASSWORD), false);
      return true;
    }
  );
});

test("profile journey exposes declarative modules for the fixture contract", () => {
  const journey = createProfileJourney();
  assert.equal(journey.modules[0].route, "/login");
  assert.equal(journey.modules[1].route, "/settings/profile");
  assert.equal(journey.modules[1].steps.at(-1).id, "save-profile");
});
