# AutoTour demo-app fixture

Minimal deterministic Node HTTP app used by AutoTour MVP stories. It is test-only and not a production authentication pattern.

## Start

From the repository root (Node.js 20+):

```sh
node fixtures/demo-app/server.js
```

Optional environment:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` or `AUTOTOUR_FIXTURE_PORT` | Listen port | `4173` |
| `AUTOTOUR_USERNAME` | Authorized test email | `test-user@example.com` |
| `AUTOTOUR_PASSWORD` | Authorized test password | `test-password` |

Defaults are for local fixture use only. Do not commit real credentials.

## Contract routes

- `GET /health` — readiness JSON `{ "ok": true }`
- `GET /login` — `Email`, `Password`, `Sign in`
- `POST /api/login` — session cookie on success; `401` on failure
- `GET /settings/profile` — requires session; `Display name`, `Save profile`
- `GET /api/profile` / `PUT /api/profile` — profile read/update (in-memory)

Diagnostics log only `METHOD /path` and never print passwords, cookies, or tokens.

## Programmatic use

```js
import { startServer } from "./server.js";

const app = await startServer({ port: 0 });
// app.baseUrl, app.close()
```
