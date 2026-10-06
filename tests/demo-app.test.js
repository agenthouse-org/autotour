import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import {
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  startServer
} from "../fixtures/demo-app/server.js";

const TEST_USERNAME = process.env.AUTOTOUR_USERNAME || DEFAULT_USERNAME;
const TEST_PASSWORD = process.env.AUTOTOUR_PASSWORD || DEFAULT_PASSWORD;

/**
 * Collect text that must never contain secrets (fixture-secrets criterion).
 * @param {string[]} parts
 */
function assertNoSecrets(parts) {
  const blob = parts.join("\n");
  assert.equal(blob.includes(TEST_PASSWORD), false, "password leaked into diagnostics");
  assert.doesNotMatch(blob, /autotour_session=/i);
  assert.doesNotMatch(blob, /"password"\s*:\s*"/i);
}

async function withFixture(run) {
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args) => {
    logs.push(args.map(String).join(" "));
  };

  const app = await startServer({
    port: 0,
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
    initialDisplayName: "Demo User"
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  /** @type {{ method: string, path: string, status: number }[]} */
  const apiTraffic = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/")) {
      apiTraffic.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status()
      });
    }
  });

  try {
    await run({ app, page, context, apiTraffic, logs });
    assertNoSecrets(logs);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    await context.close();
    await browser.close();
    await app.close();
  }
}

test("demo-app health endpoint reports ready", async () => {
  await withFixture(async ({ app }) => {
    const response = await fetch(`${app.baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test("demo-app rejects invalid credentials", async () => {
  await withFixture(async ({ app, page, apiTraffic }) => {
    await page.goto(`${app.baseUrl}/login`);
    await page.getByLabel("Email").fill(TEST_USERNAME);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.locator("#login-error").filter({ hasText: /Invalid credentials/i }).waitFor();
    assert.match(page.url(), /\/login$/);
    assert.ok(
      apiTraffic.some(
        (entry) =>
          entry.method === "POST" &&
          entry.path === "/api/login" &&
          entry.status === 401
      )
    );
  });
});

test("demo-app authenticates with environment-backed credentials", async () => {
  await withFixture(async ({ app, page, apiTraffic }) => {
    await page.goto(`${app.baseUrl}/login`);
    await page.getByLabel("Email").fill(TEST_USERNAME);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/settings/profile");
    assert.ok(
      apiTraffic.some(
        (entry) =>
          entry.method === "POST" &&
          entry.path === "/api/login" &&
          entry.status === 200
      )
    );
    await assert.equal(
      await page.getByLabel("Display name").isVisible(),
      true
    );
  });
});

test("demo-app profile journey updates and persists display name in memory", async () => {
  await withFixture(async ({ app, page, apiTraffic }) => {
    await page.goto(`${app.baseUrl}/login`);
    await page.getByLabel("Email").fill(TEST_USERNAME);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/settings/profile");

    await page.getByLabel("Display name").fill("Alex Explorer");
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.getByRole("status").filter({ hasText: "Profile saved" }).waitFor();

    assert.equal(
      await page.locator("[data-testid='saved-display-name']").innerText(),
      "Alex Explorer"
    );
    assert.equal(app.getProfile().displayName, "Alex Explorer");

    assert.ok(
      apiTraffic.some(
        (entry) =>
          entry.method === "GET" &&
          entry.path === "/api/profile" &&
          entry.status === 200
      )
    );
    assert.ok(
      apiTraffic.some(
        (entry) =>
          entry.method === "PUT" &&
          entry.path === "/api/profile" &&
          entry.status === 200
      )
    );

    const profileResponse = await fetch(`${app.baseUrl}/api/profile`, {
      headers: {
        cookie: (await page.context().cookies())
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join("; ")
      }
    });
    assert.equal(profileResponse.status, 200);
    assert.deepEqual(await profileResponse.json(), {
      displayName: "Alex Explorer"
    });
  });
});

test("demo-app exposes contract routes and semantic labels", async () => {
  await withFixture(async ({ app, page }) => {
    const unauthProfile = await fetch(`${app.baseUrl}/settings/profile`, {
      redirect: "manual"
    });
    assert.equal(unauthProfile.status, 302);
    assert.equal(unauthProfile.headers.get("location"), "/login");

    await page.goto(`${app.baseUrl}/login`);
    await assert.equal(await page.getByLabel("Email").count(), 1);
    await assert.equal(await page.getByLabel("Password").count(), 1);
    await assert.equal(
      await page.getByRole("button", { name: "Sign in" }).count(),
      1
    );

    await page.getByLabel("Email").fill(TEST_USERNAME);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/settings/profile");

    await assert.equal(await page.getByLabel("Display name").count(), 1);
    await assert.equal(
      await page.getByRole("button", { name: "Save profile" }).count(),
      1
    );

    const unauthApi = await fetch(`${app.baseUrl}/api/profile`);
    assert.equal(unauthApi.status, 401);
  });
});

test("demo-app tests do not print secrets in captured diagnostics", async () => {
  await withFixture(async ({ app, page, logs }) => {
    await page.goto(`${app.baseUrl}/login`);
    await page.getByLabel("Email").fill(TEST_USERNAME);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/settings/profile");
    assertNoSecrets(logs);
    assert.ok(logs.some((line) => line.includes("POST /api/login")));
    assert.ok(logs.every((line) => !line.includes(TEST_PASSWORD)));
  });
});
