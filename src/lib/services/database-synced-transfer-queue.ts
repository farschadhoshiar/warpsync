import {
  TransferQueue,
  TransferQueueItem,
  QueuePriority,
} from "../queue/transfer-queue";
import { FileState } from "../../models/FileState";
import { TransferStateManager } from "./transfer-state-manager";
import { JobConcurrencyController } from "./job-concurrency-controller";
import { StateRecoveryService } from "./state-recovery-service";
import { logger } from "../logger";

export interface DatabaseSyncedQueueItem extends TransferQueueItem {
  fileId: string;
  jobId: string;
  slotId?: number;
  queuedAt: Date;
  lastSyncAt?: Date;
}

export interface QueueSyncStats {
  totalQueued: number;
  databaseSynced: number;
  memoryOnly: number;
  failedSync: number;
  lastSyncAt: Date;
}

export class DatabaseSyncedTransferQueue extends TransferQueue {
  private static instance: DatabaseSyncedTransferQueue;
  private transferStateManager: TransferStateManager;
  private concurrencyController: JobConcurrencyController;
  private recoveryService: StateRecoveryService;
  private syncInterval: NodeJS.Timeout | null = null;
  private syncInProgress: boolean = false;

  constructor() {
    super();
    this.transferStateManager = TransferStateManager.getInstance();
    this.concurrencyController = JobConcurrencyController.getInstance();
    this.recoveryService = StateRecoveryService.getInstance();

    // Start periodic sync
    this.startPeriodicSync();
  }

  public static getInstance(): DatabaseSyncedTransferQueue {
    if (!DatabaseSyncedTransferQueue.instance) {
      DatabaseSyncedTransferQueue.instance = new DatabaseSyncedTransferQueue();
    }
    return DatabaseSyncedTransferQueue.instance;
  }

  /**
   * Enhanced enqueue with database synchronization and concurrency checking
   */
  async enqueue(item: TransferQueueItem): Promise<boolean> {
    try {
      const fileId = this.extractFileId(item);
      const jobId = this.extractJobId(item);

      if (!fileId || !jobId) {
        logger.error("Invalid queue item: missing fileId or jobId", item);
        return false;
      }

      // Check if transfer can be queued (concurrency limits)
      const canQueue = await this.concurrencyController.canQueueTransfer(jobId);
      if (!canQueue) {
        logger.info(
          `Cannot queue transfer for job ${jobId}: no available slots`,
        );
        return false;
      }

      // Check if file is already queued or transferring
      const currentState =
        await this.transferStateManager.getTransferState(fileId);
      if (
        currentState &&
        ["queued", "transferring"].includes(currentState.currentState)
      ) {
        logger.info(
          `File ${fileId} is already in state: ${currentState.currentState}`,
        );
        return false;
      }

      // Create enhanced queue item
      const enhancedItem: DatabaseSyncedQueueItem = {
        ...item,
        fileId,
        jobId,
        queuedAt: new Date(),
        id: item.id || `${fileId}-${Date.now()}`,
      };

      // Transition file state to queued
      const stateTransitioned = await this.transferStateManager.transitionState(
        fileId,
        "queued",
        {
          transferId: enhancedItem.id,
          metadata: {
            priority: item.priority,
            queuedAt: enhancedItem.queuedAt.toISOString(),
            source: "database-synced-queue",
          },
          reason: "Queued for transfer",
        },
      );

      if (!stateTransitioned) {
        logger.error(`Failed to transition state to queued for file ${fileId}`);
        return false;
      }

      // Add to in-memory queue
      const queued = super.enqueue(enhancedItem);
      if (!queued) {
        // Rollback state change
        await this.transferStateManager.transitionState(fileId, "idle", {
          reason: "Failed to enqueue in memory queue",
        });
        return false;
      }

      logger.info(`Successfully queued transfer: ${fileId}`, {
        transferId: enhancedItem.id,
        jobId,
        priority: item.priority,
      });

      return true;
    } catch (error) {
      logger.error("Failed to enqueue transfer:", error);
      return false;
    }
  }

