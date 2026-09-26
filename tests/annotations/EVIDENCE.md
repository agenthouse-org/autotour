# ST-03 annotation evidence record

## Automated evidence

Covered by `tests/annotations/**` (16 passed):

- Pure geometry and caption/callout placement are deterministic for equivalent inputs.
- Asset paths follow `output/{moduleId}/{stepId}.png` (tests use ignored `.autotour/output/annotations-tests/...`).
- Playwright rendering against a synthetic data-URL page asserts PNG magic bytes, stable dimensions/metadata, DOM overlay presence, and absence of configured redaction values from page text and PNG bytes.

## Visual evidence (inspected; not acceptance)

Automated checks do **not** prove acceptance by themselves. A generated screenshot was inspected at:

`.agenthouse/evidence/st-03/save-profile.png`

Inspection findings (agent review of that PNG):

1. Target `"Save profile"` has a visible blue highlight outline.
2. Numbered callout `1` sits on the highlight (top-right association).
3. Caption `"Save the updated profile."` is readable below the target and does not cover it.
4. Configured email/token content is not visible; selector redaction obscures the session-token region.

Human acceptance review is still required before lifecycle accept.
