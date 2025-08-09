import { FileState } from "../../models/FileState";
import { SyncJob } from "../../models/SyncJob";
import { TransferStateManager } from "./transfer-state-manager";
import { JobConcurrencyController } from "./job-concurrency-controller";
import { logger } from "../logger";

export interface RecoveryStats {
  totalFiles: number;
  stuckTransfers: number;
  orphanedTransfers: number;
  recoveredFiles: number;
  failedRecoveries: number;
  releasedSlots: number;
}

export interface StuckTransferInfo {
  fileId: string;
  transferId: string;
  state: string;
  lastStateChange: Date;
  jobId: string;
  stuckDuration: number;
}

export class StateRecoveryService {
  private static instance: StateRecoveryService;
  private transferStateManager: TransferStateManager;
  private concurrencyController: JobConcurrencyController;

  constructor() {
    this.transferStateManager = TransferStateManager.getInstance();
    this.concurrencyController = JobConcurrencyController.getInstance();
  }

  public static getInstance(): StateRecoveryService {
    if (!StateRecoveryService.instance) {
      StateRecoveryService.instance = new StateRecoveryService();
    }
    return StateRecoveryService.instance;
  }

  /**
   * Perform complete system recovery on startup
   */
  async performSystemRecovery(): Promise<RecoveryStats> {
    logger.info("Starting system recovery...");

    const stats: RecoveryStats = {
      totalFiles: 0,
      stuckTransfers: 0,
      orphanedTransfers: 0,
      recoveredFiles: 0,
      failedRecoveries: 0,
      releasedSlots: 0,
    };

    try {
      // Get all files that might need recovery
      const potentialRecoveryFiles = await FileState.find({
        $or: [
          { syncState: { $in: ["transferring", "queued"] } },
          { activeTransferId: { $exists: true, $ne: null } },
          { jobConcurrencySlot: { $exists: true, $ne: null } },
        ],
      });

      stats.totalFiles = potentialRecoveryFiles.length;

      if (stats.totalFiles === 0) {
        logger.info("No files require recovery");
        return stats;
      }

      logger.info(`Found ${stats.totalFiles} files that may require recovery`);

      // Step 1: Detect stuck transfers
      const stuckTransfers = await this.detectStuckTransfers();
      stats.stuckTransfers = stuckTransfers.length;

      // Step 2: Detect orphaned transfers
      const orphanedTransfers = await this.detectOrphanedTransfers();
      stats.orphanedTransfers = orphanedTransfers.length;

      // Step 3: Recover stuck transfers
      for (const stuckTransfer of stuckTransfers) {
        const recovered = await this.recoverStuckTransfer(stuckTransfer);
        if (recovered) {
          stats.recoveredFiles++;
        } else {
          stats.failedRecoveries++;
        }
      }

      // Step 4: Clean up orphaned transfers
      for (const orphanedTransfer of orphanedTransfers) {
        const recovered = await this.cleanupOrphanedTransfer(orphanedTransfer);
        if (recovered) {
          stats.recoveredFiles++;
        } else {
          stats.failedRecoveries++;
        }
      }

      // Step 5: Validate and fix concurrency slots
      stats.releasedSlots = await this.validateConcurrencySlots();

      logger.info("System recovery completed", stats);
      return stats;
    } catch (error) {
      logger.error("System recovery failed:", error);
      throw error;
    }
  }

  /**
   * Detect transfers that have been stuck in a state for too long
   */
  async detectStuckTransfers(
    stuckThresholdMinutes: number = 30,
  ): Promise<StuckTransferInfo[]> {
    try {
      const stuckThreshold = new Date(
        Date.now() - stuckThresholdMinutes * 60 * 1000,
      );

      const stuckFiles = await FileState.find({
        syncState: { $in: ["transferring", "queued"] },
        $or: [
          { lastStateChange: { $lt: stuckThreshold } },
          {
            lastStateChange: { $exists: false },
            updatedAt: { $lt: stuckThreshold },
          },
        ],
      });

      return stuckFiles.map((file) => ({
        fileId: file._id.toString(),
        transferId: file.activeTransferId || "unknown",
        state: file.syncState,
        lastStateChange: file.lastStateChange || file.updatedAt,
        jobId: file.jobId.toString(),
        stuckDuration:
          Date.now() - (file.lastStateChange || file.updatedAt).getTime(),
      }));
    } catch (error) {
      logger.error("Failed to detect stuck transfers:", error);
      return [];
    }
  }