  /**
   * Enhanced dequeue with concurrency slot assignment
   */
  async dequeue(): Promise<DatabaseSyncedQueueItem | null> {
    try {
      const item = super.dequeue() as DatabaseSyncedQueueItem;
      if (!item) {
        return null;
      }

      // Assign concurrency slot
      const slotId = await this.concurrencyController.assignSlot(
        item.jobId,
        item.fileId,
        item.id,
      );

      if (slotId === null) {
        // No available slots, put item back in queue
        super.enqueue(item);
        logger.debug(
          `No available slots for job ${item.jobId}, re-queuing item`,
        );
        return null;
      }

      // Update item with slot information
      item.slotId = slotId;

      // Transition state to transferring
      const stateTransitioned = await this.transferStateManager.transitionState(
        item.fileId,
        "transferring",
        {
          transferId: item.id,
          metadata: {
            slotId,
            startedAt: new Date().toISOString(),
            priority: item.priority,
          },
          reason: "Transfer started",
        },
      );

      if (!stateTransitioned) {
        // Release slot and put item back
        await this.concurrencyController.releaseSlot(
          item.jobId,
          item.fileId,
          "Failed to transition to transferring",
        );
        super.enqueue(item);
        logger.error(
          `Failed to transition state to transferring for file ${item.fileId}`,
        );
        return null;
      }

      logger.info(`Dequeued transfer with slot assignment: ${item.fileId}`, {
        transferId: item.id,
        slotId,
        jobId: item.jobId,
      });

      return item;
    } catch (error) {
      logger.error("Failed to dequeue transfer:", error);
      return null;
    }
  }

  /**
   * Complete a transfer (success)
   */
  async completeTransfer(
    transferId: string,
    fileId: string,
    jobId: string,
    metadata?: Record<string, any>,
  ): Promise<boolean> {
    try {
      // Release concurrency slot
      await this.concurrencyController.releaseSlot(
        jobId,
        fileId,
        "Transfer completed successfully",
      );

      // Transition state to completed
      const success = await this.transferStateManager.transitionState(
        fileId,
        "completed",
        {
          transferId,
          metadata: {
            ...metadata,
            completedAt: new Date().toISOString(),
          },
          reason: "Transfer completed successfully",
        },
      );

      if (success) {
        logger.info(`Transfer completed successfully: ${fileId}`, {
          transferId,
          jobId,
        });
      }

      return success;
    } catch (error) {
      logger.error(`Failed to complete transfer ${transferId}:`, error);
      return false;
    }
  }

  /**
   * Fail a transfer
   */
  async failTransfer(
    transferId: string,
    fileId: string,
    jobId: string,
    error: string,
    metadata?: Record<string, any>,
  ): Promise<boolean> {
    try {
      // Release concurrency slot
      await this.concurrencyController.releaseSlot(
        jobId,
        fileId,
        `Transfer failed: ${error}`,
      );

      // Transition state to failed
      const success = await this.transferStateManager.markTransferFailed(
        fileId,
        error,
        transferId,
      );

      if (success) {
        logger.info(`Transfer failed: ${fileId}`, { transferId, jobId, error });
      }

      return success;
    } catch (error) {
      logger.error(`Failed to mark transfer as failed ${transferId}:`, error);
      return false;
    }
  }

  /**
   * Cancel a transfer
   */
  async cancelTransfer(
    transferId: string,
    fileId: string,
    jobId: string,
    reason?: string,
  ): Promise<boolean> {
    try {
      // Remove from in-memory queue if still queued
      this.removeById(transferId);

      // Release concurrency slot
      await this.concurrencyController.releaseSlot(
        jobId,
        fileId,
        `Transfer cancelled: ${reason || "User request"}`,
      );

      // Transition state to cancelled
      const success = await this.transferStateManager.transitionState(
        fileId,
        "cancelled",
        {
          transferId,
          metadata: {
            cancelledAt: new Date().toISOString(),
            reason: reason || "User request",
          },
          reason: `Transfer cancelled: ${reason || "User request"}`,
        },
      );

      if (success) {
        logger.info(`Transfer cancelled: ${fileId}`, {
          transferId,
          jobId,
          reason,
        });
      }

      return success;
    } catch (error) {
      logger.error(`Failed to cancel transfer ${transferId}:`, error);
      return false;
    }
  }

