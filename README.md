# eMule Remote

`eMule Remote` is a standalone Node.js companion app for the desktop eMule build.
It provides:

- a local HTTP API under `/api/v1`
- a grouped operator Svelte web UI served by the same process
- an authenticated REST bridge to the running eMule desktop app
- a local pointer to the canonical contract in [`docs/API-CONTRACT.md`](./docs/API-CONTRACT.md)

In the canonical layout this repo lives under
`EMULE_WORKSPACE_ROOT\repos\eMule-remote`.

## Requirements

- Node.js 22 or newer
- a running `emule.exe` with the in-process REST API enabled on its WebServer listener

By default the remote expects the local eMule REST endpoint at:

- `http://127.0.0.1:4711`

## Install

```cmd
npm install
```

## Helper Scripts

The repo includes Windows-friendly helpers in [`scripts`](./scripts):

- `scripts\build-remote.cmd`
  Builds the Vite frontend and the TypeScript server output.
- `scripts\dev-remote.cmd`
  Runs the Fastify server directly from TypeScript for development.
- `scripts\run-remote.cmd`
  Starts the built server and auto-builds first if needed.

## Default Runtime

By default the service listens on:

- `http://127.0.0.1:4713`

The root page serves the bundled web UI.
The API base is:

- `http://127.0.0.1:4713/api/v1`

`eMule-remote` proxies the eMule REST surface 1:1:

- `app/*`
- `stats/*`
- `transfers/*`
- `uploads/*`
- `servers/*`
- `kad/*`
- `shared/*`
- `search/*`
- `log/*`

## Environment Variables

- `EMULE_REMOTE_HOST`
  HTTP bind address. Default: `127.0.0.1`
- `EMULE_REMOTE_PORT`
  HTTP port. Default: `4713`
- `EMULE_REMOTE_TOKEN`
  Bearer token for external API clients. Default: `change-me`
- `EMULE_REMOTE_EMULE_BASE_URL`
  Upstream eMule listener root. Default: `http://127.0.0.1:4711`
  Do not append `/api/v1`; the remote proxy adds that path itself.
- `EMULE_REMOTE_EMULE_API_KEY`
  Upstream eMule REST API key. No default.
- `EMULE_REMOTE_TIMEOUT_MS`
  Upstream REST request timeout in milliseconds. Default: `5000`

## Typical Usage

Build:

```cmd
scripts\build-remote.cmd
```

Run the production build:

```cmd
scripts\run-remote.cmd
```

Run the server in development mode:

```cmd
scripts\dev-remote.cmd
```

Run the live proxy contract smoke against a real local eMule REST listener:

```cmd
npm run smoke:live
```

The smoke uses:

- `EMULE_REMOTE_EMULE_BASE_URL` for the upstream listener root
- `EMULE_REMOTE_EMULE_API_KEY` for the upstream `X-API-Key`

## Notes

- The desktop eMule process must be running and reachable on its WebServer/REST endpoint.
- `GET /health` stays available even if eMule is unreachable.
- `/health` is a local `eMule-remote` helper route, not part of the upstream eMule REST contract.
- The bundled web UI is served from the same Fastify process as the API.
- External API clients use bearer auth, while the bundled UI uses a same-origin cookie set by `/`.
- The remote injects the upstream `X-API-Key` server-side, so the browser never sees the eMule API key.
