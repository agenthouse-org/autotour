# MVP parallel-work contracts

These contracts let ST-01, ST-02, and ST-03 develop independently. Changes require review across all three stories.

## Fixture contract

- Base URL is supplied at runtime.
- `GET /health` returns a successful response when ready.
- `GET /login` exposes `Email`, `Password`, and `Sign in` controls.
- `POST /api/login` rejects invalid credentials and establishes a test session for valid credentials.
- `GET /settings/profile` requires that session and exposes `Display name` and `Save profile` controls.
- `GET /api/profile` returns the current profile.
- `PUT /api/profile` updates and returns the profile.
- Credentials are read from `AUTOTOUR_USERNAME` and `AUTOTOUR_PASSWORD`.

## Capture-step contract

```json
{
  "id": "save-profile",
  "moduleId": "update-profile",
  "action": "click",
  "description": "Save the updated display name.",
  "target": {
    "role": "button",
    "name": "Save profile"
  },
  "route": "/settings/profile",
  "observedRequests": ["PUT /api/profile"],
  "annotation": {
    "callout": 1,
    "caption": "Save the updated profile."
  }
}
```

IDs use lowercase kebab-case and derive from user-visible task meaning rather than DOM position. Secret values, cookies, tokens, and storage state are never part of this contract.

## Annotation result contract

```json
{
  "stepId": "save-profile",
  "path": "output/update-profile/save-profile.png",
  "width": 1280,
  "height": 720,
  "targetBox": { "x": 900, "y": 620, "width": 140, "height": 40 },
  "callout": 1
}
```

Automated tests establish behavior and stable metadata. A human or visual-review method must still inspect readability and accidental disclosure before acceptance.

## Ownership boundaries

- ST-01: `fixtures/demo-app/**` and fixture-specific tests.
- ST-02: `src/capture/**` and capture-specific tests.
- ST-03: `src/annotations/**` and annotation-specific tests.
- Shared files such as `package.json`, `src/index.js`, schemas, and this contract are changed during integration, not independently by parallel agents.
