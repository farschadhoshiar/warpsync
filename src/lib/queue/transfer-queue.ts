import { logger } from '@/lib/logger';
import { EventEmitter } from '../websocket/emitter';
import { FileStateType } from '../websocket/events';
import { RsyncManager } from '../rsync/rsync-manager';
import { RsyncCommandBuilder } from '../rsync/command-builder';
import { 
  TransferJob, 
  TransferStatus, 
  TransferPriority,
  QueueConfig, 
  QueueStats,
  RetryPolicy,
  TransferFilter,
  DEFAULT_QUEUE_CONFIG,
  DEFAULT_RETRY_POLICY
} from './types';

export class TransferQueue {
  private queue = new Map<string, TransferJob>();
  private activeTransfers = new Map<string, string>(); // transferId -> rsyncProcessId
  private config: QueueConfig;
  private retryPolicy: RetryPolicy;
  private eventEmitter?: EventEmitter;
  private rsyncManager: RsyncManager;
  private processingInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private static instance: TransferQueue;

  constructor(
    config: Partial<QueueConfig> = {},
    retryPolicy: Partial<RetryPolicy> = {},
    eventEmitter?: EventEmitter
  ) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...retryPolicy };
    this.eventEmitter = eventEmitter;
    this.rsyncManager = RsyncManager.getInstance(undefined, eventEmitter);
    
    this.startProcessing();
    this.startCleanup();
  }

  static getInstance(
    config?: Partial<QueueConfig>,
    retryPolicy?: Partial<RetryPolicy>,
    eventEmitter?: EventEmitter
  ): TransferQueue {
    if (!TransferQueue.instance) {
      TransferQueue.instance = new TransferQueue(config, retryPolicy, eventEmitter);
    }
    return TransferQueue.instance;
  }

  /**
   * Add a transfer job to the queue
   */
  async addTransfer(transfer: Omit<TransferJob, 'id' | 'createdAt' | 'status' | 'retryCount'>): Promise<string> {
    // Check queue size limit
    if (this.queue.size >= this.config.maxQueueSize) {
      throw new Error('Transfer queue is full');
    }

    const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const job: TransferJob = {
      ...transfer,
      id: transferId,
      createdAt: new Date(),
      status: TransferStatus.QUEUED,
      retryCount: 0,
      maxRetries: transfer.maxRetries || this.config.maxRetries
    };

    this.queue.set(transferId, job);

    logger.info('Transfer added to queue', {
      transferId,
      jobId: job.jobId,
      fileId: job.fileId,
      filename: job.filename,
      priority: TransferPriority[job.priority],
      size: job.size
    });

    // Emit state update
    this.emitFileStateUpdate(job, TransferStatus.QUEUED, TransferStatus.QUEUED);

    return transferId;
  }

  /**
   * Add multiple transfers as a batch
   */
  async addBatch(transfers: Array<Omit<TransferJob, 'id' | 'createdAt' | 'status' | 'retryCount'>>): Promise<string[]> {
    const transferIds: string[] = [];
    
    for (const transfer of transfers) {
      try {
        const id = await this.addTransfer(transfer);
        transferIds.push(id);
      } catch (error) {
        logger.error('Failed to add transfer to batch', {
          filename: transfer.filename,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    logger.info('Batch transfers added', {
      total: transfers.length,
      successful: transferIds.length,
      failed: transfers.length - transferIds.length
    });

    return transferIds;
  }

  /**
   * Cancel a transfer
   */
  async cancelTransfer(transferId: string): Promise<boolean> {
    const transfer = this.queue.get(transferId);
    if (!transfer) {
      return false;
    }

    // If actively transferring, cancel the rsync process
    const rsyncProcessId = this.activeTransfers.get(transferId);
    if (rsyncProcessId) {
      await this.rsyncManager.cancelTransfer(rsyncProcessId);
      this.activeTransfers.delete(transferId);
    }

    // Update transfer status
    transfer.status = TransferStatus.CANCELLED;
    transfer.completedAt = new Date();

    logger.info('Transfer cancelled', { transferId, filename: transfer.filename });

    // Emit state update
    this.emitFileStateUpdate(transfer, transfer.status, TransferStatus.CANCELLED);

    return true;
  }

  /**
   * Get transfer by ID
   */
  getTransfer(transferId: string): TransferJob | null {
    return this.queue.get(transferId) || null;
  }

  /**
   * Get transfers by filter
   */
  getTransfers(filter: TransferFilter = {}): TransferJob[] {
    let transfers = Array.from(this.queue.values());

    if (filter.status?.length) {
      transfers = transfers.filter(t => filter.status!.includes(t.status));
    }

    if (filter.priority?.length) {
      transfers = transfers.filter(t => filter.priority!.includes(t.priority));
    }

    if (filter.type?.length) {
      transfers = transfers.filter(t => filter.type!.includes(t.type));
    }

    if (filter.jobId) {
      transfers = transfers.filter(t => t.jobId === filter.jobId);
    }

    if (filter.fileId) {
      transfers = transfers.filter(t => t.fileId === filter.fileId);
    }

    if (filter.filename) {
      transfers = transfers.filter(t => t.filename.includes(filter.filename!));
    }

    if (filter.createdAfter) {
      transfers = transfers.filter(t => t.createdAt >= filter.createdAfter!);
    }

    if (filter.createdBefore) {
      transfers = transfers.filter(t => t.createdAt <= filter.createdBefore!);
    }

    return transfers;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const transfers = Array.from(this.queue.values());
    
    const stats: QueueStats = {
      total: transfers.length,
      queued: 0,
      scheduled: 0,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      totalBytesQueued: 0,
      totalBytesTransferred: 0,
      totalBytesRemaining: 0,
      estimatedTimeRemaining: 0
    };

    for (const transfer of transfers) {
      switch (transfer.status) {
        case TransferStatus.QUEUED:
          stats.queued++;
          stats.totalBytesQueued += transfer.size;
          break;
        case TransferStatus.SCHEDULED:
          stats.scheduled++;
          stats.totalBytesQueued += transfer.size;
          break;
        case TransferStatus.STARTING:
        case TransferStatus.TRANSFERRING:
          stats.active++;
          const transferred = transfer.progress?.bytesTransferred || 0;
          stats.totalBytesTransferred += transferred;
          stats.totalBytesRemaining += (transfer.size - transferred);
          break;
        case TransferStatus.COMPLETED:
          stats.completed++;
          stats.totalBytesTransferred += transfer.size;
          break;
        case TransferStatus.FAILED:
          stats.failed++;
          break;
        case TransferStatus.CANCELLED:
          stats.cancelled++;
          break;
      }
    }

    return stats;
  }

  /**
   * Start queue processing
   */
  private startProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    this.processingInterval = setInterval(() => {
      this.processQueue().catch(error => {
        logger.error('Error processing transfer queue', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }, 1000); // Check every second
  }

  /**
   * Process the queue and start pending transfers
   */
  private async processQueue(): Promise<void> {
    if (!this.config.autoStart) {
      return;
    }

    const activeCount = this.activeTransfers.size;
    if (activeCount >= this.config.maxConcurrentTransfers) {
      return;
    }

    // Get next transfer to process
    const nextTransfer = this.getNextTransfer();
    if (!nextTransfer) {
      return;
    }

    try {
      await this.startTransfer(nextTransfer);
    } catch (error) {
      logger.error('Failed to start transfer', {
        transferId: nextTransfer.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      await this.handleTransferError(nextTransfer, error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get the next transfer to process based on priority
   */
  private getNextTransfer(): TransferJob | null {
    const queuedTransfers = Array.from(this.queue.values()).filter(t => 
      t.status === TransferStatus.QUEUED || t.status === TransferStatus.SCHEDULED
    );

    if (queuedTransfers.length === 0) {
      return null;
    }

    if (this.config.priorityScheduling) {
      // Sort by priority (highest first), then by creation time (oldest first)
      queuedTransfers.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority; // Higher priority first
        }
        return a.createdAt.getTime() - b.createdAt.getTime(); // Older first
      });
    } else {
      // FIFO - first in, first out
      queuedTransfers.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }

    return queuedTransfers[0];
  }

  /**
   * Start a transfer
   */
  private async startTransfer(transfer: TransferJob): Promise<void> {
    transfer.status = TransferStatus.STARTING;
    transfer.startedAt = new Date();

    logger.info('Starting transfer', {
      transferId: transfer.id,
      filename: transfer.filename,
      size: transfer.size
    });

    // Build rsync configuration
    const rsyncConfig = RsyncCommandBuilder.createTransferConfig(
      transfer.source,
      transfer.destination,
      transfer.sshConfig!,
      transfer.rsyncOptions
    );

    // Start rsync process
    const rsyncProcessId = await this.rsyncManager.startTransfer(
      transfer.jobId,
      transfer.fileId,
      rsyncConfig
    );

    this.activeTransfers.set(transfer.id, rsyncProcessId);
    transfer.status = TransferStatus.TRANSFERRING;

    // Emit state update
    this.emitFileStateUpdate(transfer, TransferStatus.QUEUED, TransferStatus.TRANSFERRING);

    // Monitor rsync process
    this.monitorTransfer(transfer, rsyncProcessId);
  }

  /**
   * Monitor a transfer process
   */
  private async monitorTransfer(transfer: TransferJob, rsyncProcessId: string): Promise<void> {
    const checkInterval = setInterval(async () => {
      const rsyncProcess = this.rsyncManager.getTransferStatus(rsyncProcessId);
      
      if (!rsyncProcess) {
        clearInterval(checkInterval);
        return;
      }

      // Update progress
      if (rsyncProcess.progress) {
        transfer.progress = {
          bytesTransferred: rsyncProcess.progress.bytesTransferred,
          totalBytes: rsyncProcess.progress.totalBytes,
          percentage: rsyncProcess.progress.percentage,
          speed: rsyncProcess.progress.speed,
          eta: rsyncProcess.progress.eta,
          startTime: transfer.startedAt!,
          lastUpdate: new Date()
        };
      }

      // Check if completed
      if (rsyncProcess.result) {
        clearInterval(checkInterval);
        this.activeTransfers.delete(transfer.id);
        
        if (rsyncProcess.result.success) {
          await this.handleTransferSuccess(transfer);
        } else {
          await this.handleTransferError(transfer, new Error(rsyncProcess.result.error || 'Transfer failed'));
        }
      }
    }, 1000);
  }

  /**
   * Handle successful transfer
   */
  private async handleTransferSuccess(transfer: TransferJob): Promise<void> {
    transfer.status = TransferStatus.COMPLETED;
    transfer.completedAt = new Date();

    logger.info('Transfer completed successfully', {
      transferId: transfer.id,
      filename: transfer.filename,
      duration: transfer.completedAt.getTime() - transfer.startedAt!.getTime()
    });

    // Emit state update
    this.emitFileStateUpdate(transfer, TransferStatus.TRANSFERRING, TransferStatus.COMPLETED);
  }

  /**
   * Handle transfer error with retry logic
   */
  private async handleTransferError(transfer: TransferJob, error: Error): Promise<void> {
    transfer.error = error.message;
    
    // Check if should retry
    if (transfer.retryCount < transfer.maxRetries && this.shouldRetry(error)) {
      transfer.retryCount++;
      transfer.status = TransferStatus.RETRYING;
      
      // Calculate retry delay with exponential backoff
      const delay = Math.min(
        this.retryPolicy.baseDelay * Math.pow(this.retryPolicy.backoffMultiplier, transfer.retryCount - 1),
        this.retryPolicy.maxDelay
      );

      logger.warn('Transfer failed, scheduling retry', {
        transferId: transfer.id,
        filename: transfer.filename,
        retryCount: transfer.retryCount,
        maxRetries: transfer.maxRetries,
        delay,
        error: error.message
      });

      // Schedule retry
      setTimeout(() => {
        if (transfer.status === TransferStatus.RETRYING) {
          transfer.status = TransferStatus.QUEUED;
        }
      }, delay);
    } else {
      transfer.status = TransferStatus.FAILED;
      transfer.completedAt = new Date();

      logger.error('Transfer failed permanently', {
        transferId: transfer.id,
        filename: transfer.filename,
        retryCount: transfer.retryCount,
        error: error.message
      });

      // Emit state update
      this.emitFileStateUpdate(transfer, TransferStatus.TRANSFERRING, TransferStatus.FAILED);
    }
  }

  /**
   * Check if error is retryable
   */
  private shouldRetry(error: Error): boolean {
    return this.retryPolicy.retryableErrors.some(retryableError =>
      error.message.toLowerCase().includes(retryableError.toLowerCase())
    );
  }

  /**
   * Map transfer status to file state
   */
  private mapTransferStatusToFileState(status: TransferStatus): FileStateType {
    switch (status) {
      case TransferStatus.QUEUED:
      case TransferStatus.SCHEDULED:
        return 'queued';
      case TransferStatus.STARTING:
      case TransferStatus.TRANSFERRING:
        return 'transferring';
      case TransferStatus.COMPLETED:
        return 'synced';
      case TransferStatus.FAILED:
      case TransferStatus.CANCELLED:
        return 'failed';
      case TransferStatus.RETRYING:
        return 'queued';
      default:
        return 'failed';
    }
  }

  /**
   * Emit file state update
   */
  private emitFileStateUpdate(transfer: TransferJob, oldState: TransferStatus, newState: TransferStatus): void {
    this.eventEmitter?.emitFileStateUpdate({
      jobId: transfer.jobId,
      fileId: transfer.fileId,
      filename: transfer.filename,
      relativePath: transfer.relativePath,
      oldState: this.mapTransferStatusToFileState(oldState),
      newState: this.mapTransferStatusToFileState(newState),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Start cleanup interval
   */
  private startCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupCompletedTransfers();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up completed transfers
   */
  private cleanupCompletedTransfers(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    let cleanedCount = 0;

    for (const [id, transfer] of this.queue) {
      if (transfer.completedAt && 
          transfer.completedAt.getTime() < cutoff &&
          (transfer.status === TransferStatus.COMPLETED || 
           transfer.status === TransferStatus.FAILED ||
           transfer.status === TransferStatus.CANCELLED)) {
        this.queue.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cleaned up completed transfers', { count: cleanedCount });
    }
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Cancel all active transfers
    for (const [transferId] of this.activeTransfers) {
      await this.cancelTransfer(transferId);
    }
  }
}
