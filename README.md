# eMule Remote

`eMule Remote` is a standalone Node.js companion app for the desktop eMule build.
It provides:

- a local HTTP API under `/api/v1`
- a basic Svelte web UI served by the same process
- a named-pipe client that talks to the running eMule desktop app

This project lives next to the main workspace at:

- `C:\prj\p2p\eMule\eMulebb\eMule-remote`

## Requirements

- Node.js 22 or newer
- a built `emule.exe` from the sibling `eMule-build` workspace

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

## Default Runtime

By default the service listens on:

- `http://127.0.0.1:4713`

The root page serves the bundled web UI.
The API base is:

- `http://127.0.0.1:4713/api/v1`

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
