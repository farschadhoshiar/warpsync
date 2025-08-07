import { ConnectConfig } from 'ssh2';

export interface SSHConnectionConfig extends ConnectConfig {
  id: string;
  name: string;
  maxRetries?: number;
  retryDelay?: number;
  connectionTimeout?: number;
  keepAliveInterval?: number;
}

export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  RETRYING = 'retrying'
}

export interface ConnectionStats {
  connectionId: string;
  status: ConnectionStatus;
  connectedAt?: Date;
  disconnectedAt?: Date;
  lastActivity: Date;
  bytesReceived: number;
  bytesSent: number;
  commandsExecuted: number;
  errors: number;
}

export interface SSHConnectionPool {
  maxConnections: number;
  idleTimeout: number;
  connectionTTL: number;
  healthCheckInterval: number;
}

export interface SSHFileInfo {
  path: string;
  name: string;
  size: number;
  modTime: Date;
  isDirectory: boolean;
  permissions: string;
}

export interface SSHDirectoryListing {
  path: string;
  files: SSHFileInfo[];
  scannedAt: Date;
  totalFiles: number;
  totalSize: number;
}

export interface SSHCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
}

export interface SSHConnectionError extends Error {
  code: string;
  level: 'connection' | 'authentication' | 'command' | 'network';
  retryable: boolean;
  connectionId?: string;
}

export interface SSHPoolConfiguration {
  maxConnections: number;
  idleTimeout: number; // milliseconds
  connectionTTL: number; // milliseconds
  healthCheckInterval: number; // milliseconds
  retryAttempts: number;
  retryDelay: number; // milliseconds
}

export const DEFAULT_SSH_POOL_CONFIG: SSHPoolConfiguration = {
  maxConnections: 10,
  idleTimeout: 30000, // 30 seconds
  connectionTTL: 300000, // 5 minutes
  healthCheckInterval: 60000, // 1 minute
  retryAttempts: 3,
  retryDelay: 1000 // 1 second
};
