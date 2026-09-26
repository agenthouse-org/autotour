import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CaptureError, captureJourney } from "../../src/capture/index.js";
import { createFixturePageDouble } from "./fixture-page.js";

const BASE_URL = "https://fixture.test";

function createPublicJourney() {
  return {
    id: "discover-dealdesk",
    title: "Discover DealDesk",
    modules: [
      {
        id: "homepage-overview",
        title: "Homepage overview",
        route: "/en/",
        steps: [
          {
            id: "open-homepage",
            action: "goto",
            description: "Open the English homepage.",
            path: "/en/"
          },
          {
            id: "scroll-down",
            action: "scroll",
            description: "Review the homepage.",
            scroll: { mode: "by", x: 0, y: 640, durationMs: 300 }
          },
          {
            id: "scroll-top",
            action: "scroll",
            description: "Return to the navigation.",
            scroll: { mode: "to", x: 0, y: 0, durationMs: 300 }
          },
          {
            id: "open-automation",
            action: "click",
            description: "Open Automation.",
            target: { role: "button", name: "Automation" }
          },
          {
            id: "confirm-automation",
            action: "assert",
            description: "Confirm the Automation menu is visible.",
            target: { role: "link", name: "Agentic Applications" },
            state: "visible",
            timeoutMs: 1000
          },
          {
            id: "choose-mode",
            action: "select",
            description: "Choose a documentation mode.",
            target: { role: "combobox", name: "Mode" },
            value: "guided"
          },
          {
            id: "brief-pause",
            action: "wait",
            description: "Pause for the viewer.",
            durationMs: 250
          }
        ]
      },
      {
        id: "dealdesk-overview",
        title: "DealDesk overview",
        route: "/en/dealdesk/",
        steps: [
          {
            id: "open-dealdesk",
            action: "goto",
            description: "Open DealDesk.",
            path: "/en/dealdesk/"
          },
          {
            id: "confirm-dealdesk-url",
            action: "assert",
            description: "Confirm the DealDesk page loaded.",
            url: "/en/dealdesk/",
            timeoutMs: 1000
          }
        ]
      }
    ]
  };
}

test("generic public journeys execute scroll, wait, click, and assertions without credentials", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-generic-"));
  const page = createFixturePageDouble({ baseUrl: BASE_URL });

  const result = await captureJourney({
    baseUrl: BASE_URL,
    goal: "Introduce DealDesk to prospective customers.",
    outputDir,
    env: {},
    page,
    journey: createPublicJourney()
  });

  assert.deepEqual(
    page.actions().map((action) => action.type),
    ["goto", "scroll", "scroll", "click", "assert-visible", "select", "wait", "goto", "assert-url"]
  );
  assert.deepEqual(result.walkthrough.outputs, ["screenshots"]);
  const scroll = result.captureSteps.find((step) => step.id === "scroll-down");
  assert.deepEqual(scroll.scroll, { mode: "by", x: 0, y: 640, durationMs: 300 });
  const urlAssertion = result.captureSteps.find((step) => step.id === "confirm-dealdesk-url");
  assert.equal(urlAssertion.url, "/en/dealdesk/");
  assert.equal(urlAssertion.timeoutMs, 1000);
});

test("invalid timing is rejected with module and step diagnostics", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-timing-"));
  const page = createFixturePageDouble({ baseUrl: BASE_URL });
  const journey = createPublicJourney();
  journey.modules[0].steps[1].scroll.durationMs = 30001;

  await assert.rejects(
    () => captureJourney({
      baseUrl: BASE_URL,
      goal: "Introduce DealDesk.",
      outputDir,
      env: {},
      page,
      journey
    }),
    (error) => {
      assert.equal(error.moduleId, "homepage-overview");
      assert.equal(error.stepId, "scroll-down");
      assert.match(error.cause, /between 0 and 30000/);
      return true;
    }
  );
});

test("failed generic assertions identify the responsible module and step", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-generic-"));
  const page = createFixturePageDouble({ baseUrl: BASE_URL, hiddenTargets: ["link:Agentic Applications"] });

  await assert.rejects(
    () => captureJourney({
      baseUrl: BASE_URL,
      goal: "Introduce DealDesk.",
      outputDir,
      env: {},
      page,
      journey: createPublicJourney()
    }),
    (error) => {
      assert.equal(error instanceof CaptureError, true);
      assert.equal(error.moduleId, "homepage-overview");
      assert.equal(error.stepId, "confirm-automation");
      assert.match(error.cause, /visible/i);
      return true;
    }
  );
});

test("schema-shaped walkthrough JSON can be executed directly", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "autotour-json-"));
  const page = createFixturePageDouble({ baseUrl: BASE_URL });
  const journey = {
    schemaVersion: 1,
    id: "json-journey",
    title: "JSON journey",
    target: { baseUrl: BASE_URL, goal: "Show JSON execution." },
    publish: true,
    outputs: ["screenshots"],
    modules: [{
      id: "navigation",
      title: "Navigation",
      route: "/",
      dependencies: { views: ["homepage-navigation"] },
      assets: {},
      steps: [
        { id: "open", action: "goto", description: "Open the page.", path: "/" },
        {
          id: "open-menu",
          action: "click",
          description: "Open the menu.",
          selector: "text=\"Automation\""
        }
      ]
    }]
  };

  const result = await captureJourney({ journey, outputDir, env: {}, page });
  assert.equal(result.walkthrough.target.baseUrl, BASE_URL);
  assert.equal(result.walkthrough.target.goal, "Show JSON execution.");
  assert.equal(result.walkthrough.publish, true);
  assert.deepEqual(result.walkthrough.modules[0].dependencies.views, ["homepage-navigation"]);
  assert.deepEqual(page.actions().map((action) => action.type), ["goto", "click"]);
});

