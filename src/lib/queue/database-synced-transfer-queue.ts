import { TransferQueue } from './transfer-queue';
import { TransferStateManager } from './transfer-state-manager';
import { JobConcurrencyController } from './job-concurrency-controller';
import { StateRecoveryService } from './state-recovery-service';
import { EventEmitter } from '../websocket/emitter';
import { logger } from '@/lib/logger';
import {
  TransferJob,
  TransferStatus,
  TransferPriority,
  QueueConfig,
  RetryPolicy,
  DEFAULT_QUEUE_CONFIG,
  DEFAULT_RETRY_POLICY
} from './types';

export interface ConcurrencyCheckResult {
  hasAvailableSlots: boolean;
  availableSlot?: number;
  estimatedWaitTime?: number;
  currentActiveCount: number;
  maxAllowed: number;
}

export interface DatabaseSyncResult {
  transferId: string;
  wasQueued: boolean;
  concurrencySlot?: number;
  isDuplicate: boolean;
  upgraded: boolean;
}

export class DatabaseSyncedTransferQueue extends TransferQueue {
  private stateManager: TransferStateManager;
  private concurrencyController: JobConcurrencyController;
  private recoveryService: StateRecoveryService;
  private isInitialized = false;

  constructor(
    config: Partial<QueueConfig> = {},
    retryPolicy: Partial<RetryPolicy> = {},
    eventEmitter?: EventEmitter
  ) {
    super(config, retryPolicy, eventEmitter);

    this.stateManager = new TransferStateManager(eventEmitter);
    this.concurrencyController = new JobConcurrencyController();
    this.recoveryService = new StateRecoveryService(
      this.stateManager,
      this.concurrencyController
    );
  }

