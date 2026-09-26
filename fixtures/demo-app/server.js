import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Test-only defaults when AUTOTOUR_* env vars are unset. Never use outside local fixtures. */
export const DEFAULT_USERNAME = "test-user@example.com";
export const DEFAULT_PASSWORD = "test-password";

const SESSION_COOKIE = "autotour_session";

/**
 * @typedef {{ displayName: string }} Profile
 */

/**
 * Create the deterministic demo-app fixture.
 * Credentials come from AUTOTOUR_USERNAME / AUTOTOUR_PASSWORD (or documented defaults).
 */
export function createFixture(options = {}) {
  const username =
    options.username ?? process.env.AUTOTOUR_USERNAME ?? DEFAULT_USERNAME;
  const password =
    options.password ?? process.env.AUTOTOUR_PASSWORD ?? DEFAULT_PASSWORD;

  /** @type {Map<string, { username: string }>} */
  const sessions = new Map();
  /** @type {Profile} */
  let profile = {
    displayName: options.initialDisplayName ?? "Demo User"
  };

  function parseCookies(header) {
    /** @type {Record<string, string>} */
    const cookies = {};
    if (!header) return cookies;
    for (const part of header.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      cookies[key] = decodeURIComponent(value);
    }
    return cookies;
  }

  function getSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const id = cookies[SESSION_COOKIE];
    if (!id) return null;
    return sessions.get(id) ? { id, session: sessions.get(id) } : null;
  }

  function setSessionCookie(res, sessionId) {
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`
    );
  }

  function clearSessionCookie(res) {
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
  }

  async function readJson(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  }

  function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload)
    });
    res.end(payload);
  }

  function sendHtml(res, status, html) {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html)
    });
    res.end(html);
  }

  function loginPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sign in — AutoTour demo</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 24rem; margin: 3rem auto; padding: 0 1rem; }
    label { display: block; margin-top: 1rem; font-weight: 600; }
    input { width: 100%; box-sizing: border-box; margin-top: 0.35rem; padding: 0.5rem; }
    button { margin-top: 1.25rem; padding: 0.55rem 1rem; }
    [role="alert"] { color: #a40000; margin-top: 1rem; min-height: 1.25rem; }
  </style>
</head>
<body>
  <h1>Sign in</h1>
  <form id="login-form" method="post" action="/api/login">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required>

    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>

    <button type="submit">Sign in</button>
  </form>
  <p id="login-error" role="alert" aria-live="polite"></p>
  <script>
    const form = document.getElementById("login-form");
    const errorEl = document.getElementById("login-error");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.textContent = "";
      const email = document.getElementById("email").value;
      const password = document.getElementById("password").value;
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        errorEl.textContent = "Invalid credentials";
        return;
      }
      window.location.assign("/settings/profile");
    });
  </script>
</body>
</html>`;
  }

  function profilePage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Profile settings — AutoTour demo</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; }
    label { display: block; margin-top: 1rem; font-weight: 600; }
    input { width: 100%; box-sizing: border-box; margin-top: 0.35rem; padding: 0.5rem; }
    button { margin-top: 1.25rem; padding: 0.55rem 1rem; }
    #saved-value { margin-top: 1rem; }
    [role="status"] { margin-top: 0.75rem; min-height: 1.25rem; }
  </style>
</head>
<body>
  <h1>Profile settings</h1>
  <form id="profile-form">
    <label for="display-name">Display name</label>
    <input id="display-name" name="displayName" type="text" autocomplete="nickname" required>
    <button type="submit">Save profile</button>
  </form>
  <p id="status" role="status" aria-live="polite"></p>
  <p id="saved-value">Saved display name: <span data-testid="saved-display-name"></span></p>
  <script>
    const form = document.getElementById("profile-form");
    const displayNameInput = document.getElementById("display-name");
    const savedSpan = document.querySelector("[data-testid='saved-display-name']");
    const statusEl = document.getElementById("status");

    function showProfile(profile) {
      displayNameInput.value = profile.displayName ?? "";
      savedSpan.textContent = profile.displayName ?? "";
    }

    async function loadProfile() {
      const response = await fetch("/api/profile", {
        headers: { "Accept": "application/json" },
        credentials: "same-origin"
      });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) {
        statusEl.textContent = "Could not load profile";
        return;
      }
      showProfile(await response.json());
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      statusEl.textContent = "";
      const displayName = displayNameInput.value;
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ displayName })
      });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) {
        statusEl.textContent = "Could not save profile";
        return;
      }
      const profile = await response.json();
      showProfile(profile);
      statusEl.textContent = "Profile saved";
    });

    loadProfile();
  </script>
