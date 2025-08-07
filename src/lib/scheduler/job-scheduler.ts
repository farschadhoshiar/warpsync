/**
 * Job Scheduler Core Service
 * Background service that automatically scans sync jobs and queues files
 */

import { logger } from '@/lib/logger';
import connectDB from '@/lib/mongodb';
import { FileScanner } from '@/lib/scanner/file-scanner';
import { FileMetadata } from '@/lib/scanner/types';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { TransferType, TransferPriority } from '@/lib/queue/types';
import { EventEmitter } from '@/lib/websocket/emitter';
import { SchedulerConfigManager } from './config';
import { 
  ScheduledJob, 
  JobStatus, 
  SchedulerStats, 
  JobExecution, 
  SchedulerConfig 
} from './types';

// Temporary type for SyncJob until proper interface is imported
type SyncJobType = {
  _id: string;
  name: string;
  remotePath: string;
  localPath: string;
  serverProfileId: {
    address: string;
    port: number;
    user: string;
    authMethod: 'password' | 'key';
    password?: string;
    privateKey?: string;
  };
  retrySettings?: { maxRetries: number };
};

export class JobScheduler {
  private static instance: JobScheduler;
  private config: SchedulerConfig;
  private configManager: SchedulerConfigManager;
  private isRunning = false;
  private scheduledJobs = new Map<string, ScheduledJob>();
  private runningExecutions = new Map<string, JobExecution>();
  private checkInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private fileScanner: FileScanner;
  private transferQueue: TransferQueue;
  private eventEmitter?: EventEmitter;
  private startTime = new Date();
  private stats: SchedulerStats = {
    totalJobs: 0,
    activeJobs: 0,
    scanningJobs: 0,
    errorJobs: 0,
    nextScanIn: 0,
    lastHealthCheck: new Date(),
    uptime: 0,
    totalScansCompleted: 0,
    totalScansFailed: 0
  };

  private constructor(configManager?: SchedulerConfigManager, eventEmitter?: EventEmitter) {
    this.configManager = configManager || SchedulerConfigManager.fromEnvironment();
    this.config = this.configManager.getConfig();
    this.eventEmitter = eventEmitter;
    this.fileScanner = new FileScanner(eventEmitter);
    this.transferQueue = TransferQueue.getInstance(undefined, undefined, eventEmitter);
  }

