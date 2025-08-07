export interface TransferJob {
  id: string;
  jobId: string;              // Reference to SyncJob
  fileId: string;             // Reference to FileState
  type: TransferType;
  priority: TransferPriority;
  source: string;
  destination: string;
  filename: string;
  relativePath: string;
  size: number;
  sshConfig?: {
    host: string;
    port: number;
    username: string;
    privateKey?: string;
    password?: string;
  };
  rsyncOptions?: Record<string, string | number | boolean>;
  createdAt: Date;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: TransferStatus;
  progress?: TransferProgress;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

export enum TransferType {
  DOWNLOAD = 'download',
  UPLOAD = 'upload',
  SYNC = 'sync'
}

export enum TransferPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  URGENT = 3
}

export enum TransferStatus {
  QUEUED = 'queued',
  SCHEDULED = 'scheduled',
  STARTING = 'starting',
  TRANSFERRING = 'transferring',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RETRYING = 'retrying'
}

export interface TransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speed: string;
  eta: string;
  startTime: Date;
  lastUpdate: Date;
}

export interface QueueConfig {
  maxConcurrentTransfers: number;
  maxRetries: number;
  retryDelay: number;          // milliseconds
  priorityScheduling: boolean;
  autoStart: boolean;
  transferTimeout: number;     // milliseconds
  cleanupInterval: number;     // milliseconds
  maxQueueSize: number;
}

export interface QueueStats {
  total: number;
  queued: number;
  scheduled: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
  totalBytesQueued: number;
  totalBytesTransferred: number;
  totalBytesRemaining: number;
  estimatedTimeRemaining: number; // milliseconds
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;           // milliseconds
  maxDelay: number;            // milliseconds
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface TransferFilter {
  status?: TransferStatus[];
  priority?: TransferPriority[];
  type?: TransferType[];
  jobId?: string;
  fileId?: string;
  filename?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface TransferBatch {
  id: string;
  name: string;
  transfers: TransferJob[];
  createdAt: Date;
  status: BatchStatus;
  progress: BatchProgress;
}

export enum BatchStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface BatchProgress {
  totalTransfers: number;
  completedTransfers: number;
  failedTransfers: number;
  totalBytes: number;
  transferredBytes: number;
  percentage: number;
  estimatedTimeRemaining: number;
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxConcurrentTransfers: 3,
  maxRetries: 3,
  retryDelay: 5000,            // 5 seconds
  priorityScheduling: true,
  autoStart: true,
  transferTimeout: 3600000,    // 1 hour
  cleanupInterval: 300000,     // 5 minutes
  maxQueueSize: 1000
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelay: 1000,             // 1 second
  maxDelay: 60000,             // 1 minute
  backoffMultiplier: 2,
  retryableErrors: [
    'Connection timeout',
    'Network unreachable',
    'Connection refused',
    'Temporary failure',
    'Host is down'
  ]
};
