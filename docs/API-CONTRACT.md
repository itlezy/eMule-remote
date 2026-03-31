# API Contract

This document defines the current stable v1 surface for `eMule-remote`.

## Auth

External API clients must send:

```http
Authorization: Bearer <token>
```

The bundled web UI uses a same-origin cookie session:

- visiting `/` sets `emule_remote_ui=1`
- subsequent browser requests from that UI are accepted without a bearer token

`GET /health` is unauthenticated.

## Error Shape

All HTTP errors use:

```json
{
  "error": "CODE",
  "message": "human readable text"
}
```

Status codes:

- `400` invalid argument or malformed request
- `401` missing or invalid auth
- `404` requested hash was not found
- `503` eMule pipe unavailable
- `504` eMule pipe timeout
- `500` unexpected server failure

## Routes

### `GET /health`

Returns:

```json
{
  "ok": true,
  "pipeConnected": true
}
```

### `GET /api/v1/system/version`

Returns one version object:

```json
{
  "appName": "eMule",
  "version": "0.72a.1 x64 DEBUG",
  "build": "debug",
  "platform": "x64"
}
```

### `GET /api/v1/system/stats`

Returns one `SystemStats` object.

### `GET /api/v1/downloads`

Returns a raw array of `Download` objects.

### `GET /api/v1/downloads/:hash`

- `:hash` must be a lowercase 32-character MD4 hex string
- returns one `Download` object

### `GET /api/v1/downloads/:hash/sources`

- `:hash` must be a lowercase 32-character MD4 hex string
- returns a raw array of `Source` objects

### `POST /api/v1/downloads`

Request:

```json
{
  "links": [
    "ed2k://|file|..."
  ]
}
```

Returns:

```json
{
  "results": [
    {
      "ok": true,
      "hash": "8958fd13501ed0347af4df142e8f5f9e",
      "name": "Example.bin"
    }
  ]
}
```

### `POST /api/v1/downloads/pause`
### `POST /api/v1/downloads/resume`
### `POST /api/v1/downloads/stop`

Request:

```json
{
  "hashes": [
    "8958fd13501ed0347af4df142e8f5f9e"
  ]
}
```

Returns:

```json
{
  "results": [
    {
      "hash": "8958fd13501ed0347af4df142e8f5f9e",
      "ok": true
    }
  ]
}
```

### `POST /api/v1/downloads/delete`

Request:

```json
{
  "hashes": [
    "8958fd13501ed0347af4df142e8f5f9e"
  ],
  "deleteFiles": true
}
```

Behavior:

- `deleteFiles` defaults to `false`
- incomplete and complete download deletion currently require `deleteFiles=true`
- when `deleteFiles=false`, the route still returns `200`, but each item can report `ok: false`

### `POST /api/v1/downloads/:hash/recheck`

- `:hash` must be a lowercase 32-character MD4 hex string
- returns:

```json
{
  "ok": true
}
```

### `GET /api/v1/log?limit=200`

- returns a raw array of `LogEntry` objects
- `limit` defaults to `200`
- `limit` is clamped to `1..500`

### `GET /api/v1/events`

Returns an SSE stream with messages shaped as:

```json
{
  "event": "download_updated",
  "data": {}
}
```

The first event is always:

```json
{
  "event": "ready",
  "data": {
    "pipeConnected": true
  }
}
```

## Resource Shapes

### `SystemStats`

```json
{
  "connected": false,
  "downloadSpeed": 0,
  "uploadSpeed": 0,
  "sessionDownloaded": 0,
  "sessionUploaded": 0,
  "activeUploads": 0,
  "waitingUploads": 0,
  "downloadCount": 0,
  "ed2kConnected": false,
  "ed2kHighId": false,
  "kadRunning": false,
  "kadConnected": false,
  "kadFirewalled": null
}
```

### `Download`

```json
{
  "hash": "8958fd13501ed0347af4df142e8f5f9e",
  "name": "Example.bin",
  "size": 3280286,
  "sizeDone": 0,
  "progress": 0,
  "state": "stalled",
  "priority": "auto",
  "autoPriority": true,
  "downloadSpeed": 0,
  "uploadSpeed": 0,
  "sources": 0,
  "sourcesTransferring": 0,
  "eta": null,
  "addedAt": 1774986830,
  "completedAt": null,
  "partsTotal": 1,
  "partsAvailable": 0,
  "stopped": false
}
```

### `Source`

```json
{
  "userName": "Example User",
  "userHash": "",
  "clientSoftware": "eMule",
  "downloadState": "none",
  "downloadRate": 0,
  "availableParts": 0,
  "partCount": 0,
  "ip": "127.0.0.1",
  "port": 4662,
  "serverIp": "",
  "serverPort": 0,
  "lowId": false,
  "queueRank": 0
}
```

### `LogEntry`

```json
{
  "timestamp": 1774986830,
  "message": "connected to server",
  "level": "info",
  "debug": false
}
```
