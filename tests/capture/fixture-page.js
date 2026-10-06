import { EventEmitter } from "node:events";

/**
 * Deterministic Playwright-like page double for capture tests.
 * Simulates the ST-01 fixture contract without requiring the fixture app.
 */
export function createFixturePageDouble({
  baseUrl = "https://fixture.test",
  username = "capture-user@example.test",
  password = "capture-secret-value",
  initialDisplayName = "Original Name",
  hiddenTargets = []
} = {}) {
  const origin = new URL(baseUrl);
  const emitter = new EventEmitter();
  const fields = new Map();
  let route = "/";
  let authenticated = false;
  let displayName = initialDisplayName;
  /** @type {string[]} */
  const actions = [];
  const hidden = new Set(hiddenTargets);

  function emitApi(method, pathname) {
    const url = new URL(pathname, origin).toString();
    emitter.emit("request", {
      url: () => url,
      method: () => method
    });
  }

  function locatorFor(role, name, index) {
    const key = `${role}:${name}`;
    return {
      nth(selectedIndex) {
        return locatorFor(role, name, selectedIndex);
      },
      async fill(value) {
        actions.push({ type: "fill", role, name, value, ...(index === undefined ? {} : { index }) });
        fields.set(key, value);
      },
      async click() {
        actions.push({ type: "click", role, name, ...(index === undefined ? {} : { index }) });
        if (role === "button" && name === "Sign in") {
          const email = fields.get("textbox:Email");
          const pass = fields.get("textbox:Password");
          emitApi("POST", "/api/login");
          if (email !== username || pass !== password) {
            throw new Error("Invalid credentials");
          }
          authenticated = true;
          route = "/settings/profile";
          return;
        }
        if (role === "button" && name === "Save profile") {
          if (!authenticated) {
            throw new Error("Authentication required");
          }
          displayName = fields.get("textbox:Display name") ?? displayName;
          emitApi("PUT", "/api/profile");
        }
      },
      async selectOption(value) {
        actions.push({ type: "select", role, name, value, ...(index === undefined ? {} : { index }) });
        fields.set(key, value);
      },
      async waitFor({ state = "visible" } = {}) {
        actions.push({ type: `assert-${state}`, role, name, ...(index === undefined ? {} : { index }) });
        if (state === "visible" && hidden.has(key)) {
          throw new Error(`${role} ${name} is not visible`);
        }
      }
    };
  }

  const page = {
    on(event, listener) {
      emitter.on(event, listener);
    },
    off(event, listener) {
      emitter.off(event, listener);
    },
    getByRole(role, { name } = {}) {
      return locatorFor(role, name);
    },
    getByText(text) {
      return locatorFor("text", text);
    },
    async goto(url) {
      const target = new URL(url, origin);
      actions.push({ type: "goto", url: target.toString() });
      route = target.pathname;
      if (target.pathname === "/settings/profile") {
        if (!authenticated) {
          throw new Error("Authentication required");
        }
        emitApi("GET", "/api/profile");
      }
    },
    async evaluate(_callback, value) {
      actions.push({ type: "scroll", ...value });
    },
    async waitForTimeout(durationMs) {
      actions.push({ type: "wait", durationMs });
    },
    async waitForURL(expected) {
      actions.push({ type: "assert-url", expected });
      const current = new URL(route, origin);
      const expectedUrl = new URL(expected, origin);
      if (current.pathname !== expectedUrl.pathname) {
        throw new Error(`Expected URL ${expectedUrl.pathname}, received ${current.pathname}`);
      }
    },
    url() {
      return new URL(route, origin).toString();
    },
    actions: () => [...actions],
    state: () => ({
      authenticated,
      displayName,
      route,
      fields: Object.fromEntries(fields)
    })
  };

  return page;
}
