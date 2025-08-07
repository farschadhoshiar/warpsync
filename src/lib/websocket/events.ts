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
  
  // Transfer progress events
  'file:transfer:progress': {
    jobId: string;
    fileId: string;
    filename: string;
    progress: number;
    speed: string;
    eta: string;
    bytesTransferred: number;
    totalBytes: number;
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
    source: 'rsync' | 'ssh' | 'scanner' | 'system';
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
    type: 'connection' | 'transfer' | 'scan' | 'validation';
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

export const TransferProgressSchema = z.object({
  jobId: z.string(),
  fileId: z.string(),
  filename: z.string(),
  progress: z.number().min(0).max(100),
  speed: z.string(),
  eta: z.string(),
  bytesTransferred: z.number().min(0),
  totalBytes: z.number().min(0)
});
