/** Shared ceiling for timeoutMs and stableForMs. Keep schemas/walkthrough.schema.json in step with this value. */
export const MAX_WAIT_MS = 120000;

/** Pacing delays, scroll duration, and DOM step delay stay on the shorter ceiling. */
export const MAX_PACING_MS = 30000;
