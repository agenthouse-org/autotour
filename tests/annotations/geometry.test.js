import assert from "node:assert/strict";
import test from "node:test";
import {
  clampRectToViewport,
  clipRectToViewport,
  estimateCaptionSize,
  placeCallout,
  placeCaption,
  rectsIntersect
} from "../../src/annotations/geometry.js";

const VIEWPORT = Object.freeze({ width: 1280, height: 720 });

test("clipRectToViewport keeps fully visible boxes unchanged", () => {
  const box = { x: 100, y: 200, width: 140, height: 40 };
  assert.deepEqual(clipRectToViewport(box, VIEWPORT), box);
});

test("clipRectToViewport clips overflow and returns null when outside", () => {
  assert.deepEqual(clipRectToViewport({ x: 1200, y: 700, width: 140, height: 40 }, VIEWPORT), {
    x: 1200,
    y: 700,
    width: 80,
    height: 20
  });
  assert.equal(clipRectToViewport({ x: 1400, y: 10, width: 50, height: 50 }, VIEWPORT), null);
});

test("placeCallout is deterministic and prefers top-right when it fits", () => {
  const target = { x: 900, y: 620, width: 140, height: 40 };
  const first = placeCallout(target, VIEWPORT);
  const second = placeCallout(target, VIEWPORT);
  assert.deepEqual(first, second);
  assert.equal(first.placement, "top-right");
  assert.equal(first.width, 28);
  assert.equal(first.height, 28);
});

test("placeCallout falls back when top-right would leave the viewport", () => {
  const target = { x: 1260, y: 0, width: 20, height: 20 };
  const callout = placeCallout(target, VIEWPORT, { size: 28 });
  assert.ok(["top-left", "bottom-left", "bottom-right", "clamped"].includes(callout.placement));
  assert.ok(callout.x >= 0);
  assert.ok(callout.y >= 0);
  assert.ok(callout.x + callout.width <= VIEWPORT.width);
  assert.ok(callout.y + callout.height <= VIEWPORT.height);
});

test("placeCaption prefers below and never covers the target when space exists", () => {
  const target = { x: 500, y: 200, width: 120, height: 40 };
  const caption = placeCaption(target, VIEWPORT, "Save the updated profile.");
  assert.equal(caption.placement, "below");
  assert.equal(rectsIntersect(caption, target), false);
  assert.ok(caption.y >= target.y + target.height);
  assert.deepEqual(placeCaption(target, VIEWPORT, "Save the updated profile."), caption);
});

test("placeCaption moves above when below does not fit", () => {
  const target = { x: 500, y: 680, width: 120, height: 30 };
  const caption = placeCaption(target, VIEWPORT, "Save the updated profile.");
  assert.equal(caption.placement, "above");
  assert.equal(rectsIntersect(caption, target), false);
});

test("estimateCaptionSize wraps long captions deterministically", () => {
  const long =
    "Save the updated profile after confirming the display name and email are correct for this account.";
  const first = estimateCaptionSize(long, { maxWidth: 240 });
  const second = estimateCaptionSize(long, { maxWidth: 240 });
  assert.deepEqual(first, second);
  assert.ok(first.lines.length > 1);
  assert.ok(first.width <= 240);
});

test("clampRectToViewport keeps dimensions when possible", () => {
  assert.deepEqual(
    clampRectToViewport({ x: -10, y: 710, width: 40, height: 20 }, VIEWPORT),
    { x: 0, y: 700, width: 40, height: 20 }
  );
});
