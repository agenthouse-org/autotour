import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { AnnotationError, AnnotationErrorCode } from "../../src/annotations/errors.js";
import {
  buildAnnotationAssetPath,
  resolveAnnotationOutputPath
} from "../../src/annotations/paths.js";

test("buildAnnotationAssetPath uses deterministic module/step naming", () => {
  assert.equal(
    buildAnnotationAssetPath("update-profile", "save-profile"),
    "output/update-profile/save-profile.png"
  );
  assert.equal(
    buildAnnotationAssetPath("update-profile", "save-profile", { outputRoot: "output/" }),
    "output/update-profile/save-profile.png"
  );
});

test("buildAnnotationAssetPath rejects invalid ids", () => {
  assert.throws(
    () => buildAnnotationAssetPath("Update Profile", "save-profile"),
    (error) =>
      error instanceof AnnotationError && error.code === AnnotationErrorCode.INVALID_INPUT
  );
});

test("resolveAnnotationOutputPath joins against cwd with forward-slash assets", () => {
  const resolved = resolveAnnotationOutputPath("output/update-profile/save-profile.png", "/tmp/app");
  assert.equal(resolved, path.resolve("/tmp/app", "output", "update-profile", "save-profile.png"));
});