  /**
   * Synchronize in-memory queue with database state
   */
  async syncWithDatabase(): Promise<QueueSyncStats> {
    if (this.syncInProgress) {
      logger.debug("Sync already in progress, skipping");
      return this.getLastSyncStats();
    }

    this.syncInProgress = true;
    const stats: QueueSyncStats = {
      totalQueued: 0,
      databaseSynced: 0,
      memoryOnly: 0,
      failedSync: 0,
      lastSyncAt: new Date(),
    };

    try {
      // Get queued files from database
      const queuedFiles = await FileState.find({
        syncState: "queued",
        activeTransferId: { $exists: true, $ne: null },
      });

      stats.totalQueued = queuedFiles.length;

      // Get current in-memory queue items
      const memoryItems = this.getAllItems() as DatabaseSyncedQueueItem[];
      const memoryTransferIds = new Set(memoryItems.map((item) => item.id));

      // Add database items missing from memory
      for (const file of queuedFiles) {
        if (!memoryTransferIds.has(file.activeTransferId!)) {
          try {
            const queueItem: DatabaseSyncedQueueItem = {
              id: file.activeTransferId!,
              fileId: file._id.toString(),
              jobId: file.jobId.toString(),
              priority: "NORMAL" as QueuePriority,
              queuedAt: file.lastStateChange || file.updatedAt,
              lastSyncAt: new Date(),
            };

            super.enqueue(queueItem);
            stats.databaseSynced++;
          } catch (error) {
            logger.error(
              `Failed to sync queued file ${file._id} to memory:`,
              error,
            );
            stats.failedSync++;
          }
        }
      }

      // Remove memory items not in database
      const databaseTransferIds = new Set(
        queuedFiles.map((file) => file.activeTransferId!),
      );
      for (const memoryItem of memoryItems) {
        if (!databaseTransferIds.has(memoryItem.id)) {
          this.removeById(memoryItem.id);
          stats.memoryOnly++;
        }
      }

      logger.info("Queue synchronization completed", stats);
      return stats;
    } catch (error) {
      logger.error("Failed to sync queue with database:", error);
      stats.failedSync++;
      return stats;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Initialize queue from database on startup
   */
  async initializeFromDatabase(): Promise<void> {
    try {
      logger.info("Initializing queue from database...");

      // Perform recovery first
      const recoveryStats = await this.recoveryService.performSystemRecovery();
      logger.info(
        "Recovery completed before queue initialization",
        recoveryStats,
      );

      // Sync queue state
      const syncStats = await this.syncWithDatabase();
      logger.info("Queue initialized from database", syncStats);
    } catch (error) {
      logger.error("Failed to initialize queue from database:", error);
      throw error;
    }
  }

  /**
   * Start periodic synchronization with database
   */
  private startPeriodicSync(intervalMs: number = 60000): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      try {
        await this.syncWithDatabase();
      } catch (error) {
        logger.error("Periodic sync failed:", error);
      }
    }, intervalMs);

    logger.info(`Started periodic queue sync with ${intervalMs}ms interval`);
  }

  /**
   * Stop periodic synchronization
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info("Stopped periodic queue sync");
    }
  }

  /**
   * Extract file ID from queue item
   */
  private extractFileId(item: any): string | null {
    return item.fileId || item.file?.id || item.file?._id || null;
  }

  /**
   * Extract job ID from queue item
   */
  private extractJobId(item: any): string | null {
    return item.jobId || item.job?.id || item.job?._id || null;
  }

  /**
   * Remove item from queue by ID
   */
  private removeById(id: string): boolean {
    const items = this.getAllItems();
    const index = items.findIndex((item) => item.id === id);
    if (index !== -1) {
      items.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get last sync statistics (placeholder - would store in instance variable)
   */
  private getLastSyncStats(): QueueSyncStats {
    return {
      totalQueued: 0,
      databaseSynced: 0,
      memoryOnly: 0,
      failedSync: 0,
      lastSyncAt: new Date(),
    };
  }

  /**
   * Get all items from queue (protected method in parent)
   */
  private getAllItems(): TransferQueueItem[] {
    // This would need to be implemented based on the parent TransferQueue structure
    // For now, returning empty array as placeholder
    return [];
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    this.stopPeriodicSync();
    logger.info("DatabaseSyncedTransferQueue shutdown completed");
  }
}

export default DatabaseSyncedTransferQueue;
