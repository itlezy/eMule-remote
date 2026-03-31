export interface SystemStats {
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

export interface SystemVersion {
  appName: string;
  version: string;
  build: string;
  platform: string;
}

export interface Download {
  hash: string;
  name: string;
  size: number;
  sizeDone: number;
  progress: number;
  state: string;
  priority: string;
  autoPriority: boolean;
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

export interface ApiError {
  error: string;
  message: string;
}

export interface PipeEventEnvelope {
  event: string;
  data: unknown;
}
