import { CaptureError } from "../capture/errors.js";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeDomPresentation(value, secrets = []) {
  if (value === undefined) return defaultPresentation();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPresentation("recordDom.presentation must be an object.", secrets);
  }

  const frame = objectOption(value.frame, "frame", secrets);
  const background = objectOption(value.background, "background", secrets);
  const cursor = objectOption(value.cursor, "cursor", secrets);
  const focus = objectOption(value.focus, "focus", secrets);
  const mode = enumOption(frame.mode ?? "pure", ["pure", "background", "window"], "frame.mode", secrets);
  const backgroundMode = enumOption(
    background.mode ?? (mode === "pure" ? "transparent" : "solid"),
    ["transparent", "solid", "gradient"],
    "background.mode",
    secrets
  );

  return {
    frame: {
      mode,
      title: stringOption(frame.title ?? "Walkthrough", "frame.title", 80, secrets),
      cornerRadius: integerOption(frame.cornerRadius ?? (mode === "window" ? 10 : 0), 0, 24, "frame.cornerRadius", secrets),
      shadow: booleanOption(frame.shadow ?? mode === "window", "frame.shadow", secrets)
    },
    background: {
      mode: backgroundMode,
      color: colorOption(background.color ?? "#101512", "background.color", secrets),
      from: colorOption(background.from ?? "#111815", "background.from", secrets),
      to: colorOption(background.to ?? "#26342b", "background.to", secrets)
    },
    padding: integerOption(value.padding ?? (mode === "pure" ? 12 : 48), 0, 120, "padding", secrets),
    cursor: {
      scale: numberOption(cursor.scale ?? 1, 1, 3, "cursor.scale", secrets),
      moveDurationMs: integerOption(cursor.moveDurationMs ?? 650, 0, 2000, "cursor.moveDurationMs", secrets),
      clickPulse: booleanOption(cursor.clickPulse ?? true, "cursor.clickPulse", secrets),
      clickDurationMs: integerOption(cursor.clickDurationMs ?? 700, 100, 2000, "cursor.clickDurationMs", secrets)
    },
    focus: {
      mode: enumOption(focus.mode ?? "off", ["off", "clicks"], "focus.mode", secrets),
      scale: numberOption(focus.scale ?? 1.3, 1.05, 2, "focus.scale", secrets),
      durationMs: integerOption(focus.durationMs ?? 650, 0, 2000, "focus.durationMs", secrets),
      holdMs: integerOption(focus.holdMs ?? 2400, 0, 10000, "focus.holdMs", secrets)
    }
  };
}

function defaultPresentation() {
  return normalizeDomPresentation({});
}

function objectOption(value, name, secrets) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPresentation(`recordDom.presentation.${name} must be an object.`, secrets);
  }
  return value;
}

function enumOption(value, allowed, name, secrets) {
  if (!allowed.includes(value)) {
    throw invalidPresentation(`recordDom.presentation.${name} must be one of: ${allowed.join(", ")}.`, secrets);
  }
  return value;
}

function stringOption(value, name, maxLength, secrets) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw invalidPresentation(`recordDom.presentation.${name} must be a string no longer than ${maxLength} characters.`, secrets);
  }
  return value;
}

function colorOption(value, name, secrets) {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw invalidPresentation(`recordDom.presentation.${name} must be a six-digit hex color.`, secrets);
  }
  return value.toLowerCase();
}

function integerOption(value, min, max, name, secrets) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalidPresentation(`recordDom.presentation.${name} must be an integer from ${min} to ${max}.`, secrets);
  }
  return value;
}

function numberOption(value, min, max, name, secrets) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw invalidPresentation(`recordDom.presentation.${name} must be a number from ${min} to ${max}.`, secrets);
  }
  return value;
}

function booleanOption(value, name, secrets) {
  if (typeof value !== "boolean") {
    throw invalidPresentation(`recordDom.presentation.${name} must be true or false.`, secrets);
  }
  return value;
}

function invalidPresentation(message, secrets) {
  return new CaptureError({
    message: "DOM presentation configuration is invalid.",
    cause: message,
    secrets
  });
}
