const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /^(?:password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|authorization|cookie|set-cookie|storage[_-]?state|session|auth)$/i;

const COOKIE_LIKE = /(?:^|[;\s])(?:session|sid|auth|token|jwt)=[^;\s]+/gi;
const BEARER_LIKE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

/**
 * Collect secret strings that must never appear in manifests or diagnostics.
 * @param {Iterable<string | undefined | null>} values
 * @returns {string[]}
 */
export function collectSecretValues(values) {
  const secrets = new Set();
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      secrets.add(value);
    }
  }
  return [...secrets].sort((a, b) => b.length - a.length);
}

/**
 * @param {unknown} value
 * @param {Iterable<string>} secrets
 * @returns {unknown}
 */
export function redactValue(value, secrets) {
  const list = collectSecretValues(secrets);
  if (typeof value === "string") {
    return redactString(value, list);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, list));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(entry, list);
    }
    return out;
  }
  return value;
}

/**
 * @param {string} text
 * @param {Iterable<string>} secrets
 * @returns {string}
 */
export function redactString(text, secrets) {
  let result = String(text);
  for (const secret of collectSecretValues(secrets)) {
    if (secret.length === 0) {
      continue;
    }
    result = result.split(secret).join(REDACTED);
  }
  result = result.replace(BEARER_LIKE, `Bearer ${REDACTED}`);
  result = result.replace(JWT_LIKE, REDACTED);
  result = result.replace(COOKIE_LIKE, (match) => {
    const eq = match.indexOf("=");
    return `${match.slice(0, eq + 1)}${REDACTED}`;
  });
  return result;
}

/**
 * True when any supplied secret appears in the serialized payload.
 * @param {unknown} value
 * @param {Iterable<string>} secrets
 * @returns {boolean}
 */
export function containsSecret(value, secrets) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof serialized !== "string") {
    return false;
  }
  return collectSecretValues(secrets).some((secret) => serialized.includes(secret));
}

export { REDACTED };
