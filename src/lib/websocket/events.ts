export interface SocketEvents {
  // File state events
  'file:state:update': {
    jobId: string;
    fileId: string;
    filename: string;
    relativePath: string;
    oldState: FileStateType;
    newState: FileStateType;
    timestamp: string;
  };
  
  // Unified transfer progress events
  'transfer:progress': {
    transferId: string;
    fileId: string;
    jobId: string;
    filename: string;
    progress: number;           // 0-100 percentage
    bytesTransferred: number;
    totalBytes: number;
    speed: string;             // Human readable (e.g., "1.2 MB/s")
    speedBps: number;          // Raw bytes per second
    eta: string;               // Human readable (e.g., "0:02:15")
    etaSeconds: number;        // Raw seconds remaining
    status: 'starting' | 'transferring' | 'completed' | 'failed';
    elapsedTime: number;       // Milliseconds since start
    compressionRatio?: number; // Optional compression statistics
    timestamp: string;
  };

  // Transfer status change events
  'transfer:status': {
    transferId: string;
    fileId: string;
    jobId: string;
    filename: string;
    oldStatus: string;
    newStatus: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  };
  
  // Scan completion events
  'scan:complete': {
    jobId: string;
    jobName: string;
    remotePath: string;
    localPath: string;
    filesFound: number;
    filesAdded: number;
    filesUpdated: number;
    filesRemoved: number;
    duration: number;
    timestamp: string;
  };
  
  // Log streaming events
  'log:message': {
    jobId?: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    source: 'rsync' | 'ssh' | 'scanner' | 'system' | 'scheduler';
    timestamp: string;
  };
  
  // Connection events
  'connection:test': {
    serverId: string;
    serverName: string;
    success: boolean;
    duration: number;
    error?: string;
    timestamp: string;
  };
  
  // Error events
  'error:occurred': {
    jobId?: string;
    serverId?: string;
    type: 'connection' | 'transfer' | 'scan' | 'validation' | 'system' | 'spawn';
    message: string;
    details?: Record<string, unknown>;
    timestamp: string;
  };
}

export type FileStateType = 'synced' | 'remote_only' | 'local_only' | 'desynced' | 'queued' | 'transferring' | 'failed';

// Event validation schemas
import { z } from 'zod';

export const FileStateUpdateSchema = z.object({
  jobId: z.string(),
  fileId: z.string(),
  filename: z.string(),
  relativePath: z.string(),
  oldState: z.enum(['synced', 'remote_only', 'local_only', 'desynced', 'queued', 'transferring', 'failed']),
  newState: z.enum(['synced', 'remote_only', 'local_only', 'desynced', 'queued', 'transferring', 'failed']),
  timestamp: z.string()
});

export const UnifiedTransferProgressSchema = z.object({
  transferId: z.string(),
  fileId: z.string(),
  jobId: z.string(),
  filename: z.string(),
  progress: z.number().min(0).max(100),
  bytesTransferred: z.number().min(0),
  totalBytes: z.number().min(0),
  speed: z.string(),
  speedBps: z.number().min(0),
  eta: z.string(),
  etaSeconds: z.number().min(0),
  status: z.enum(['starting', 'transferring', 'completed', 'failed']),
  elapsedTime: z.number().min(0),
  compressionRatio: z.number().optional(),
  timestamp: z.string()
});

export const TransferStatusSchema = z.object({
  transferId: z.string(),
  fileId: z.string(),
  jobId: z.string(),
  filename: z.string(),
  oldStatus: z.string(),
  newStatus: z.string(),
  timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