  static getInstance(configManager?: SchedulerConfigManager, eventEmitter?: EventEmitter): JobScheduler {
    if (!JobScheduler.instance) {
      JobScheduler.instance = new JobScheduler(configManager, eventEmitter);
    }
    return JobScheduler.instance;
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    logger.info('Starting job scheduler', { config: this.config });
    this.isRunning = true;
    this.startTime = new Date();

    // Load jobs from database
    await this.loadJobs();

    // Start check interval
    this.checkInterval = setInterval(() => {
      this.checkForJobsToRun().catch(error => {
        logger.error('Error in scheduler check cycle', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }, this.config.checkInterval);

    // Start health check interval
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck().catch(error => {
        logger.error('Error in scheduler health check', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }, this.config.healthCheckInterval);

    logger.info('Job scheduler started successfully', {
      totalJobs: this.scheduledJobs.size,
      checkInterval: this.config.checkInterval
    });
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping job scheduler');
    this.isRunning = false;

    // Clear intervals
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Wait for running executions to complete or timeout
    const runningJobs = Array.from(this.runningExecutions.keys());
    if (runningJobs.length > 0) {
      logger.info('Waiting for running scans to complete', { count: runningJobs.length });
      
      // Wait up to 30 seconds for jobs to complete
      const timeout = setTimeout(() => {
        logger.warn('Timeout waiting for running scans, forcing shutdown');
      }, 30000);

      while (this.runningExecutions.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      clearTimeout(timeout);
    }

    // Cleanup transfer queue
    await this.transferQueue.shutdown();

    logger.info('Job scheduler stopped');
  }

  /**
   * Load jobs from database
   */
  private async loadJobs(): Promise<void> {
    try {
      await connectDB();
      const { SyncJob } = await import('@/models');

      const jobs = await SyncJob.find({ enabled: true })
        .populate('serverProfileId', 'name address port user authMethod password privateKey');

      this.scheduledJobs.clear();

      for (const job of jobs) {
        const scheduledJob: ScheduledJob = {
          id: job._id.toString(),
          jobId: job._id.toString(),
          jobName: job.name,
          nextScan: this.calculateNextScan(job.lastScan, job.scanInterval),
          lastScan: job.lastScan,
          status: JobStatus.ACTIVE,
          scanInterval: job.scanInterval,
          autoQueueEnabled: job.autoQueue?.enabled || false,
          errorCount: 0,
          isScanning: false
        };

        this.scheduledJobs.set(job._id.toString(), scheduledJob);
      }

      this.updateStats();

      logger.info('Loaded scheduled jobs', {
        totalJobs: this.scheduledJobs.size,
        activeJobs: Array.from(this.scheduledJobs.values()).filter(j => j.status === JobStatus.ACTIVE).length
      });

    } catch (error) {
      logger.error('Failed to load jobs from database', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Calculate next scan time for a job
   */
  private calculateNextScan(lastScan: Date | null | undefined, scanInterval: number): Date {
    const now = new Date();
    
    if (!lastScan) {
      // If never scanned, scan immediately
      return now;
    }

    const nextScan = new Date(lastScan.getTime() + (scanInterval * 60 * 1000));
    
    // If next scan is in the past, scan immediately
    return nextScan < now ? now : nextScan;
  }

  /**
   * Check for jobs that need to be run
   */
  private async checkForJobsToRun(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const now = new Date();
    const jobsToRun: ScheduledJob[] = [];

    // Find jobs that are due for scanning
    for (const job of this.scheduledJobs.values()) {
      if (job.status === JobStatus.ACTIVE && 
          !job.isScanning && 
          job.nextScan <= now &&
          this.runningExecutions.size < this.config.maxConcurrentScans) {
        jobsToRun.push(job);
      }
    }

    // Start scans for due jobs
    for (const job of jobsToRun) {
      if (this.runningExecutions.size >= this.config.maxConcurrentScans) {
        break;
      }

      try {
        await this.startJobScan(job);
      } catch (error) {
        logger.error('Failed to start job scan', {
          jobId: job.jobId,
          jobName: job.jobName,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        this.handleJobError(job, error instanceof Error ? error : new Error('Unknown error'));
      }
    }

    this.updateStats();
  }

  /**
   * Start scanning a job
   */
  private async startJobScan(scheduledJob: ScheduledJob): Promise<void> {
    const execution: JobExecution = {
      jobId: scheduledJob.jobId,
      startTime: new Date(),
      status: 'running'
    };

    // Mark job as scanning
    scheduledJob.isScanning = true;
    this.runningExecutions.set(scheduledJob.jobId, execution);

    logger.info('Starting scheduled scan', {
      jobId: scheduledJob.jobId,
      jobName: scheduledJob.jobName
    });

    // Emit WebSocket event
    this.eventEmitter?.emitLogMessage({
      jobId: scheduledJob.jobId,
      level: 'info',
      message: `Starting scheduled scan for job "${scheduledJob.jobName}"`,
      source: 'scheduler',
      timestamp: new Date().toISOString()
    });

    try {
      // Set timeout for the scan
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Scan timeout')), this.config.scanTimeout);
      });

      // Perform the scan
      const scanPromise = this.performJobScan(scheduledJob.jobId);
      
      const scanResult = await Promise.race([scanPromise, timeoutPromise]) as Awaited<typeof scanPromise>;

      // Update execution record
      execution.endTime = new Date();
      execution.status = 'completed';
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
      execution.filesScanned = scanResult.totalFiles;
      execution.filesQueued = scanResult.queuedFiles;

      // Update scheduled job
      scheduledJob.lastScan = execution.startTime;
      scheduledJob.nextScan = this.calculateNextScan(scheduledJob.lastScan, scheduledJob.scanInterval);
      scheduledJob.errorCount = 0;
      scheduledJob.lastError = undefined;

      this.stats.totalScansCompleted++;

      logger.info('Scheduled scan completed successfully', {
        jobId: scheduledJob.jobId,
        jobName: scheduledJob.jobName,
        duration: execution.duration,
        filesScanned: execution.filesScanned,
        filesQueued: execution.filesQueued
      });

      // Update database with last scan time
      await this.updateJobLastScan(scheduledJob.jobId, execution.startTime);

    } catch (error) {
      execution.endTime = new Date();
      execution.status = execution.status === 'running' ? 'failed' : 'timeout';
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

      this.stats.totalScansFailed++;
      this.handleJobError(scheduledJob, error instanceof Error ? error : new Error('Unknown error'));

      logger.error('Scheduled scan failed', {
        jobId: scheduledJob.jobId,
        jobName: scheduledJob.jobName,
        error: execution.error,
        duration: execution.duration
      });

    } finally {
      // Clean up
      scheduledJob.isScanning = false;
      this.runningExecutions.delete(scheduledJob.jobId);
    }
  }

  /**
   * Perform the actual job scan
   */
  private async performJobScan(jobId: string): Promise<{ totalFiles: number; queuedFiles: number }> {
    await connectDB();
    const { SyncJob } = await import('@/models');

    // Get job details
    const syncJob = await SyncJob.findById(jobId)
      .populate('serverProfileId', 'name address port user authMethod password privateKey');

    if (!syncJob || !syncJob.enabled) {
      throw new Error('Job not found or disabled');
    }

    const serverProfile = syncJob.serverProfileId;
    if (!serverProfile) {
      throw new Error('Server profile not found');
    }

    // Build SSH config
    const sshConfig = {
      id: serverProfile._id.toString(),
      name: serverProfile.name,
      host: serverProfile.address,
      port: serverProfile.port,
      username: serverProfile.user,
      ...(serverProfile.authMethod === 'password' 
        ? { password: serverProfile.password }
        : { privateKey: serverProfile.privateKey }
      )
    };

    // Perform directory comparison with auto-queue
    const comparison = await this.fileScanner.compareDirectories(
      syncJob._id.toString(),
      sshConfig,
      syncJob.remotePath,
      syncJob.localPath,
      {
        autoQueueConfig: syncJob.autoQueue?.enabled ? {
          enabled: true,
          patterns: (syncJob.autoQueue.patterns || []).map((pattern: string) => ({
            patterns: [pattern],
            isInclude: true,
            caseSensitive: false
          })),
          includeExtensions: syncJob.autoQueue.includeExtensions || []
        } : undefined
      }
    );

    // If auto-queue is enabled, queue the discovered files
    let queuedFiles = 0;
    if (syncJob.autoQueue?.enabled && comparison.autoQueuedFiles && comparison.autoQueuedFiles.length > 0) {
      queuedFiles = await this.queueDiscoveredFiles(syncJob, comparison.autoQueuedFiles);
    }

    return {
      totalFiles: comparison.stats.totalRemote + comparison.stats.totalLocal,
      queuedFiles
    };
  }

  /**
   * Queue discovered files for transfer
   */
  private async queueDiscoveredFiles(syncJob: SyncJobType, files: FileMetadata[]): Promise<number> {
    const { FileState } = await import('@/models');
    let queuedCount = 0;

    // Get server profile for transfer configuration
    const serverProfile = syncJob.serverProfileId;

    for (const file of files) {
      try {
        // Find the file state
        const fileState = await FileState.findOne({
          jobId: syncJob._id,
          relativePath: file.path,
          syncState: 'remote_only'
        });

        if (!fileState) {
          continue;
        }

        // Add to transfer queue
        const remotePath = `${syncJob.remotePath}/${file.path}`.replace(/\/+/g, '/');
        const localPath = `${syncJob.localPath}/${file.path}`.replace(/\/+/g, '/');

        await this.transferQueue.addTransfer({
          jobId: syncJob._id.toString(),
          fileId: fileState._id.toString(),
          type: TransferType.DOWNLOAD,
          priority: TransferPriority.NORMAL,
          source: remotePath,
          destination: localPath,
          filename: fileState.filename,
          relativePath: fileState.relativePath,
          size: fileState.remote.size || 0,
          sshConfig: {
            host: serverProfile.address,
            port: serverProfile.port,
            username: serverProfile.user,
            ...(serverProfile.authMethod === 'password' 
              ? { password: serverProfile.password }
              : { privateKey: serverProfile.privateKey }
            )
          },
          maxRetries: syncJob.retrySettings?.maxRetries || 3
        });

        // Update file state to queued
        fileState.syncState = 'queued';
        fileState.transfer.progress = 0;
        fileState.transfer.retryCount = 0;
        await fileState.save();

        queuedCount++;

      } catch (error) {
        logger.error('Failed to queue auto-discovered file', {
          jobId: syncJob._id.toString(),
          relativePath: file.path,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    if (queuedCount > 0) {
      logger.info('Auto-queued files for transfer', {
        jobId: syncJob._id.toString(),
        jobName: syncJob.name,
        queuedCount,
        totalDiscovered: files.length
      });

      // Emit WebSocket event
      this.eventEmitter?.emitLogMessage({
        jobId: syncJob._id.toString(),
        level: 'info',
        message: `Auto-queued ${queuedCount} files for transfer`,
        source: 'scheduler',
        timestamp: new Date().toISOString()
      });
    }

    return queuedCount;
  }

  /**
   * Handle job error
   */
  private handleJobError(scheduledJob: ScheduledJob, error: Error): void {
    scheduledJob.errorCount++;
    scheduledJob.lastError = error.message;

    if (scheduledJob.errorCount >= this.config.maxErrorCount) {
      scheduledJob.status = JobStatus.ERROR;
      logger.error('Job marked as error due to excessive failures', {
        jobId: scheduledJob.jobId,
        jobName: scheduledJob.jobName,
        errorCount: scheduledJob.errorCount,
        lastError: scheduledJob.lastError
      });
    } else {
      // Schedule retry
      scheduledJob.nextScan = new Date(Date.now() + this.config.errorRetryDelay);
      logger.warn('Job scan failed, will retry', {
        jobId: scheduledJob.jobId,
        jobName: scheduledJob.jobName,
        errorCount: scheduledJob.errorCount,
        nextRetry: scheduledJob.nextScan
      });
    }
  }

  /**
   * Update job last scan time in database
   */
  private async updateJobLastScan(jobId: string, lastScan: Date): Promise<void> {
    try {
      await connectDB();
      const { SyncJob } = await import('@/models');
      
      await SyncJob.findByIdAndUpdate(jobId, { lastScan });
    } catch (error) {
      logger.error('Failed to update job last scan time', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Update scheduler statistics
   */
  private updateStats(): void {
    const jobs = Array.from(this.scheduledJobs.values());
    
    this.stats = {
      ...this.stats,
      totalJobs: jobs.length,
      activeJobs: jobs.filter(j => j.status === JobStatus.ACTIVE).length,
      scanningJobs: jobs.filter(j => j.isScanning).length,
      errorJobs: jobs.filter(j => j.status === JobStatus.ERROR).length,
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      nextScanIn: this.getNextScanTime()
    };
  }

  /**
   * Get time until next scan in seconds
   */
  private getNextScanTime(): number {
    const now = new Date();
    let nextScan: Date | null = null;

    for (const job of this.scheduledJobs.values()) {
      if (job.status === JobStatus.ACTIVE && !job.isScanning) {
        if (!nextScan || job.nextScan < nextScan) {
          nextScan = job.nextScan;
        }
      }
    }

    return nextScan ? Math.max(0, Math.floor((nextScan.getTime() - now.getTime()) / 1000)) : 0;
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(): Promise<void> {
    this.stats.lastHealthCheck = new Date();
    
    // Update stats
    this.updateStats();
  }

  /**
   * Get scheduler statistics
   */
  getStats(): SchedulerStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get scheduled jobs
   */
  getScheduledJobs(): ScheduledJob[] {
    return Array.from(this.scheduledJobs.values());
  }

  /**
   * Get running executions
   */
  getRunningExecutions(): JobExecution[] {
    return Array.from(this.runningExecutions.values());
  }

  /**
   * Force refresh jobs from database
   */
  async refreshJobs(): Promise<void> {
    await this.loadJobs();
  }

  /**
   * Manually trigger a job scan
   */
  async triggerJobScan(jobId: string): Promise<void> {
    const scheduledJob = this.scheduledJobs.get(jobId);
    if (!scheduledJob) {
      throw new Error('Job not found in scheduler');
    }

    if (scheduledJob.isScanning) {
      throw new Error('Job is already scanning');
    }

    if (this.runningExecutions.size >= this.config.maxConcurrentScans) {
      throw new Error('Maximum concurrent scans reached');
    }

    await this.startJobScan(scheduledJob);
  }

  /**
   * Check if scheduler is running
   */
  isSchedulerRunning(): boolean {
    return this.isRunning;
  }
}
