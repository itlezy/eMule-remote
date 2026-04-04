# eMule Remote

`eMule Remote` is a standalone Node.js companion app for the desktop eMule build.
It provides:

- a local HTTP API under `/api/v2`
- a grouped operator Svelte web UI served by the same process
- a named-pipe client that talks to the running eMule desktop app
- a local pointer to the canonical contract in [`docs/API-CONTRACT.md`](./docs/API-CONTRACT.md)

This project lives next to the clean `v0.72a` workspace at:

- `C:\prj\p2p\eMule\eMulebb\eMule-remote`

## Requirements

- Node.js 22 or newer
- a built `emule.exe` from the sibling `eMule-build-v0.72` workspace

The remote connects to the eMule named pipe:

- `\\.\pipe\emule-api`

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

## Supported Branch

- `v0.72a-clean`

Historical frozen branch:

- `main`

## Default Runtime

By default the service listens on:

- `http://127.0.0.1:4713`

The root page serves the bundled web UI.
The API base is:

- `http://127.0.0.1:4713/api/v2`

The UI and HTTP surface follow the same grouped contract:

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
  Bearer token for API clients. Default: `change-me`
- `EMULE_REMOTE_PIPE`
  Named pipe path. Default: `\\.\pipe\emule-api`
- `EMULE_REMOTE_TIMEOUT_MS`
  Pipe request timeout in milliseconds. Default: `5000`
- `EMULE_REMOTE_RECONNECT_MS`
  Pipe reconnect delay in milliseconds. Default: `1500`

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

## Notes

- The desktop eMule process must be running for the remote to reach the named pipe.
- `GET /health` stays available even if eMule is not connected yet.
- The bundled web UI is served from the same Fastify process as the API.
- The canonical API contract lives in the sibling app repo at `eMule-build-v0.72\eMule\docs\PLAN-API-SERVER.md`.
- External API clients use bearer auth, while the bundled UI uses a same-origin cookie set by `/`.