</body>
</html>`;
  }

  /**
   * Safe request log: method + path only (no bodies, cookies, or credentials).
   * @param {import("node:http").IncomingMessage} req
   */
  function logRequest(req) {
    const pathOnly = (req.url || "/").split("?")[0];
    console.log(`${req.method} ${pathOnly}`);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const path = url.pathname;
      logRequest(req);

      if (req.method === "GET" && path === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && path === "/login") {
        sendHtml(res, 200, loginPage());
        return;
      }

      if (req.method === "POST" && path === "/api/login") {
        let body;
        try {
          body = await readJson(req);
        } catch {
          sendJson(res, 400, { error: "invalid_json" });
          return;
        }
        const email = typeof body.email === "string" ? body.email : "";
        const providedPassword =
          typeof body.password === "string" ? body.password : "";
        if (email !== username || providedPassword !== password) {
          sendJson(res, 401, { error: "invalid_credentials" });
          return;
        }
        const sessionId = randomUUID();
        sessions.set(sessionId, { username: email });
        setSessionCookie(res, sessionId);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && path === "/settings/profile") {
        if (!getSession(req)) {
          res.writeHead(302, { Location: "/login" });
          res.end();
          return;
        }
        sendHtml(res, 200, profilePage());
        return;
      }

      if (req.method === "GET" && path === "/api/profile") {
        if (!getSession(req)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        sendJson(res, 200, { ...profile });
        return;
      }

      if (req.method === "PUT" && path === "/api/profile") {
        if (!getSession(req)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        let body;
        try {
          body = await readJson(req);
        } catch {
          sendJson(res, 400, { error: "invalid_json" });
          return;
        }
        if (typeof body.displayName !== "string" || !body.displayName.trim()) {
          sendJson(res, 400, { error: "invalid_display_name" });
          return;
        }
        profile = { displayName: body.displayName.trim() };
        sendJson(res, 200, { ...profile });
        return;
      }

      if (req.method === "POST" && path === "/api/logout") {
        const active = getSession(req);
        if (active) sessions.delete(active.id);
        clearSessionCookie(res);
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      console.error("fixture error:", error instanceof Error ? error.message : "unknown");
      sendJson(res, 500, { error: "internal_error" });
    }
  });

  return {
    server,
    getCredentials() {
      return { username, password };
    },
    getProfile() {
      return { ...profile };
    },
    resetProfile(displayName = "Demo User") {
      profile = { displayName };
    }
  };
}

/**
 * Start the fixture on a local port.
 * @param {{ port?: number, host?: string, username?: string, password?: string, initialDisplayName?: string }} [options]
 */
export async function startServer(options = {}) {
  const port =
    options.port ??
    Number(process.env.PORT || process.env.AUTOTOUR_FIXTURE_PORT || 0);
  const host = options.host ?? "127.0.0.1";
  const fixture = createFixture(options);

  await new Promise((resolve, reject) => {
    fixture.server.once("error", reject);
    fixture.server.listen(port, host, () => {
      fixture.server.off("error", reject);
      resolve();
    });
  });

  const address = fixture.server.address();
  const resolvedPort =
    typeof address === "object" && address ? address.port : Number(port);

  return {
    ...fixture,
    host,
    port: resolvedPort,
    baseUrl: `http://${host}:${resolvedPort}`,
    async close() {
      await new Promise((resolve, reject) => {
        fixture.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMain()) {
  const port = Number(process.env.PORT || process.env.AUTOTOUR_FIXTURE_PORT || 4173);
  const started = await startServer({ port });
  console.log(`demo-app listening on ${started.baseUrl}`);
  console.log("health: GET /health");
  console.log("Set AUTOTOUR_USERNAME and AUTOTOUR_PASSWORD for test credentials.");
}
