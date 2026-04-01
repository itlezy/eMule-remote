export interface GlobalStats {
  connected: boolean;
  downloadSpeed: number;
  uploadSpeed: number;
  sessionDownloaded: number;
  sessionUploaded: number;
  activeUploads: number;
  waitingUploads: number;
  downloadCount: number;
  ed2kConnected: boolean;
  ed2kHighId: boolean;
  kadRunning: boolean;
  kadConnected: boolean;
  kadFirewalled: boolean | null;
}

export interface AppVersion {
  appName: string;
  version: string;
  build: string;
  platform: string;
}

export interface Transfer {
  hash: string;
  name: string;
  size: number;
  sizeDone: number;
  progress: number;
  state: string;
  priority: string;
  autoPriority: boolean;
  category: number;
  downloadSpeed: number;
  uploadSpeed: number;
  sources: number;
  sourcesTransferring: number;
  eta: number | null;
  addedAt: number | null;
  completedAt: number | null;
  partsTotal: number;
  partsAvailable: number;
  stopped: boolean;
}

export interface MutationResult {
  hash: string | null;
  ok: boolean;
  error?: string | null;
  name?: string;
}

export interface MutationResponse {
  results: MutationResult[];
}

export interface Source {
  userName: string;
  userHash: string;
  clientSoftware: string;
  downloadState: string;
  downloadRate: number;
  availableParts: number;
  partCount: number;
  ip: string;
  port: number;
  serverIp: string;
  serverPort: number;
  lowId: boolean;
  queueRank: number;
}

export interface LogEntry {
  timestamp: number;
  message: string;
  level: string;
  debug: boolean;
}

export interface Preferences {
  maxUploadKiB: number;
  maxDownloadKiB: number;
  maxConnections: number;
  maxConPerFive: number;
  maxSourcesPerFile: number;
  uploadClientDataRate: number;
  maxUploadSlots: number;
  queueSize: number;
  autoConnect: boolean;
  newAutoUp: boolean;
  newAutoDown: boolean;
  creditSystem: boolean;
  safeServerConnect: boolean;
  networkKademlia: boolean;
  networkEd2k: boolean;
}

export interface UploadEntry {
  userName: string;
  userHash: string | null;
  clientSoftware: string;
  clientMod: string;
  uploadState: string;
  uploadSpeed: number;
  sessionUploaded: number;
  queueSessionUploaded: number;
  payloadBuffered: number;
  waitTimeMs: number;
  waitStartedTick: number;
  score: number;
  ip: string;
  port: number;
  serverIp: string;
  serverPort: number;
  lowId: boolean;
  friendSlot: boolean;
  uploading: boolean;
  waitingQueue: boolean;
  requestedFileHash: string | null;
  requestedFileName: string | null;
  requestedFileSize: number | null;
}

export interface Server {
  name: string;
  address: string;
  port: number;
  ip: string;
  dynIp: string;
  description: string;
  version: string;
  users: number;
  files: number;
  softFiles: number;
  hardFiles: number;
  ping: number;
  failedCount: number;
  priority: string;
  static: boolean;
  current: boolean;
  connected: boolean;
  connecting: boolean;
}

export interface ServerStatus {
  connected: boolean;
  connecting: boolean;
  lowId: boolean | null;
  serverCount: number;
  currentServer: Server | null;
}

export interface KadStatus {
  running: boolean;
  connected: boolean;
  firewalled: boolean | null;
  bootstrapping: boolean;
  bootstrapProgress: number;
  users: number | null;
  files: number | null;
}

export interface SharedFile {
  hash: string;
  name: string;
  path: string;
  directory: string;
  size: number;
  uploadPriority: string;
  autoUploadPriority: boolean;
  requests: number;
  accepts: number;
  transferred: number;
  allTimeRequests: number;
  allTimeAccepts: number;
  allTimeTransferred: number;
  partCount: number;
  partFile: boolean;
  complete: boolean;
  publishedEd2k: boolean;
  sharedByRule: boolean;
}

export interface SharedAddResponse {
  ok: boolean;
  path: string;
  alreadyShared: boolean;
  queued: boolean;
  file: SharedFile | null;
}

export interface SharedRemoveResponse {
  ok: boolean;
  path: string;
  hash: string | null;
}

export interface UploadControlResponse {
  ok: boolean;
  removed?: 'queue' | 'slot';
}

export interface SearchResult {
  searchId: string;
  hash: string;
  name: string;
  size: number;
  fileType: string;
  sources: number;
  completeSources: number;
  complete: boolean | null;
  knownType: string;
  directory: string | null;
  clientIp: string;
  clientPort: number;
  serverIp: string;
  serverPort: number;
  clientCount: number;
  serverCount: number;
  kadPublishInfo: number;
  spam: boolean;
}

export interface SearchSession {
  search_id: string;
}

export interface SearchResultsResponse {
  status: 'running' | 'complete';
  results: SearchResult[];
}

export interface ApiError {
  error: string;
  message: string;
}

export interface PipeEventEnvelope<T = unknown> {
  event: string;
  data: T;
}