  /**
   * Detect transfers that have transfer IDs but no corresponding active process
   */
  async detectOrphanedTransfers(): Promise<StuckTransferInfo[]> {
    try {
      const orphanedFiles = await FileState.find({
        activeTransferId: { $exists: true, $ne: null },
        syncState: { $nin: ["completed", "failed", "cancelled"] },
      });

      // For now, we'll consider all files with transfer IDs as potentially orphaned
      // In a real implementation, you'd check against active transfer processes
      return orphanedFiles.map((file) => ({
        fileId: file._id.toString(),
        transferId: file.activeTransferId!,
        state: file.syncState,
        lastStateChange: file.lastStateChange || file.updatedAt,
        jobId: file.jobId.toString(),
        stuckDuration:
          Date.now() - (file.lastStateChange || file.updatedAt).getTime(),
      }));
    } catch (error) {
      logger.error("Failed to detect orphaned transfers:", error);
      return [];
    }
  }

  /**
   * Recover a stuck transfer
   */
  async recoverStuckTransfer(
    stuckTransfer: StuckTransferInfo,
  ): Promise<boolean> {
    try {
      logger.info(
        `Recovering stuck transfer: ${stuckTransfer.fileId}`,
        stuckTransfer,
      );

      // Release concurrency slot if assigned
      await this.concurrencyController.releaseSlot(
        stuckTransfer.jobId,
        stuckTransfer.fileId,
        "Recovery: stuck transfer cleanup",
      );

      // Reset transfer state to failed with recovery metadata
      const success = await this.transferStateManager.transitionState(
        stuckTransfer.fileId,
        "failed",
        {
          transferId: stuckTransfer.transferId,
          metadata: {
            recoveryReason: "stuck_transfer",
            originalState: stuckTransfer.state,
            stuckDuration: stuckTransfer.stuckDuration,
            recoveredAt: new Date().toISOString(),
          },
          reason: `Recovery: stuck transfer (was ${stuckTransfer.state} for ${Math.round(stuckTransfer.stuckDuration / 60000)} minutes)`,
          force: true,
        },
      );

      if (success) {
        logger.info(
          `Successfully recovered stuck transfer: ${stuckTransfer.fileId}`,
        );
      } else {
        logger.error(
          `Failed to recover stuck transfer: ${stuckTransfer.fileId}`,
        );
      }

      return success;
    } catch (error) {
      logger.error(
        `Failed to recover stuck transfer ${stuckTransfer.fileId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Clean up an orphaned transfer
   */
  async cleanupOrphanedTransfer(
    orphanedTransfer: StuckTransferInfo,
  ): Promise<boolean> {
    try {
      logger.info(
        `Cleaning up orphaned transfer: ${orphanedTransfer.fileId}`,
        orphanedTransfer,
      );

      // Release concurrency slot if assigned
      await this.concurrencyController.releaseSlot(
        orphanedTransfer.jobId,
        orphanedTransfer.fileId,
        "Recovery: orphaned transfer cleanup",
      );

      // Reset transfer state to idle
      const success = await this.transferStateManager.transitionState(
        orphanedTransfer.fileId,
        "idle",
        {
          metadata: {
            recoveryReason: "orphaned_transfer",
            originalState: orphanedTransfer.state,
            originalTransferId: orphanedTransfer.transferId,
            recoveredAt: new Date().toISOString(),
          },
          reason: `Recovery: orphaned transfer cleanup`,
          force: true,
        },
      );

      if (success) {
        logger.info(
          `Successfully cleaned up orphaned transfer: ${orphanedTransfer.fileId}`,
        );
      } else {
        logger.error(
          `Failed to clean up orphaned transfer: ${orphanedTransfer.fileId}`,
        );
      }

      return success;
    } catch (error) {
      logger.error(
        `Failed to cleanup orphaned transfer ${orphanedTransfer.fileId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Validate and fix concurrency slot assignments
   */
  async validateConcurrencySlots(): Promise<number> {
    try {
      let releasedSlots = 0;

      // Find files with concurrency slots but no active transfer
      const invalidSlotFiles = await FileState.find({
        jobConcurrencySlot: { $exists: true, $ne: null },
        $or: [
          { activeTransferId: { $exists: false } },
          { activeTransferId: null },
          { syncState: { $in: ["completed", "failed", "cancelled", "idle"] } },
        ],
      });

      for (const file of invalidSlotFiles) {
        logger.info(`Releasing invalid concurrency slot for file: ${file._id}`);

        const success = await file.releaseConcurrencySlot(
          "Recovery: invalid slot assignment",
        );
        if (success) {
          releasedSlots++;
        }
      }

      // Validate slot assignments per job don't exceed limits
      const jobs = await SyncJob.find({});
      for (const job of jobs) {
        const concurrencyInfo =
          await this.concurrencyController.getJobConcurrencyInfo(
            job._id.toString(),
          );
        if (
          concurrencyInfo &&
          concurrencyInfo.usedSlots > concurrencyInfo.maxSlots
        ) {
          logger.warn(
            `Job ${job._id} has too many slots assigned: ${concurrencyInfo.usedSlots}/${concurrencyInfo.maxSlots}`,
          );

          // Force release excess slots
          const excessSlots =
            concurrencyInfo.usedSlots - concurrencyInfo.maxSlots;
          const activeTransfers = concurrencyInfo.activeTransfers
            .sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime())
            .slice(-excessSlots);

          for (const transfer of activeTransfers) {
            const success = await this.concurrencyController.releaseSlot(
              job._id.toString(),
              transfer.fileId,
              "Recovery: excess slot cleanup",
            );
            if (success) {
              releasedSlots++;
            }
          }
        }
      }

      logger.info(`Released ${releasedSlots} invalid concurrency slots`);
      return releasedSlots;
    } catch (error) {
      logger.error("Failed to validate concurrency slots:", error);
      return 0;
    }
  }

  /**
   * Validate state consistency across the system
   */
  async validateStateConsistency(): Promise<{
    consistent: boolean;
    issues: string[];
    stats: any;
  }> {
    const issues: string[] = [];
    const stats = {
      totalFiles: 0,
      activeTransfers: 0,
      assignedSlots: 0,
      stateHistoryEntries: 0,
    };

    try {
      // Count total files
      stats.totalFiles = await FileState.countDocuments({});

      // Count active transfers
      stats.activeTransfers = await FileState.countDocuments({
        syncState: { $in: ["transferring", "queued"] },
      });

      // Count assigned slots
      stats.assignedSlots = await FileState.countDocuments({
        jobConcurrencySlot: { $exists: true, $ne: null },
      });

      // Check for inconsistencies
      const filesWithTransferIdButNoState = await FileState.countDocuments({
        activeTransferId: { $exists: true, $ne: null },
        syncState: { $nin: ["transferring", "queued"] },
      });

      if (filesWithTransferIdButNoState > 0) {
        issues.push(
          `${filesWithTransferIdButNoState} files have transfer IDs but inactive states`,
        );
      }

      const filesWithSlotButNoTransfer = await FileState.countDocuments({
        jobConcurrencySlot: { $exists: true, $ne: null },
        $or: [
          { activeTransferId: { $exists: false } },
          { activeTransferId: null },
        ],
      });

      if (filesWithSlotButNoTransfer > 0) {
        issues.push(
          `${filesWithSlotButNoTransfer} files have concurrency slots but no active transfer`,
        );
      }

      const consistent = issues.length === 0;

      return { consistent, issues, stats };
    } catch (error) {
      logger.error("Failed to validate state consistency:", error);
      return {
        consistent: false,
        issues: ["Failed to perform consistency check"],
        stats,
      };
    }
  }

  /**
   * Emergency reset - clear all transfer states
   */
  async emergencyReset(): Promise<RecoveryStats> {
    logger.warn("Performing emergency reset of all transfer states");

    const stats: RecoveryStats = {
      totalFiles: 0,
      stuckTransfers: 0,
      orphanedTransfers: 0,
      recoveredFiles: 0,
      failedRecoveries: 0,
      releasedSlots: 0,
    };

    try {
      // Reset all files to idle state
      const result = await FileState.updateMany(
        {},
        {
          $unset: {
            activeTransferId: 1,
            jobConcurrencySlot: 1,
          },
          $set: {
            syncState: "idle",
            lastStateChange: new Date(),
          },
          $push: {
            stateHistory: {
              fromState: "unknown",
              toState: "idle",
              timestamp: new Date(),
              reason: "Emergency reset",
              metadata: { emergencyReset: true },
            },
          },
        },
      );

      stats.totalFiles = result.matchedCount || 0;
      stats.recoveredFiles = result.modifiedCount || 0;
      stats.releasedSlots = result.modifiedCount || 0;

      // Clear all caches
      this.concurrencyController.clearAllCache();

      logger.info("Emergency reset completed", stats);
      return stats;
    } catch (error) {
      logger.error("Emergency reset failed:", error);
      throw error;
    }
  }
}

export default StateRecoveryService;
