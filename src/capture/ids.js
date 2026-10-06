/**
 * Deterministic lowercase kebab-case identifiers from user-visible task meaning.
 * IDs must not depend on DOM position, timestamps, or random values.
 */

const NON_ALNUM = /[^a-z0-9]+/g;
const TRIM_DASH = /^-+|-+$/g;
const MULTI_DASH = /-+/g;

/**
 * @param {string} value
 * @returns {string}
 */
export function toStableId(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("stable id input must be a non-empty string");
  }

  const id = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(NON_ALNUM, "-")
    .replace(MULTI_DASH, "-")
    .replace(TRIM_DASH, "");

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`unable to derive a stable id from ${JSON.stringify(value)}`);
  }

  return id;
}
