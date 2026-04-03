import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';

import { PipeClient } from './pipe/PipeClient.js';

const runLivePipeTest = process.env.EMULE_REMOTE_RUN_LIVE === '1';
const liveTest = runLivePipeTest ? test : test.skip;

interface LiveSessionManifest {
  launch_status: string;
  profile_runs_root: string;
  profile_root: string;
  profile_latest_root: string;
  profile_latest_published: boolean;
  config_dir: string;
  artifact_dir: string;
  pipe_name: string;
  base_uri: string;
  remote_token: string;
  process_id: number;
  remote_process_id: number;
}

async function waitForConnected(client: PipeClient): Promise<void> {
  if (client.isConnected()) {
    return;
  }

  await once(client, 'connected');
}

/**
 * Launches the seeded live session helper in launch-only mode and returns its manifest.
 */
async function startLiveSession(manifestPath: string): Promise<LiveSessionManifest> {
  const remoteRoot = process.cwd();
  const workspaceRoot = path.resolve(remoteRoot, '..', 'eMule-build');
  const testsRoot = path.resolve(remoteRoot, '..', 'eMule-build-tests');
  const helperPath = path.join(workspaceRoot, 'eMule', 'helpers', 'helper-runtime-pipe-live-session.ps1');
  const seedRoot = path.join(testsRoot, 'manifests', 'live-profile-seed');
  execFileSync('pwsh', [
    '-NoLogo',
    '-NoProfile',
    '-File',
    helperPath,
    '-SkipBuild',
    '-LaunchOnly',
    '-KeepRunning',
    '-SeedRoot',
    seedRoot,
    '-SessionManifestPath',
    manifestPath,
  ], {
    cwd: remoteRoot,
    windowsHide: true,
    stdio: 'ignore',
    timeout: 180000,
  });

  const manifestText = await readFile(manifestPath, 'utf8');
  return JSON.parse(manifestText) as LiveSessionManifest;
}

function stopProcessTree(processId: number | undefined): void {
  if (!processId || processId <= 0) {
    return;
  }

  try {
    execFileSync('taskkill', ['/PID', String(processId), '/T', '/F'], {
      stdio: 'ignore',
    });
  } catch {
  }
}

async function fetchJson(
  manifest: LiveSessionManifest,
  relativePath: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${manifest.base_uri}${relativePath}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(30000),
    headers: {
      authorization: `Bearer ${manifest.remote_token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

function createSyntheticEd2kLink(): string {
  return 'ed2k://|file|live-suite-sample.bin|123456|8958fd13501ed0347af4df142e8f5f9e|/';
}

liveTest('launches a seeded live session for direct pipe and HTTP checks', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emule-remote-live-'));
  const manifestPath = path.join(tempRoot, 'session-manifest.json');
  let manifest: LiveSessionManifest | null = null;
  let client: PipeClient | null = null;

  try {
    manifest = await startLiveSession(manifestPath);
    assert.equal(manifest.launch_status, 'launch_only_ready');
    assert.equal(path.dirname(manifest.profile_root), manifest.profile_runs_root);
    assert.equal(manifest.profile_latest_published, true);

    const latestProfileStat = await lstat(manifest.profile_latest_root);
    assert.equal(latestProfileStat.isSymbolicLink(), true);

    for (const requiredPath of [
      path.join(manifest.config_dir, 'preferences.ini'),
      path.join(manifest.config_dir, 'nodes.dat'),
      path.join(manifest.config_dir, 'server.met'),
      path.join(manifest.profile_latest_root, 'config', 'preferences.ini'),
      path.join(manifest.profile_latest_root, 'config', 'nodes.dat'),
      path.join(manifest.profile_latest_root, 'config', 'server.met'),
    ]) {
      const fileText = await readFile(requiredPath);
      assert.ok(fileText.length > 0);
    }

    const health = await fetch(`${manifest.base_uri}/health`, {
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(health.status, 200);

    const appVersion = await fetchJson(manifest, '/api/v2/app/version');
    const globalStats = await fetchJson(manifest, '/api/v2/stats/global');
    assert.equal(appVersion.status, 200);
    assert.equal(globalStats.status, 200);

    const addResponse = await fetchJson(manifest, '/api/v2/transfers/add', {
      method: 'POST',
      body: JSON.stringify({
        links: [createSyntheticEd2kLink()],
      }),
    });
    assert.equal(addResponse.status, 200);
    assert.equal(Array.isArray((addResponse.body as { results?: unknown[] }).results), true);

    const addedResult = ((addResponse.body as { results: Array<{ hash: string | null; ok: boolean }> }).results)[0];
    assert.equal(addedResult.ok, true);
    assert.equal(typeof addedResult.hash, 'string');

    const transfersResponse = await fetchJson(manifest, '/api/v2/transfers');
    assert.equal(transfersResponse.status, 200);

    const deleteResponse = await fetchJson(manifest, '/api/v2/transfers/delete', {
      method: 'POST',
      body: JSON.stringify({
        hashes: [addedResult.hash],
        deleteFiles: true,
      }),
    });
    assert.equal(deleteResponse.status, 200);

    await fetchJson(manifest, '/api/v2/servers/connect', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await fetchJson(manifest, '/api/v2/kad/connect', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const searchStart = await fetchJson(manifest, '/api/v2/search/start', {
      method: 'POST',
      body: JSON.stringify({
        query: '1080p',
        method: 'kad',
      }),
    });
    assert.equal(searchStart.status, 200);
    const searchId = String((searchStart.body as { search_id: string }).search_id);
    assert.ok(searchId.length > 0);

    const searchResults = await fetchJson(manifest, `/api/v2/search/results?search_id=${encodeURIComponent(searchId)}`);
    assert.equal(searchResults.status, 200);

    const searchStop = await fetchJson(manifest, '/api/v2/search/stop', {
      method: 'POST',
      body: JSON.stringify({
        search_id: searchId,
      }),
    });
    assert.equal(searchStop.status, 200);

    stopProcessTree(manifest.remote_process_id);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    client = new PipeClient(manifest.pipe_name, 5000, 1000);
    client.start();
    await waitForConnected(client);

    const version = await client.sendCommand<Record<string, unknown>>('app/version');
    const stats = await client.sendCommand<Record<string, unknown>>('stats/global');
    assert.equal(typeof version, 'object');
    assert.notEqual(version, null);
    assert.equal(typeof stats, 'object');
    assert.notEqual(stats, null);
  } finally {
    client?.stop();
    stopProcessTree(manifest?.remote_process_id);
    stopProcessTree(manifest?.process_id);
    await rm(tempRoot, { recursive: true, force: true });
  }
});
