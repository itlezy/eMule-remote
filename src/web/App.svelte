  <script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import type { AppVersion, GlobalStats, KadStatus, LogEntry, MutationResponse, Preferences, SearchResultsResponse, Server, ServerStatus, SharedFile, Source, Transfer, UploadEntry } from './lib/types';

  type Section = 'transfers' | 'uploads' | 'servers' | 'kad' | 'shared' | 'search' | 'preferences' | 'logs';
  type QueueFilter = 'all' | 'active' | 'transferring' | 'stopped' | 'completed';
  type LogFilter = 'all' | 'info' | 'warning' | 'error' | 'debug';
  type QueueAction = 'pause' | 'resume' | 'stop' | 'remove' | 'recheck';

  interface PreferenceField {
    key: keyof Preferences;
    label: string;
    kind: 'number' | 'boolean';
  }

  const sections = ['transfers', 'uploads', 'servers', 'kad', 'shared', 'search', 'preferences', 'logs'] as const satisfies Section[];
  const queueFilters = ['all', 'active', 'transferring', 'stopped', 'completed'] as const satisfies QueueFilter[];
  const logFilters = ['all', 'info', 'warning', 'error', 'debug'] as const satisfies LogFilter[];
  const transferPriorities = ['auto', 'very_low', 'low', 'normal', 'high', 'very_high'];
  const preferenceFields: PreferenceField[] = [
    { key: 'maxUploadKiB', label: 'Max upload KiB', kind: 'number' },
    { key: 'maxDownloadKiB', label: 'Max download KiB', kind: 'number' },
    { key: 'maxConnections', label: 'Max connections', kind: 'number' },
    { key: 'maxConPerFive', label: 'Max con / 5 sec', kind: 'number' },
    { key: 'maxSourcesPerFile', label: 'Max sources / file', kind: 'number' },
    { key: 'uploadClientDataRate', label: 'Client data rate', kind: 'number' },
    { key: 'maxUploadSlots', label: 'Max upload slots', kind: 'number' },
    { key: 'queueSize', label: 'Queue size', kind: 'number' },
    { key: 'autoConnect', label: 'Auto connect', kind: 'boolean' },
    { key: 'newAutoUp', label: 'Auto upload priority', kind: 'boolean' },
    { key: 'newAutoDown', label: 'Auto download priority', kind: 'boolean' },
    { key: 'creditSystem', label: 'Credit system', kind: 'boolean' },
    { key: 'safeServerConnect', label: 'Safe server connect', kind: 'boolean' },
    { key: 'networkKademlia', label: 'Kad enabled', kind: 'boolean' },
    { key: 'networkEd2k', label: 'ed2k enabled', kind: 'boolean' },
  ];

  let activeSection: Section = 'transfers';
  let version: AppVersion | null = null;
  let stats: GlobalStats | null = null;
  let transfers: Transfer[] = [];
  let uploadsActive: UploadEntry[] = [];
  let uploadsQueue: UploadEntry[] = [];
  let servers: Server[] = [];
  let serverStatus: ServerStatus | null = null;
  let kadStatusValue: KadStatus | null = null;
  let sharedFiles: SharedFile[] = [];
  let logs: LogEntry[] = [];
  let sources: Source[] = [];
  let preferencesDraft: Preferences | null = null;
  let selectedTransfer: Transfer | null = null;
  let selectedTransferHash = '';
  let selectedShared: SharedFile | null = null;
  let selectedHashes: string[] = [];
  let selectedSharedHash = '';
  let emuleReachable = false;
  let isRefreshing = false;
  let isInitialLoad = true;
  let isSelectionRefreshing = false;
  let errorMessage = '';
  let infoMessage = '';
  let detailError = '';

  let queueFilter: QueueFilter = 'all';
  let queueSearch = '';
  let sortDirection: 'asc' | 'desc' = 'desc';
  let deleteFiles = true;
  let showOnlySelected = false;
  let addLinksValue = '';
  let transferPriorityDraft = 'normal';
  let transferCategoryDraft = '0';
  let sharedAddPath = '';
  let serverAddress = '';
  let serverPort = 4661;
  let serverName = '';
  let searchQuery = '';
  let searchMethod: 'global' | 'kad' | 'server' = 'global';
  let searchType: 'any' | 'audio' | 'video' | 'image' | 'program' | 'document' | 'archive' | 'cdimage' = 'any';
  let searchExt = '';
  let searchMinSize = '';
  let searchMaxSize = '';
  let searchId = '';
  let searchStatus: SearchResultsResponse['status'] | 'idle' = 'idle';
  let searchResults: SearchResultsResponse['results'] = [];
  let logLimit = 120;
  let logFilter: LogFilter = 'all';

  const fmtBytes = (value: number) => value <= 0 ? '0 B' : `${(value >= 1024 * 1024 ? value / (1024 * 1024) : value >= 1024 ? value / 1024 : value).toFixed(value >= 1024 * 1024 ? 1 : value >= 1024 ? 1 : 0)} ${value >= 1024 * 1024 ? 'MiB' : value >= 1024 ? 'KiB' : 'B'}`;
  const fmtRate = (value: number) => `${fmtBytes(value)}/s`;
  const fmtPercent = (value: number) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  const fmtStamp = (value: number | null) => value ? new Date(value * 1000).toLocaleString() : 'n/a';
  const fmtTime = (value: number) => new Date(value * 1000).toLocaleTimeString();
  const fmtEta = (value: number | null) => value === null || value < 0 ? 'n/a' : `${Math.max(0, Math.round(value))} s`;
  const shortHash = (hash: string) => `${hash.slice(0, 8)}...${hash.slice(-6)}`;
  const tabClass = (section: Section) => activeSection === section ? 'btn btn-primary section-tab is-active' : 'btn section-tab';
  const networkBadge = (connected: boolean) => connected ? 'badge badge-success' : 'badge badge-danger';
  const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

  function setInfo(message: string): void {
    infoMessage = message;
    errorMessage = '';
  }

  function setError(message: string): void {
    errorMessage = message;
    infoMessage = '';
  }

  function clearMessages(): void {
    errorMessage = '';
    infoMessage = '';
  }

  function isCompleted(transfer: Transfer): boolean {
    return transfer.progress >= 1 || transfer.completedAt !== null;
  }

  function isActive(transfer: Transfer): boolean {
    return !transfer.stopped && !isCompleted(transfer);
  }

  function isTransferring(transfer: Transfer): boolean {
    return transfer.downloadSpeed > 0 || transfer.uploadSpeed > 0 || transfer.sourcesTransferring > 0;
  }

  async function refreshOverview(): Promise<boolean> {
    const health = await api.health();
    emuleReachable = health.emuleReachable;
    if (!health.emuleReachable)
      return false;
    const [nextVersion, nextStats] = await Promise.all([api.appVersion(), api.statsGlobal()]);
    version = nextVersion;
    stats = nextStats;
    return true;
  }

  async function refreshTransferSelection(hash: string): Promise<void> {
    selectedTransferHash = hash;
    detailError = '';
    isSelectionRefreshing = true;
    try {
      const [detail, nextSources] = await Promise.all([api.transferGet(hash), api.transferSources(hash)]);
      selectedTransfer = detail;
      sources = nextSources;
      transferPriorityDraft = detail.priority;
      transferCategoryDraft = String(detail.category);
    } catch (error) {
      detailError = error instanceof Error ? error.message : 'failed to load transfer details';
    } finally {
      isSelectionRefreshing = false;
    }
  }

  async function refreshTransfers(): Promise<void> {
    transfers = await api.transfersList();
    const remaining = new Set(transfers.map((transfer) => transfer.hash));
    selectedHashes = selectedHashes.filter((hash) => remaining.has(hash));
    if (selectedTransferHash && remaining.has(selectedTransferHash)) {
      await refreshTransferSelection(selectedTransferHash);
      return;
    }
    selectedTransferHash = '';
    selectedTransfer = null;
    sources = [];
  }

  const refreshUploads = async () => ([uploadsActive, uploadsQueue] = await Promise.all([api.uploadsList(), api.uploadsQueue()]));
  const refreshServers = async () => ([servers, serverStatus] = await Promise.all([api.serversList(), api.serversStatus()]));
  const refreshKad = async () => (kadStatusValue = await api.kadStatus());
  const refreshShared = async () => {
    sharedFiles = await api.sharedList();
    if (selectedSharedHash && sharedFiles.some((file) => file.hash === selectedSharedHash))
      selectedShared = await api.sharedGet(selectedSharedHash);
    else
      selectedShared = null;
  };
  const refreshLogs = async () => (logs = await api.logGet(logLimit));
  const refreshPreferences = async () => (preferencesDraft = await api.appPreferencesGet());
  const refreshSearch = async () => {
    if (!searchId) {
      searchStatus = 'idle';
      searchResults = [];
      return;
    }
    const snapshot = await api.searchResults(searchId);
    searchStatus = snapshot.status;
    searchResults = snapshot.results;
  };

  async function refreshAll(): Promise<void> {
    isRefreshing = true;
    try {
      const connected = await refreshOverview();
      if (connected)
        await Promise.all([refreshTransfers(), refreshUploads(), refreshServers(), refreshKad(), refreshShared(), refreshLogs(), refreshPreferences(), refreshSearch()]);
      clearMessages();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'refresh failed');
    } finally {
      isRefreshing = false;
      isInitialLoad = false;
    }
  }

  function summarizeMutation(action: QueueAction, response: MutationResponse, requested: number): void {
    const okCount = response.results.filter((result) => result.ok).length;
    const failed = response.results.filter((result) => !result.ok);
    infoMessage = `${okCount}/${requested} ${action} request(s) accepted`;
    errorMessage = failed.length ? failed.map((result) => result.error ?? `${result.hash ?? 'item'} failed`).join(' | ') : '';
  }

  async function runAction(action: QueueAction, hashes: string[]): Promise<void> {
    if (hashes.length === 0)
      return;
    clearMessages();
    try {
      if (action === 'pause') summarizeMutation(action, await api.transfersPause(hashes), hashes.length);
      if (action === 'resume') summarizeMutation(action, await api.transfersResume(hashes), hashes.length);
      if (action === 'stop') summarizeMutation(action, await api.transfersStop(hashes), hashes.length);
      if (action === 'remove') summarizeMutation(action, await api.transfersDelete(hashes, deleteFiles), hashes.length);
      if (action === 'recheck') await Promise.all(hashes.map((hash) => api.transferRecheck(hash)));
      await refreshTransfers();
      await refreshOverview();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'request failed');
    }
  }

  async function addLinks(): Promise<void> {
    const links = addLinksValue.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (links.length === 0)
      return;
    clearMessages();
    try {
      const response = {
        results: await Promise.all(links.map(async (link) => {
          try {
            const result = await api.transferAdd(link);
            return { hash: result.hash, ok: true, name: result.name };
          } catch (error) {
            return {
              hash: null,
              ok: false,
              error: error instanceof Error ? error.message : 'failed to add link',
            };
          }
        })),
      };
      addLinksValue = '';
      summarizeMutation('resume', response, links.length);
      await refreshTransfers();
      await refreshOverview();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to add links');
    }
  }

  async function applyTransferMetadata(): Promise<void> {
    if (!selectedTransfer)
      return;
    try {
      await api.transferSetPriority(selectedTransfer.hash, transferPriorityDraft);
      await api.transferSetCategory(selectedTransfer.hash, Number.parseInt(transferCategoryDraft, 10) || 0);
      await refreshTransfers();
      setInfo(`Updated ${selectedTransfer.name}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to update transfer');
    }
  }

  async function connectServer(server?: { addr: string; port: number }): Promise<void> {
    try {
      serverStatus = await api.serversConnect(server);
      await refreshServers();
      setInfo(server ? `Connecting to ${server.addr}:${server.port}` : 'Connecting to server');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to connect server');
    }
  }

  async function addServer(): Promise<void> {
    try {
      await api.serversAdd({ addr: serverAddress, port: serverPort, name: serverName || undefined });
      serverAddress = '';
      serverPort = 4661;
      serverName = '';
      await refreshServers();
      setInfo('Server added');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to add server');
    }
  }

  async function removeServer(server: Server): Promise<void> {
    try {
      await api.serversRemove({ addr: server.address, port: server.port });
      await refreshServers();
      setInfo(`Removed ${server.address}:${server.port}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to remove server');
    }
  }

  async function runKadAction(action: 'connect' | 'disconnect' | 'recheck'): Promise<void> {
    try {
      if (action === 'connect') kadStatusValue = await api.kadConnect();
      if (action === 'disconnect') kadStatusValue = await api.kadDisconnect();
      if (action === 'recheck') kadStatusValue = await api.kadRecheckFirewall();
      setInfo(`Kad ${action} request accepted`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to update Kad');
    }
  }

  async function inspectShared(hash: string): Promise<void> {
    selectedSharedHash = hash;
    try {
      selectedShared = await api.sharedGet(hash);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to load shared file');
    }
  }

  async function addSharedPath(): Promise<void> {
    if (!sharedAddPath.trim())
      return;
    try {
      const result = await api.sharedAdd(sharedAddPath.trim());
      sharedAddPath = '';
      await refreshShared();
      setInfo(result.alreadyShared ? `Already shared: ${result.path}` : `Queued share add for ${result.path}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to add shared file');
    }
  }

  async function removeSharedByHash(hash: string): Promise<void> {
    try {
      const result = await api.sharedRemoveByHash(hash);
      await refreshShared();
      setInfo(`Removed ${result.path}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to remove shared file');
    }
  }

  async function runUploadAction(entry: UploadEntry, action: 'remove' | 'release'): Promise<void> {
    const selector = entry.userHash ? { userHash: entry.userHash } : { ip: entry.ip, port: entry.port };
    try {
      if (action === 'remove') await api.uploadsRemove(selector);
      if (action === 'release') await api.uploadsReleaseSlot(selector);
      await refreshUploads();
      setInfo(action === 'remove' ? 'Upload client removed' : 'Upload slot released');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to update upload client');
    }
  }

  async function savePreferences(): Promise<void> {
    if (!preferencesDraft)
      return;
    isSavingPreferences = true;
    try {
      await api.appPreferencesSet(preferencesDraft);
      await refreshPreferences();
      setInfo('Preferences saved');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to save preferences');
    } finally {
      isSavingPreferences = false;
    }
  }

  async function startSearch(): Promise<void> {
    if (!searchQuery.trim())
      return;
    isLaunchingSearch = true;
    try {
      const session = await api.searchStart({
        query: searchQuery.trim(),
        method: searchMethod,
        type: searchType === 'any' ? undefined : searchType,
        ext: searchExt.trim() || undefined,
        min_size: searchMinSize.trim() ? Number.parseInt(searchMinSize, 10) : undefined,
        max_size: searchMaxSize.trim() ? Number.parseInt(searchMaxSize, 10) : undefined,
      });
      searchId = session.search_id;
      await refreshSearch();
      setInfo(`Search started: ${searchId}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to start search');
    } finally {
      isLaunchingSearch = false;
    }
  }

  async function stopSearch(): Promise<void> {
    if (!searchId)
      return;
    isStoppingSearch = true;
    try {
      await api.searchStop(searchId);
      searchId = '';
      searchStatus = 'idle';
      searchResults = [];
      setInfo('Search stopped');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to stop search');
    } finally {
      isStoppingSearch = false;
    }
  }

  async function shutdownApp(): Promise<void> {
    try {
      await api.appShutdown();
      setInfo('Shutdown requested');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'failed to request shutdown');
    }
  }

  async function refreshActiveSection(): Promise<void> {
    const connected = await refreshOverview();
    if (!connected)
      return;

    if (activeSection === 'transfers')
      await refreshTransfers();
    if (activeSection === 'uploads')
      await refreshUploads();
    if (activeSection === 'servers')
      await refreshServers();
    if (activeSection === 'kad')
      await refreshKad();
    if (activeSection === 'shared')
      await refreshShared();
    if (activeSection === 'preferences')
      await refreshPreferences();
    if (activeSection === 'logs')
      await refreshLogs();
    if (activeSection === 'search' || searchId)
      await refreshSearch();
  }

  $: visibleTransfers = transfers
    .filter((transfer) => queueFilter === 'all' || (queueFilter === 'active' && isActive(transfer)) || (queueFilter === 'transferring' && isTransferring(transfer)) || (queueFilter === 'stopped' && transfer.stopped) || (queueFilter === 'completed' && isCompleted(transfer)))
    .filter((transfer) => !queueSearch.trim() || [transfer.name, transfer.hash, transfer.state, transfer.priority].some((value) => value.toLowerCase().includes(queueSearch.trim().toLowerCase())))
    .filter((transfer) => !showOnlySelected || selectedHashes.includes(transfer.hash))
    .sort((left, right) => (sortDirection === 'asc' ? 1 : -1) * left.name.localeCompare(right.name));

  $: filteredLogs = logs.filter((entry) => logFilter === 'all' || (logFilter === 'debug' ? entry.debug || entry.level === 'debug' : entry.level === logFilter));

  onMount(() => {
    let disposed = false;
    let pollHandle: ReturnType<typeof setTimeout> | undefined;

    const scheduleNextPoll = () => {
      if (disposed)
        return;
      const delayMs = searchId ? 2000 : 5000;
      pollHandle = setTimeout(async () => {
        try {
          await refreshActiveSection();
        } catch {
          emuleReachable = false;
        } finally {
          scheduleNextPoll();
        }
      }, delayMs);
    };

    void refreshAll().finally(() => {
      scheduleNextPoll();
    });

    return () => {
      disposed = true;
      if (pollHandle !== undefined)
        clearTimeout(pollHandle);
    };
  });
</script>

<svelte:head>
  <title>{version ? `${version.appName} ${version.version}` : 'eMule Remote'}</title>
</svelte:head>

<main class="app-shell">
  <div class="mx-auto max-w-[1800px] px-4 py-6 md:px-6">
    <header class="page-header mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div class="space-y-2">
        <p class="panel-kicker">eMule Remote</p>
        <div class="flex flex-col gap-3 md:flex-row md:items-center">
          <h1 class="text-3xl font-semibold tracking-tight text-slate-950">{version ? `${version.appName} ${version.version}` : 'Remote Control'}</h1>
          <span class={networkBadge(emuleReachable)}>{emuleReachable ? 'eMule reachable' : 'eMule unreachable'}</span>
        </div>
        <p class="max-w-3xl text-sm text-slate-600">Grouped operator console for the exact eMule REST surface. Same routes, same payloads, same behavior.</p>
      </div>
      <div class="header-actions flex flex-wrap items-center gap-2">
        {#if version}
          <span class="badge badge-muted">{version.platform}</span>
          <span class="badge badge-muted">{version.build}</span>
        {/if}
        <button class="btn" disabled={isRefreshing} type="button" on:click={() => void refreshAll()}>{isRefreshing ? 'Refreshing...' : 'Refresh all'}</button>
        <button class="btn btn-danger" type="button" on:click={() => void shutdownApp()}>Shutdown app</button>
      </div>
    </header>

    <section class="metric-grid mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article class="stat-card"><p class="panel-kicker">Download</p><strong class="mt-2 text-2xl text-slate-950">{stats ? fmtRate(stats.downloadSpeed) : '...'}</strong><p class="mt-1 text-sm text-slate-500">{stats ? fmtBytes(stats.sessionDownloaded) : '...'}</p></article>
      <article class="stat-card"><p class="panel-kicker">Upload</p><strong class="mt-2 text-2xl text-slate-950">{stats ? fmtRate(stats.uploadSpeed) : '...'}</strong><p class="mt-1 text-sm text-slate-500">{stats ? fmtBytes(stats.sessionUploaded) : '...'}</p></article>
      <article class="stat-card"><p class="panel-kicker">Transfers</p><strong class="mt-2 text-2xl text-slate-950">{stats ? stats.downloadCount : '...'}</strong><p class="mt-1 text-sm text-slate-500">{stats ? `${stats.activeUploads} active / ${stats.waitingUploads} waiting uploads` : '...'}</p></article>
      <article class="stat-card"><p class="panel-kicker">Network</p><div class="mt-2 flex flex-wrap gap-2"><span class={networkBadge(Boolean(stats?.ed2kConnected))}>{stats?.ed2kConnected ? (stats.ed2kHighId ? 'ed2k high id' : 'ed2k low id') : 'ed2k offline'}</span><span class={networkBadge(Boolean(stats?.kadConnected))}>{stats?.kadConnected ? (stats.kadFirewalled ? 'Kad firewalled' : 'Kad open') : 'Kad idle'}</span></div></article>
    </section>

    {#if errorMessage}<div class="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">{errorMessage}</div>{/if}
    {#if infoMessage}<div class="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-sm">{infoMessage}</div>{/if}

    <section class="panel mb-6">
      <div class="panel-body">
        <div class="section-tabs flex flex-wrap gap-2">
          {#each sections as section}
            <button class={tabClass(section)} type="button" on:click={() => activeSection = section}>{titleCase(section)}</button>
          {/each}
        </div>
      </div>
    </section>

    {#if activeSection === 'transfers'}
      <div class="section-layout split-layout grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)]">
        <section class="panel">
          <div class="panel-body space-y-4">
            <div class="toolbar responsive-toolbar">
              <label class="field md:col-span-2"><span class="panel-kicker">Filter</span><input bind:value={queueSearch} class="input-base" placeholder="name, hash, state" type="text" /></label>
              <label class="field"><span class="panel-kicker">Queue</span><select bind:value={queueFilter} class="input-base">{#each queueFilters as filter}<option value={filter}>{filter}</option>{/each}</select></label>
              <label class="field"><span class="panel-kicker">Direction</span><select bind:value={sortDirection} class="input-base"><option value="desc">desc</option><option value="asc">asc</option></select></label>
            </div>
            <div class="action-cluster flex flex-wrap gap-2">
              <button class="btn" type="button" on:click={() => selectedHashes = Array.from(new Set([...selectedHashes, ...visibleTransfers.map((transfer) => transfer.hash)]))}>Select visible</button>
              <button class="btn" type="button" on:click={() => selectedHashes = []}>Clear</button>
              <button class="btn" disabled={selectedHashes.length === 0} type="button" on:click={() => void runAction('pause', selectedHashes)}>Pause</button>
              <button class="btn" disabled={selectedHashes.length === 0} type="button" on:click={() => void runAction('resume', selectedHashes)}>Resume</button>
              <button class="btn" disabled={selectedHashes.length === 0} type="button" on:click={() => void runAction('stop', selectedHashes)}>Stop</button>
              <button class="btn btn-danger" disabled={selectedHashes.length === 0} type="button" on:click={() => void runAction('remove', selectedHashes)}>Remove</button>
              <label class="ml-auto flex items-center gap-2 text-sm text-slate-600"><input bind:checked={showOnlySelected} class="rounded border-slate-300" type="checkbox" />show selected only</label>
              <label class="flex items-center gap-2 text-sm text-slate-600"><input bind:checked={deleteFiles} class="rounded border-slate-300" type="checkbox" />delete files</label>
            </div>
            <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <label class="field"><span class="panel-kicker">Add ed2k links</span><textarea bind:value={addLinksValue} class="textarea-base min-h-24" placeholder="ed2k://|file|..." rows="4"></textarea></label>
              <button class="btn btn-primary self-end" type="button" on:click={() => void addLinks()}>Submit links</button>
            </div>
            <div class="table-wrap">
              <div class="overflow-x-auto">
                <table class="w-full min-w-[980px] text-sm">
                  <thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3">Sel</th><th class="px-4 py-3">Name</th><th class="px-4 py-3">State</th><th class="px-4 py-3">Progress</th><th class="px-4 py-3">Rate</th><th class="px-4 py-3">Sources</th><th class="px-4 py-3">ETA</th></tr></thead>
                  <tbody>
                    {#if isInitialLoad}
                      <tr><td class="px-4 py-6 text-center text-slate-500" colspan="7">Loading queue snapshot...</td></tr>
                    {:else if visibleTransfers.length === 0}
                      <tr><td class="px-4 py-6 text-center text-slate-500" colspan="7">No transfers match the current filters.</td></tr>
                    {:else}
                      {#each visibleTransfers as transfer}
                        <tr class={selectedTransferHash === transfer.hash ? 'border-t border-slate-100 bg-accent-50/50' : 'border-t border-slate-100'}>
                          <td class="px-4 py-3"><input checked={selectedHashes.includes(transfer.hash)} class="rounded border-slate-300" on:change={(event) => (event.currentTarget as HTMLInputElement).checked ? selectedHashes = [...selectedHashes, transfer.hash] : selectedHashes = selectedHashes.filter((hash) => hash !== transfer.hash)} type="checkbox" /></td>
                          <td class="px-4 py-3"><button class="text-left font-semibold text-slate-900 hover:text-accent-700" type="button" on:click={() => void refreshTransferSelection(transfer.hash)}>{transfer.name}</button><div class="text-xs text-slate-500">{shortHash(transfer.hash)} / {transfer.priority}</div></td>
                          <td class="px-4 py-3"><span class={isCompleted(transfer) ? 'badge badge-success' : transfer.stopped ? 'badge badge-danger' : isTransferring(transfer) ? 'badge badge-info' : 'badge badge-warn'}>{transfer.state}</span></td>
                          <td class="px-4 py-3">{fmtPercent(transfer.progress)}</td>
                          <td class="px-4 py-3">{fmtRate(transfer.downloadSpeed)}</td>
                          <td class="px-4 py-3">{transfer.sourcesTransferring}/{transfer.sources}</td>
                          <td class="px-4 py-3">{fmtEta(transfer.eta)}</td>
                        </tr>
                      {/each}
                    {/if}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
        <aside class="panel">
          <div class="panel-body space-y-4">
            <div class="flex items-start justify-between gap-3"><div><p class="panel-kicker">Inspector</p><h2 class="panel-title">{selectedTransfer ? selectedTransfer.name : 'No transfer selected'}</h2></div>{#if selectedTransferHash}<button class="btn" disabled={isSelectionRefreshing} type="button" on:click={() => void refreshTransferSelection(selectedTransferHash)}>{isSelectionRefreshing ? 'Refreshing...' : 'Refresh'}</button>{/if}</div>
            {#if detailError}<div class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{detailError}</div>{/if}
            {#if selectedTransfer}
              <div class="rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><p>{fmtBytes(selectedTransfer.sizeDone)} of {fmtBytes(selectedTransfer.size)}</p><p>{fmtStamp(selectedTransfer.addedAt)} added</p><p>{selectedTransfer.partsAvailable}/{selectedTransfer.partsTotal} parts</p></div>
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="field"><span class="panel-kicker">Priority</span><select bind:value={transferPriorityDraft} class="input-base">{#each transferPriorities as priority}<option value={priority}>{priority}</option>{/each}</select></label>
                <label class="field"><span class="panel-kicker">Category</span><input bind:value={transferCategoryDraft} class="input-base" min="0" type="number" /></label>
              </div>
              <div class="flex flex-wrap gap-2"><button class="btn" type="button" on:click={() => void applyTransferMetadata()}>Apply metadata</button><button class="btn" type="button" on:click={() => void runAction('pause', [selectedTransfer.hash])}>Pause</button><button class="btn" type="button" on:click={() => void runAction('resume', [selectedTransfer.hash])}>Resume</button><button class="btn btn-danger" type="button" on:click={() => void runAction('remove', [selectedTransfer.hash])}>Remove</button></div>
              <div class="table-wrap"><div class="overflow-x-auto"><table class="w-full min-w-[560px] text-sm"><thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3">User</th><th class="px-4 py-3">Client</th><th class="px-4 py-3">Rate</th></tr></thead><tbody>{#if sources.length === 0}<tr><td class="px-4 py-6 text-center text-slate-500" colspan="3">No active sources reported for this transfer.</td></tr>{:else}{#each sources as source}<tr class="border-t border-slate-100"><td class="px-4 py-3">{source.userName || source.ip}</td><td class="px-4 py-3">{source.clientSoftware}</td><td class="px-4 py-3">{fmtRate(source.downloadRate)}</td></tr>{/each}{/if}</tbody></table></div></div>
            {:else}
              <div class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">Pick a transfer from the queue to inspect sources and metadata.</div>
            {/if}
          </div>
        </aside>
      </div>
    {/if}

    {#if activeSection === 'uploads'}
      <div class="section-layout dual-layout grid gap-6 xl:grid-cols-2">
        <section class="panel"><div class="panel-body space-y-4"><div class="flex items-end justify-between gap-3"><div><p class="panel-kicker">Uploads</p><h2 class="panel-title">Active slots</h2></div><span class="badge badge-info">{uploadsActive.length} active</span></div><div class="table-wrap"><div class="overflow-x-auto"><table class="w-full min-w-[820px] text-sm"><thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3">Client</th><th class="px-4 py-3">State</th><th class="px-4 py-3">File</th><th class="px-4 py-3">Rate</th><th class="px-4 py-3">Actions</th></tr></thead><tbody>{#if uploadsActive.length === 0}<tr><td class="px-4 py-6 text-center text-slate-500" colspan="5">No active upload slots.</td></tr>{:else}{#each uploadsActive as entry}<tr class="border-t border-slate-100"><td class="px-4 py-3">{entry.userName || entry.ip}</td><td class="px-4 py-3">{entry.uploadState}</td><td class="px-4 py-3">{entry.requestedFileName ?? 'n/a'}</td><td class="px-4 py-3">{fmtRate(entry.uploadSpeed)}</td><td class="px-4 py-3"><div class="flex flex-wrap gap-2"><button class="btn-xs" type="button" on:click={() => void runUploadAction(entry, 'release')}>Release slot</button><button class="btn-xs border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" type="button" on:click={() => void runUploadAction(entry, 'remove')}>Remove client</button></div></td></tr>{/each}{/if}</tbody></table></div></div></div></section>
        <section class="panel"><div class="panel-body space-y-4"><div class="flex items-end justify-between gap-3"><div><p class="panel-kicker">Uploads</p><h2 class="panel-title">Waiting queue</h2></div><span class="badge badge-warn">{uploadsQueue.length} waiting</span></div><div class="table-wrap"><div class="overflow-x-auto"><table class="w-full min-w-[820px] text-sm"><thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3">Client</th><th class="px-4 py-3">Wait</th><th class="px-4 py-3">Score</th><th class="px-4 py-3">Requested file</th><th class="px-4 py-3">Actions</th></tr></thead><tbody>{#if uploadsQueue.length === 0}<tr><td class="px-4 py-6 text-center text-slate-500" colspan="5">No waiting upload clients.</td></tr>{:else}{#each uploadsQueue as entry}<tr class="border-t border-slate-100"><td class="px-4 py-3">{entry.userName || entry.ip}</td><td class="px-4 py-3">{Math.round(entry.waitTimeMs / 1000)} s</td><td class="px-4 py-3">{entry.score}</td><td class="px-4 py-3">{entry.requestedFileName ?? 'n/a'}</td><td class="px-4 py-3"><button class="btn-xs border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" type="button" on:click={() => void runUploadAction(entry, 'remove')}>Remove client</button></td></tr>{/each}{/if}</tbody></table></div></div></div></section>
      </div>
    {/if}

    {#if activeSection === 'servers'}
      <div class="section-layout split-layout grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(340px,1fr)]">
        <section class="panel"><div class="panel-body space-y-4"><div class="adaptive-form grid gap-3 md:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)_auto]"><label class="field"><span class="panel-kicker">Address</span><input bind:value={serverAddress} class="input-base" placeholder="host or ip" type="text" /></label><label class="field"><span class="panel-kicker">Port</span><input bind:value={serverPort} class="input-base" min="1" type="number" /></label><label class="field"><span class="panel-kicker">Name</span><input bind:value={serverName} class="input-base" placeholder="optional" type="text" /></label><button class="btn btn-primary self-end" type="button" on:click={() => void addServer()}>Add</button></div><div class="table-wrap"><div class="overflow-x-auto"><table class="w-full min-w-[920px] text-sm"><thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3">Server</th><th class="px-4 py-3">Users</th><th class="px-4 py-3">Files</th><th class="px-4 py-3">Priority</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Actions</th></tr></thead><tbody>{#if servers.length === 0}<tr><td class="px-4 py-6 text-center text-slate-500" colspan="6">No servers listed.</td></tr>{:else}{#each servers as server}<tr class="border-t border-slate-100"><td class="px-4 py-3">{server.name || `${server.address}:${server.port}`}</td><td class="px-4 py-3">{server.users}</td><td class="px-4 py-3">{server.files}</td><td class="px-4 py-3">{server.priority}</td><td class="px-4 py-3">{server.connected ? 'connected' : server.connecting ? 'connecting' : 'idle'}</td><td class="px-4 py-3"><div class="action-cluster flex flex-wrap gap-2"><button class="btn-xs" type="button" on:click={() => void connectServer({ addr: server.address, port: server.port })}>Connect</button><button class="btn-xs border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" type="button" on:click={() => void removeServer(server)}>Remove</button></div></td></tr>{/each}{/if}</tbody></table></div></div></div></section>
        <aside class="panel"><div class="panel-body space-y-4"><div><p class="panel-kicker">Status</p><h2 class="panel-title">Connection</h2></div><div class="rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><p>{serverStatus?.connected ? 'Connected' : serverStatus?.connecting ? 'Connecting' : 'Offline'}</p><p>Known servers: {serverStatus?.serverCount ?? 0}</p><p>Current: {serverStatus?.currentServer ? `${serverStatus.currentServer.address}:${serverStatus.currentServer.port}` : 'n/a'}</p></div><div class="flex flex-wrap gap-2"><button class="btn btn-primary" type="button" on:click={() => void connectServer()}>Connect best</button><button class="btn btn-danger" type="button" on:click={() => void api.serversDisconnect().then(() => refreshServers())}>Disconnect</button></div></div></aside>
      </div>
    {/if}

    {#if activeSection === 'kad'}
      <section class="panel"><div class="panel-body space-y-4"><div class="flex items-end justify-between gap-3"><div><p class="panel-kicker">Kad</p><h2 class="panel-title">Distributed network</h2></div><div class="flex flex-wrap gap-2"><button class="btn btn-primary" type="button" on:click={() => void runKadAction('connect')}>Connect</button><button class="btn" type="button" on:click={() => void runKadAction('recheck')}>Recheck firewall</button><button class="btn btn-danger" type="button" on:click={() => void runKadAction('disconnect')}>Disconnect</button></div></div><div class="grid gap-4 md:grid-cols-2 xl:grid-cols-5"><article class="stat-card"><p class="panel-kicker">Running</p><strong class="mt-2 text-2xl text-slate-950">{kadStatusValue?.running ? 'Yes' : 'No'}</strong></article><article class="stat-card"><p class="panel-kicker">Connected</p><strong class="mt-2 text-2xl text-slate-950">{kadStatusValue?.connected ? 'Yes' : 'No'}</strong></article><article class="stat-card"><p class="panel-kicker">Firewall</p><strong class="mt-2 text-2xl text-slate-950">{kadStatusValue?.firewalled === null ? 'n/a' : kadStatusValue.firewalled ? 'Firewalled' : 'Open'}</strong></article><article class="stat-card"><p class="panel-kicker">Users</p><strong class="mt-2 text-2xl text-slate-950">{kadStatusValue?.users ?? 'n/a'}</strong></article><article class="stat-card"><p class="panel-kicker">Files</p><strong class="mt-2 text-2xl text-slate-950">{kadStatusValue?.files ?? 'n/a'}</strong></article></div></div></section>
    {/if}

    {#if activeSection === 'shared'}
      <div class="section-layout split-layout grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(340px,1fr)]">
        <section class="panel"><div class="panel-body space-y-4"><div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]"><label class="field"><span class="panel-kicker">Add explicit file share</span><input bind:value={sharedAddPath} class="input-base" placeholder="C:\\path\\to\\file.ext" type="text" /></label><button class="btn btn-primary self-end" type="button" on:click={() => void addSharedPath()}>Add share</button></div><div class="table-wrap"><div class="overflow-x-auto"><table class="w-full min-w-[920px] text-sm"><thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3">Name</th><th class="px-4 py-3">Path</th><th class="px-4 py-3">Priority</th><th class="px-4 py-3">Requests</th><th class="px-4 py-3">Actions</th></tr></thead><tbody>{#if sharedFiles.length === 0}<tr><td class="px-4 py-6 text-center text-slate-500" colspan="5">No shared files reported.</td></tr>{:else}{#each sharedFiles as file}<tr class={selectedSharedHash === file.hash ? 'border-t border-slate-100 bg-accent-50/50' : 'border-t border-slate-100'}><td class="px-4 py-3">{file.name}</td><td class="px-4 py-3">{file.path}</td><td class="px-4 py-3">{file.uploadPriority}</td><td class="px-4 py-3">{file.requests}/{file.accepts}</td><td class="px-4 py-3"><div class="flex flex-wrap gap-2"><button class="btn-xs" type="button" on:click={() => void inspectShared(file.hash)}>Inspect</button><button class="btn-xs border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" type="button" on:click={() => void removeSharedByHash(file.hash)}>Remove</button></div></td></tr>{/each}{/if}</tbody></table></div></div></div></section>
        <aside class="panel"><div class="panel-body space-y-4"><div><p class="panel-kicker">Inspector</p><h2 class="panel-title">{selectedShared ? selectedShared.name : 'No shared file selected'}</h2></div>{#if selectedShared}<div class="rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><p>{selectedShared.path}</p><p>{fmtBytes(selectedShared.size)}</p><p>{fmtBytes(selectedShared.transferred)} transferred</p><p>{selectedShared.sharedByRule ? 'Rule shared' : 'Explicit share'}</p></div>{:else}<div class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">Inspect a shared file to view its path and counters.</div>{/if}</div></aside>
      </div>
    {/if}

    {#if activeSection === 'search'}
      <div class="section-layout split-layout grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <section class="panel"><div class="panel-body space-y-4"><div class="toolbar responsive-toolbar"><label class="field md:col-span-2"><span class="panel-kicker">Query</span><input bind:value={searchQuery} class="input-base" placeholder="search terms" type="text" /></label><label class="field"><span class="panel-kicker">Method</span><select bind:value={searchMethod} class="input-base"><option value="global">global</option><option value="kad">kad</option><option value="server">server</option></select></label><label class="field"><span class="panel-kicker">Type</span><select bind:value={searchType} class="input-base"><option value="any">any</option><option value="audio">audio</option><option value="video">video</option><option value="image">image</option><option value="program">program</option><option value="document">document</option><option value="archive">archive</option><option value="cdimage">cdimage</option></select></label><label class="field"><span class="panel-kicker">Ext</span><input bind:value={searchExt} class="input-base" placeholder="avi" type="text" /></label><label class="field"><span class="panel-kicker">Min bytes</span><input bind:value={searchMinSize} class="input-base" min="0" type="number" /></label><label class="field"><span class="panel-kicker">Max bytes</span><input bind:value={searchMaxSize} class="input-base" min="0" type="number" /></label></div><div class="action-cluster flex flex-wrap gap-2"><button class="btn btn-primary" disabled={isLaunchingSearch} type="button" on:click={() => void startSearch()}>{isLaunchingSearch ? 'Starting...' : 'Start search'}</button><button class="btn" disabled={!searchId} type="button" on:click={() => void refreshSearch()}>Poll results</button><button class="btn btn-danger" disabled={!searchId || isStoppingSearch} type="button" on:click={() => void stopSearch()}>{isStoppingSearch ? 'Stopping...' : 'Stop search'}</button></div><div class="table-wrap"><div class="overflow-x-auto"><table class="w-full min-w-[900px] text-sm"><thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3">Name</th><th class="px-4 py-3">Type</th><th class="px-4 py-3">Size</th><th class="px-4 py-3">Sources</th><th class="px-4 py-3">Network</th></tr></thead><tbody>{#if searchResults.length === 0}<tr><td class="px-4 py-6 text-center text-slate-500" colspan="5">No search results available yet.</td></tr>{:else}{#each searchResults as result}<tr class="border-t border-slate-100"><td class="px-4 py-3">{result.name}<div class="text-xs text-slate-500">{shortHash(result.hash)}</div></td><td class="px-4 py-3">{result.fileType || result.knownType || 'unknown'}</td><td class="px-4 py-3">{fmtBytes(result.size)}</td><td class="px-4 py-3">{result.sources}/{result.completeSources}</td><td class="px-4 py-3">{result.clientIp}:{result.clientPort}</td></tr>{/each}{/if}</tbody></table></div></div></div></section>
        <aside class="panel"><div class="panel-body space-y-4"><div><p class="panel-kicker">Session</p><h2 class="panel-title">Search state</h2></div><div class="rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><p>Search id: {searchId || 'n/a'}</p><p>Status: {searchStatus}</p><p>Results: {searchResults.length}</p></div></div></aside>
      </div>
    {/if}

    {#if activeSection === 'preferences'}
      <section class="panel"><div class="panel-body space-y-4"><div class="flex items-end justify-between gap-3"><div><p class="panel-kicker">Preferences</p><h2 class="panel-title">Curated runtime subset</h2></div><button class="btn btn-primary" disabled={!preferencesDraft || isSavingPreferences} type="button" on:click={() => void savePreferences()}>{isSavingPreferences ? 'Saving...' : 'Save preferences'}</button></div>{#if preferencesDraft}<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{#each preferenceFields as field}<label class="field rounded-xl bg-slate-50 p-4"><span class="panel-kicker">{field.label}</span>{#if field.kind === 'boolean'}<span class="mt-3 flex items-center gap-2 text-sm text-slate-700"><input checked={preferencesDraft[field.key]} class="rounded border-slate-300" on:change={(event) => preferencesDraft = { ...preferencesDraft, [field.key]: (event.currentTarget as HTMLInputElement).checked }} type="checkbox" /><span>Enabled</span></span>{:else}<input class="input-base mt-3" on:change={(event) => preferencesDraft = { ...preferencesDraft, [field.key]: Number.parseInt((event.currentTarget as HTMLInputElement).value, 10) || 0 }} type="number" value={preferencesDraft[field.key]} />{/if}</label>{/each}</div>{:else}<div class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">Preferences are not loaded yet.</div>{/if}</div></section>
    {/if}

    {#if activeSection === 'logs'}
      <section class="panel"><div class="panel-body space-y-4"><div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><p class="panel-kicker">Logs</p><h2 class="panel-title">Recent activity</h2></div><div class="grid gap-3 sm:grid-cols-2"><label class="field"><span class="panel-kicker">Limit</span><select bind:value={logLimit} class="input-base" on:change={() => void refreshLogs()}>{#each [60, 120, 240, 500] as option}<option value={option}>{option}</option>{/each}</select></label><label class="field"><span class="panel-kicker">Filter</span><select bind:value={logFilter} class="input-base">{#each logFilters as filter}<option value={filter}>{filter}</option>{/each}</select></label></div></div><div class="table-wrap"><div class="overflow-x-auto"><table class="w-full min-w-[560px] text-sm"><thead class="bg-slate-50 text-left text-slate-500"><tr><th class="px-4 py-3">Time</th><th class="px-4 py-3">Level</th><th class="px-4 py-3">Message</th></tr></thead><tbody>{#if filteredLogs.length === 0}<tr><td class="px-4 py-6 text-center text-slate-500" colspan="3">No log entries match the current filter.</td></tr>{:else}{#each filteredLogs as entry}<tr class="border-t border-slate-100"><td class="px-4 py-3 align-top font-mono text-slate-600">{fmtTime(entry.timestamp)}</td><td class="px-4 py-3 align-top"><span class={entry.debug || entry.level === 'debug' ? 'badge badge-muted' : entry.level === 'error' ? 'badge badge-danger' : entry.level === 'warning' ? 'badge badge-warn' : 'badge badge-info'}>{entry.debug ? 'debug' : entry.level}</span></td><td class="px-4 py-3 align-top text-slate-700">{entry.message}</td></tr>{/each}{/if}</tbody></table></div></div></div></section>
    {/if}
  </div>
</main>
