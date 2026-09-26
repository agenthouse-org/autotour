import assert from "node:assert/strict";
import test from "node:test";
import {
  AnnotationError,
  AnnotationErrorCode,
  createAnnotationError,
  sanitizeDetails
} from "../../src/annotations/errors.js";

test("structured errors omit unsafe detail keys such as secrets", () => {
  const error = createAnnotationError(
    AnnotationErrorCode.REDACTION_FAILED,
    "Configured redaction could not be applied.",
    {
      details: {
        stepId: "save-profile",
        selectorCount: 1,
        textRuleCount: 1,
        secret: "super-secret-token",
        texts: ["super-secret-token"],
        password: "hunter2"
      }
    }
  );

  assert.ok(error instanceof AnnotationError);
  assert.deepEqual(error.details, {
    stepId: "save-profile",
    selectorCount: 1,
    textRuleCount: 1
  });
  assert.equal(JSON.stringify(error.toJSON()).includes("super-secret-token"), false);
  assert.equal(JSON.stringify(error.toJSON()).includes("hunter2"), false);
});

test("sanitizeDetails keeps only allow-listed primitive fields", () => {
  assert.deepEqual(
    sanitizeDetails({
      moduleId: "update-profile",
      role: "button",
      name: "Save profile",
      rawHtml: "<input value='secret'>",
      nested: { a: 1 }
    }),
    {
      moduleId: "update-profile",
      role: "button",
      name: "Save profile"
    }
  );
});
