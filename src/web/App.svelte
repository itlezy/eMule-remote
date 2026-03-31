<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import type { Download, LogEntry, PipeEventEnvelope, Source, SystemStats, SystemVersion } from './lib/types';

  let version: SystemVersion | null = null;
  let stats: SystemStats | null = null;
  let downloads: Download[] = [];
  let logs: LogEntry[] = [];
  let sources: Source[] = [];
  let selectedHash = '';
  let addLinksValue = '';
  let errorMessage = '';
  let infoMessage = '';
  let pipeConnected = false;
  let isInitialLoad = true;
  let isRefreshing = false;

  function formatBytes(value: number): string {
    if (value <= 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let current = value;
    let unitIndex = 0;
    while (current >= 1024 && unitIndex < units.length - 1) {
      current /= 1024;
      unitIndex += 1;
    }
    return `${current.toFixed(current >= 100 ? 0 : current >= 10 ? 1 : 2)} ${units[unitIndex]}`;
  }

  function formatRate(value: number): string {
    return `${formatBytes(value)}/s`;
  }

  async function refreshAll(): Promise<void> {
    isRefreshing = true;
    errorMessage = '';

    try {
      const [health, versionData, statsData, downloadsData, logData] = await Promise.all([
        api.health(),
        api.systemVersion(),
        api.systemStats(),
        api.downloads(),
        api.logs(),
      ]);

      pipeConnected = health.pipeConnected;
      version = versionData;
      stats = statsData;
      downloads = downloadsData;
      logs = logData;

      if (selectedHash && downloads.some((download) => download.hash === selectedHash)) {
        await refreshSources(selectedHash);
      } else {
        selectedHash = '';
        sources = [];
      }
    } catch (error) {
      pipeConnected = false;
      throw error;
    } finally {
      isRefreshing = false;
      isInitialLoad = false;
    }
  }

  async function refreshSources(hash: string): Promise<void> {
    selectedHash = hash;
    sources = await api.sources(hash);
  }

  async function runAction(action: 'pause' | 'resume' | 'stop' | 'remove' | 'recheck', hash: string): Promise<void> {
    errorMessage = '';
    infoMessage = '';

    try {
      if (action === 'pause') await api.pause([hash]);
      if (action === 'resume') await api.resume([hash]);
      if (action === 'stop') await api.stop([hash]);
      if (action === 'remove') await api.remove([hash], true);
      if (action === 'recheck') await api.recheck(hash);
      infoMessage = `${action} queued for ${hash.slice(0, 8)}`;
      await refreshAll();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'request failed';
    }
  }

  async function addLinks(): Promise<void> {
    errorMessage = '';
    infoMessage = '';

    const links = addLinksValue
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (links.length === 0) {
      return;
    }

    try {
      const response = await api.addLinks(links);
      addLinksValue = '';
      const accepted = response.results.filter((result) => result.ok).length;
      infoMessage = `${accepted}/${links.length} link(s) submitted`;
      await refreshAll();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'failed to add links';
    }
  }

  function onEvent(event: PipeEventEnvelope): void {
    pipeConnected = true;
    if (event.event === 'ready') {
      return;
    }

    void refreshAll().catch((error) => {
      errorMessage = error instanceof Error ? error.message : 'refresh failed';
    });
  }

  onMount(() => {
    void refreshAll().catch((error) => {
      errorMessage = error instanceof Error ? error.message : 'initial load failed';
    });

    const source = api.events(onEvent);
    source.onerror = () => {
      pipeConnected = false;
    };

    return () => {
      source.close();
    };
  });
</script>

<svelte:head>
  <title>{version ? `${version.appName} ${version.version}` : 'eMule Remote'}</title>
</svelte:head>

<main class="shell">
  <section class="masthead">
    <div>
      <p class="eyebrow">eMule Remote</p>
      <h1>{version ? `${version.appName} ${version.version}` : 'eMule Remote'}</h1>
      <p class="subhead">A narrow remote surface for the active download queue, live rates, and recent logs.</p>
    </div>
    <div class:offline={!pipeConnected} class="connection-badge">
      <span class="dot"></span>
      <span>{pipeConnected ? 'Pipe Connected' : 'Pipe Disconnected'}</span>
    </div>
  </section>

  {#if !pipeConnected}
    <section class="banner warning">
      The remote is running, but the eMule pipe is currently disconnected. `GET /health` remains available while the desktop app is offline.
    </section>
  {/if}

  <section class="status-grid">
    <article class="stat-card accent">
      <span>Download</span>
      <strong>{stats ? formatRate(stats.downloadSpeed) : '...'}</strong>
      <small>{stats ? formatBytes(stats.sessionDownloaded) : '...'}</small>
    </article>
    <article class="stat-card">
      <span>Upload</span>
      <strong>{stats ? formatRate(stats.uploadSpeed) : '...'}</strong>
      <small>{stats ? formatBytes(stats.sessionUploaded) : '...'}</small>
    </article>
    <article class="stat-card">
      <span>Queue</span>
      <strong>{stats ? stats.downloadCount : '...'}</strong>
      <small>{stats ? `${stats.activeUploads} active uploads` : '...'}</small>
    </article>
    <article class="stat-card">
      <span>Network</span>
      <strong>{stats?.ed2kConnected ? (stats.ed2kHighId ? 'High ID' : 'Low ID') : 'Offline'}</strong>
      <small>{stats?.kadConnected ? (stats.kadFirewalled ? 'Kad firewalled' : 'Kad open') : 'Kad idle'}</small>
    </article>
  </section>

  <section class="workspace">
    <div class="panel panel-downloads">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Downloads</p>
          <h2>Current Queue</h2>
        </div>
        <button class="ghost" disabled={isRefreshing} on:click={() => void refreshAll()}>{isRefreshing ? 'Refreshing...' : 'Refresh'}</button>
      </div>

      <label class="add-box">
        <span>Add ed2k links</span>
        <textarea bind:value={addLinksValue} rows="4" placeholder="ed2k://|file|..."></textarea>
      </label>
      <button class="primary" on:click={addLinks}>Submit Links</button>

      {#if errorMessage}
        <p class="message error">{errorMessage}</p>
      {/if}
      {#if infoMessage}
        <p class="message info">{infoMessage}</p>
      {/if}

      <div class="downloads-table">
        {#if isInitialLoad}
          <p class="empty-state">Loading queue snapshot...</p>
        {:else if downloads.length === 0}
          <p class="empty-state">No downloads are currently in the queue.</p>
        {:else}
          {#each downloads as download}
            <div
              class:selected={selectedHash === download.hash}
              class="download-row"
              on:click={() => void refreshSources(download.hash)}
              on:keydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void refreshSources(download.hash);
                }
              }}
              role="button"
              tabindex="0"
            >
              <div class="download-main">
                <strong>{download.name}</strong>
                <span>{download.state} · {Math.round(download.progress * 100)}%</span>
              </div>
              <div class="download-meta">
                <span>{formatBytes(download.sizeDone)} / {formatBytes(download.size)}</span>
                <span>{formatRate(download.downloadSpeed)}</span>
                <span>{download.sourcesTransferring}/{download.sources} sources</span>
              </div>
              <div class="download-actions">
                <button class="ghost compact" on:click|stopPropagation={() => void runAction('pause', download.hash)}>Pause</button>
                <button class="ghost compact" on:click|stopPropagation={() => void runAction('resume', download.hash)}>Resume</button>
                <button class="ghost compact" on:click|stopPropagation={() => void runAction('stop', download.hash)}>Stop</button>
                <button class="ghost compact" on:click|stopPropagation={() => void runAction('recheck', download.hash)}>Recheck</button>
                <button class="danger compact" on:click|stopPropagation={() => void runAction('remove', download.hash)}>Delete</button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div class="side-column">
      <div class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Sources</p>
            <h2>{selectedHash ? `${selectedHash.slice(0, 8)}...` : 'No Selection'}</h2>
          </div>
        </div>

        {#if selectedHash}
          <div class="sources-list">
            {#each sources as source}
              <div class="source-row">
                <strong>{source.userName || source.ip}</strong>
                <span>{source.clientSoftware} · {source.downloadState}</span>
                <span>{source.ip}:{source.port}</span>
                <span>{formatRate(source.downloadRate)}</span>
              </div>
            {/each}
            {#if sources.length === 0}
              <p class="empty-state">No active sources for this download.</p>
            {/if}
          </div>
        {:else}
          <p class="empty-state">Select a download to inspect its current sources.</p>
        {/if}
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Logs</p>
            <h2>Recent Activity</h2>
          </div>
        </div>

        <div class="log-list">
          {#if logs.length === 0}
            <p class="empty-state">No recent log entries are available.</p>
          {:else}
            {#each logs as entry}
              <div class={`log-row ${entry.level}`}>
                <time>{new Date(entry.timestamp * 1000).toLocaleTimeString()}</time>
                <span>{entry.message}</span>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  </section>
</main>
