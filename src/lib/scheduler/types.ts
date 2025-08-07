/**
 * Scheduler Types and Interfaces
 * Defines types for the background job scheduling system
 */

export interface ScheduledJob {
  id: string;
  jobId: string;
  jobName: string;
  nextScan: Date;
  lastScan?: Date;
  status: JobStatus;
  scanInterval: number; // minutes
  autoQueueEnabled: boolean;
  errorCount: number;
  lastError?: string;
  isScanning: boolean;
}

export enum JobStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
  ERROR = 'error',
  SCANNING = 'scanning'
}

export interface SchedulerConfig {
  checkInterval: number; // ms - how often to check for jobs to run
  maxConcurrentScans: number; // max simultaneous scan operations
  scanTimeout: number; // ms - timeout for individual scans
  errorRetryDelay: number; // ms - delay before retrying failed jobs
  maxErrorCount: number; // max errors before marking job as failed
  healthCheckInterval: number; // ms - how often to perform health checks
}

export interface SchedulerStats {
  totalJobs: number;
  activeJobs: number;
  scanningJobs: number;
  errorJobs: number;
  nextScanIn: number; // seconds until next scan
  lastHealthCheck: Date;
  uptime: number; // seconds
  totalScansCompleted: number;
  totalScansFailed: number;
}

export interface JobExecution {
  jobId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  filesScanned?: number;
  filesQueued?: number;
  error?: string;
  duration?: number; // ms
}

export interface SchedulerHealth {
  status: 'healthy' | 'warning' | 'error';
  issues: string[];
  lastCheck: Date;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  activeConnections: number;
  queueSize: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  checkInterval: 30000, // 30 seconds
  maxConcurrentScans: 3,
  scanTimeout: 10 * 60 * 1000, // 10 minutes
  errorRetryDelay: 5 * 60 * 1000, // 5 minutes
  maxErrorCount: 5,
  healthCheckInterval: 60000 // 1 minute
};