  /**
   * Initialize from database - must be called before using the queue
   */
  async initializeFromDatabase(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info('Initializing database-synced transfer queue');

      // Step 1: Recover system state
      const recoveryResult = await this.recoveryService.recoverSystemState();

      // Step 2: Rebuild in-memory queue from database
      await this.recoveryService.rebuildTransferQueue(this);

      // Step 3: Validate consistency
      const validationResult = await this.recoveryService.validateStateConsistency(this);

      if (!validationResult.isValid) {
        logger.warn('State inconsistencies detected during initialization', {
          issues: validationResult.issues.length,
          highSeverityIssues: validationResult.issues.filter(i => i.severity === 'high').length
        });
      }

      this.isInitialized = true;
      logger.info('Database-synced transfer queue initialized successfully', {
        recoveryResult,
        validationPassed: validationResult.isValid
      });

    } catch (error) {
      logger.error('Failed to initialize database-synced transfer queue', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Add transfer with database sync and concurrency checking
   */
  async addTransfer(transfer: Omit<TransferJob, 'id' | 'createdAt' | 'status' | 'retryCount'>): Promise<string> {
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initializeFromDatabase();
    }

    // Check concurrency limits first
    const concurrencyCheck = await this.checkJobConcurrency(transfer.jobId);

    if (!concurrencyCheck.hasAvailableSlots) {
      // Add to database queue but not in-memory queue yet
      return await this.addTransferToDatabase(transfer, 'queued');
    }

    // Has available slot - proceed with full addition
    return await this.addTransferWithConcurrencyCheck(transfer, transfer.jobId);
  }

  /**
   * Add transfer with concurrency checking and slot assignment
   */
  async addTransferWithConcurrencyCheck(
    transfer: Omit<TransferJob, 'id' | 'createdAt' | 'status' | 'retryCount'>,
    jobId: string
  ): Promise<string> {
    try {
      // Get available concurrency slot
      const availableSlot = await this.concurrencyController.getAvailableSlot(jobId);

      if (availableSlot === null) {
        // No slots available - add to database queue only
        return await this.addTransferToDatabase(transfer, 'queued');
      }

      // Create transfer ID
      const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Reserve concurrency slot
      const slotAssigned = await this.concurrencyController.reserveSlot(
        jobId,
        transferId,
        transfer.fileId,
        transfer.filename
      );

      if (slotAssigned === null) {
        // Slot assignment failed - add to database queue only
        return await this.addTransferToDatabase(transfer, 'queued');
      }

      // Add to in-memory queue
      const memoryTransferId = await super.addTransfer(transfer);

      // Update database with transferring state and slot assignment
      await this.updateDatabaseState(
        transfer.fileId,
        'transferring',
        transferId,
        {
          jobConcurrencySlot: slotAssigned,
          startedAt: new Date(),
          progress: 0
        }
      );

      logger.info('Transfer added with concurrency slot', {
        transferId,
        jobId,
        fileId: transfer.fileId,
        filename: transfer.filename,
        slotNumber: slotAssigned
      });

      return transferId;

    } catch (error) {
      logger.error('Failed to add transfer with concurrency check', {
        jobId,
        fileId: transfer.fileId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Override startTransfer to include database sync
   */
  async startTransfer(transferId: string): Promise<void> {
    try {
      const transfer = this.getTransfer(transferId);
      if (!transfer) {
        throw new Error(`Transfer ${transferId} not found`);
      }

      // Update database state
      await this.stateManager.transitionState(
        transfer.fileId,
        'queued',
        'transferring',
        transferId,
        {
          startedAt: new Date(),
          progress: 0
        }
      );

      // Start transfer in memory
      await super.startTransfer(transferId);

      logger.info('Transfer started with database sync', {
        transferId,
        fileId: transfer.fileId,
        filename: transfer.filename
      });

    } catch (error) {
      logger.error('Failed to start transfer', {
        transferId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Override completeTransfer to include database sync and slot release
   */
  async completeTransfer(transferId: string): Promise<void> {
    try {
      const transfer = this.getTransfer(transferId);
      if (!transfer) {
        throw new Error(`Transfer ${transferId} not found`);
      }

      // Update database state
      await this.stateManager.transitionState(
        transfer.fileId,
        'transferring',
        'synced',
        transferId,
        {
          completedAt: new Date(),
          progress: 100
        }
      );

      // Release concurrency slot
      await this.concurrencyController.releaseSlotByTransferId(transferId);

      // Complete transfer in memory
      await super.completeTransfer(transferId);

      // Check if we can start queued transfers for this job
      await this.processQueuedTransfersForJob(transfer.jobId);

      logger.info('Transfer completed with database sync', {
        transferId,
        fileId: transfer.fileId,
        filename: transfer.filename
      });

    } catch (error) {
      logger.error('Failed to complete transfer', {
        transferId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Override failTransfer to include database sync and slot release
   */
  async failTransfer(transferId: string, error: string): Promise<void> {
    try {
      const transfer = this.getTransfer(transferId);
      if (!transfer) {
        throw new Error(`Transfer ${transferId} not found`);
      }

      // Update database state
      await this.stateManager.transitionState(
        transfer.fileId,
        'transferring',
        'failed',
        transferId,
        {
          completedAt: new Date(),
          error: error
        }
      );

      // Release concurrency slot
      await this.concurrencyController.releaseSlotByTransferId(transferId);

      // Fail transfer in memory
      await super.failTransfer(transferId, error);

      // Check if we can start queued transfers for this job
      await this.processQueuedTransfersForJob(transfer.jobId);

      logger.info('Transfer failed with database sync', {
        transferId,
        fileId: transfer.fileId,
        filename: transfer.filename,
        error
      });

    } catch (error) {
      logger.error('Failed to fail transfer', {
        transferId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Check job concurrency limits
   */
  async checkJobConcurrency(jobId: string): Promise<ConcurrencyCheckResult> {
    try {
      const hasSlots = await this.concurrencyController.hasAvailableSlots(jobId);
      const activeCount = await this.concurrencyController.getActiveTransfersCount(jobId);
      const maxAllowed = await this.getJobMaxConcurrency(jobId);
      const availableSlot = hasSlots ? await this.concurrencyController.getAvailableSlot(jobId) : undefined;

      // Estimate wait time based on current queue
      let estimatedWaitTime = 0;
      if (!hasSlots) {
        const queuedCount = await this.getQueuedCountForJob(jobId);
        estimatedWaitTime = Math.ceil(queuedCount / maxAllowed) * 30000; // Rough estimate: 30s per transfer
      }

      return {
        hasAvailableSlots: hasSlots,
        availableSlot,
        estimatedWaitTime,
        currentActiveCount: activeCount,
        maxAllowed
      };

    } catch (error) {
      logger.error('Failed to check job concurrency', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        hasAvailableSlots: false,
        currentActiveCount: 0,
        maxAllowed: 0
      };
    }
  }

  /**
   * Process queued transfers for a job when slots become available
   */
  private async processQueuedTransfersForJob(jobId: string): Promise<void> {
    try {
      const hasSlots = await this.concurrencyController.hasAvailableSlots(jobId);
      if (!hasSlots) {
        return;
      }

      const { FileState } = await import('@/models');

      // Find queued transfers for this job
      const queuedTransfers = await FileState.find({
        jobId,
        syncState: 'queued',
        'transfer.activeTransferId': { $exists: true }
      }).sort({ 'transfer.lastStateChange': 1 }).limit(5);

      for (const queuedTransfer of queuedTransfers) {
        const concurrencyCheck = await this.checkJobConcurrency(jobId);
        if (!concurrencyCheck.hasAvailableSlots) {
          break; // No more slots available
        }

        try {
          // Start the queued transfer
          await this.startQueuedTransfer(queuedTransfer);

        } catch (error) {
          logger.error('Failed to start queued transfer', {
            transferId: queuedTransfer.transfer.activeTransferId,
            fileId: queuedTransfer._id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

    } catch (error) {
      logger.error('Failed to process queued transfers for job', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Start a queued transfer
   */
  private async startQueuedTransfer(fileState: any): Promise<void> {
    const transferId = fileState.transfer.activeTransferId;

    // Get available slot
    const availableSlot = await this.concurrencyController.getAvailableSlot(fileState.jobId.toString());
    if (availableSlot === null) {
      return;
    }

    // Reserve slot
    const slotAssigned = await this.concurrencyController.reserveSlot(
      fileState.jobId.toString(),
      transferId,
      fileState._id.toString(),
      fileState.filename
    );

    if (slotAssigned === null) {
      return;
    }

    // Update database state to transferring
    await this.stateManager.transitionState(
      fileState._id.toString(),
      'queued',
      'transferring',
      transferId,
      {
        jobConcurrencySlot: slotAssigned,
        startedAt: new Date()
      }
    );

    logger.info('Queued transfer started', {
      transferId,
      fileId: fileState._id,
      filename: fileState.filename,
      slotNumber: slotAssigned
    });
  }

  /**
   * Add transfer to database only (for queueing when no slots available)
   */
  private async addTransferToDatabase(
    transfer: Omit<TransferJob, 'id' | 'createdAt' | 'status' | 'retryCount'>,
    state: 'queued' | 'transferring'
  ): Promise<string> {
    const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await this.updateDatabaseState(
      transfer.fileId,
      state,
      transferId,
      {
        progress: 0,
        retryCount: 0,
        source: 'manual' // TODO: Get from transfer data
      }
    );

    logger.info('Transfer added to database queue', {
      transferId,
      fileId: transfer.fileId,
      filename: transfer.filename,
      state
    });

    return transferId;
  }

  /**
   * Update database state for a file
   */
  private async updateDatabaseState(
    fileId: string,
    state: string,
    transferId: string,
    metadata?: any
  ): Promise<void> {
    await this.stateManager.transitionState(
      fileId,
      'remote_only', // We don't know the current state, let the state manager handle it
      state,
      transferId,
      metadata
    );
  }

  /**
   * Get job's maximum concurrency limit
   */
  private async getJobMaxConcurrency(jobId: string): Promise<number> {
    try {
      const { SyncJob } = await import('@/models');
      const job = await SyncJob.findById(jobId, 'parallelism').lean();
      return job?.parallelism?.maxConcurrentTransfers || 3;
    } catch (error) {
      logger.error('Failed to get job max concurrency', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 3;
    }
  }

  /**
   * Get queued transfer count for a job
   */
  private async getQueuedCountForJob(jobId: string): Promise<number> {
    try {
      const { FileState } = await import('@/models');
      return await FileState.countDocuments({
        jobId,
        syncState: 'queued'
      });
    } catch (error) {
      logger.error('Failed to get queued count for job', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Recover orphaned transfers
   */
  async recoverOrphanedTransfers(): Promise<number> {
    return await this.recoveryService.handleOrphanedTransfers();
  }

  /**
   * Validate state consistency
   */
  async validateConsistency(): Promise<any> {
    return await this.recoveryService.validateStateConsistency(this);
  }

  /**
   * Get enhanced queue statistics including database info
   */
  async getEnhancedStats(): Promise<any> {
    const baseStats = this.getStats();
    const concurrencyStats = this.concurrencyController.getStats();

    try {
      const { FileState } = await import('@/models');

      const [queuedCount, transferringCount, totalCount] = await Promise.all([
        FileState.countDocuments({ syncState: 'queued' }),
        FileState.countDocuments({ syncState: 'transferring' }),
        FileState.countDocuments({})
      ]);

      return {
        ...baseStats,
        concurrency: concurrencyStats,
        database: {
          queuedFiles: queuedCount,
          transferringFiles: transferringCount,
          totalFiles: totalCount
        },
        consistency: {
          memoryTransfers: this.queue.size,
          databaseActiveTransfers: queuedCount + transferringCount
        }
      };

    } catch (error) {
      logger.error('Failed to get enhanced stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        ...baseStats,
        concurrency: concurrencyStats,
        database: { error: 'Failed to get database stats' }
      };
    }
  }

  /**
   * Health check for the database-synced queue
   */
  async healthCheck(): Promise<any> {
    const checks = [];
    let healthy = true;

    try {
      // Check if initialized
      checks.push({
        name: 'Initialization',
        passed: this.isInitialized,
        message: this.isInitialized ? 'Queue initialized' : 'Queue not initialized'
      });

      if (!this.isInitialized) {
        healthy = false;
      }

      // Check recovery service health
      const recoveryHealth = await this.recoveryService.healthCheck();
      checks.push(...recoveryHealth.checks);

      if (!recoveryHealth.healthy) {
        healthy = false;
      }

      // Check state consistency
      const validation = await this.validateConsistency();
      checks.push({
        name: 'State Consistency',
        passed: validation.isValid,
        message: `${validation.issues.length} issues found`
      });

      if (!validation.isValid) {
        healthy = false;
      }

    } catch (error) {
      healthy = false;
      checks.push({
        name: 'Health Check Error',
        passed: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return { healthy, checks };
  }

  /**
   * Graceful shutdown - clean up resources
   */
  async shutdown(): Promise<void> {
    try {
      logger.info('Shutting down database-synced transfer queue');

      // Cancel all active transfers
      const activeTransfers = this.getTransfers({ status: [TransferStatus.TRANSFERRING] });

      for (const transfer of activeTransfers) {
        try {
          await this.cancelTransfer(transfer.id);
        } catch (error) {
          logger.error('Failed to cancel transfer during shutdown', {
            transferId: transfer.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Clear concurrency slots
      this.concurrencyController.clearAllSlots();

      logger.info('Database-synced transfer queue shutdown complete');

    } catch (error) {
      logger.error('Error during queue shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
