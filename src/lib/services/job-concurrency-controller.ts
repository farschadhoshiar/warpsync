import { SyncJob } from "../../models/SyncJob";
import { FileState } from "../../models/FileState";
import { logger } from "../logger";

export interface ConcurrencySlot {
  slotId: number;
  fileId: string;
  transferId: string;
  assignedAt: Date;
  jobId: string;
}

export interface JobConcurrencyInfo {
  jobId: string;
  maxSlots: number;
  usedSlots: number;
  availableSlots: number;
  activeTransfers: ConcurrencySlot[];
}

export class JobConcurrencyController {
  private static instance: JobConcurrencyController;
  private jobSlotCache: Map<string, Set<number>> = new Map();

  public static getInstance(): JobConcurrencyController {
    if (!JobConcurrencyController.instance) {
      JobConcurrencyController.instance = new JobConcurrencyController();
    }
    return JobConcurrencyController.instance;
  }

  /**
   * Assign a concurrency slot for a transfer
   */
  async assignSlot(
    jobId: string,
    fileId: string,
    transferId: string,
  ): Promise<number | null> {
    try {
      // Get job configuration
      const job = await SyncJob.findById(jobId);
      if (!job) {
        logger.error(`Job not found: ${jobId}`);
        return null;
      }

      const maxConcurrentTransfers = job.maxConcurrentTransfers || 3;

      // Get currently used slots for this job
      const usedSlots = await this.getUsedSlots(jobId);

      if (usedSlots.size >= maxConcurrentTransfers) {
        logger.info(
          `No available slots for job ${jobId}. Used: ${usedSlots.size}/${maxConcurrentTransfers}`,
        );
        return null;
      }

      // Find available slot number
      const availableSlot = this.findAvailableSlot(
        usedSlots,
        maxConcurrentTransfers,
      );
      if (availableSlot === null) {
        return null;
      }

      // Assign slot to file atomically
      const fileState = await FileState.findById(fileId);
      if (!fileState) {
        logger.error(`File not found: ${fileId}`);
        return null;
      }

      const success = await fileState.assignConcurrencySlot(
        availableSlot,
        transferId,
      );
      if (!success) {
        logger.warn(`Failed to assign slot ${availableSlot} to file ${fileId}`);
        return null;
      }

      // Update cache
      this.updateSlotCache(jobId, availableSlot, true);

      logger.info(
        `Assigned slot ${availableSlot} to file ${fileId} for job ${jobId}`,
        {
          transferId,
          usedSlots: usedSlots.size + 1,
          maxSlots: maxConcurrentTransfers,
        },
      );

      return availableSlot;
    } catch (error) {
      logger.error(
        `Failed to assign slot for job ${jobId}, file ${fileId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Release a concurrency slot
   */
  async releaseSlot(
    jobId: string,
    fileId: string,
    reason?: string,
  ): Promise<boolean> {
    try {
      const fileState = await FileState.findById(fileId);
      if (!fileState) {
        logger.error(`File not found: ${fileId}`);
        return false;
      }

      const slotId = fileState.jobConcurrencySlot;
      if (slotId === null || slotId === undefined) {
        logger.warn(`No slot assigned to file ${fileId}`);
        return true; // Already released
      }

      // Release slot from file
      const success = await fileState.releaseConcurrencySlot(reason);
      if (!success) {
        logger.warn(`Failed to release slot from file ${fileId}`);
        return false;
      }

      // Update cache
      this.updateSlotCache(jobId, slotId, false);

      logger.info(
        `Released slot ${slotId} from file ${fileId} for job ${jobId}`,
        {
          reason: reason || "Transfer completed",
        },
      );

      return true;
    } catch (error) {
      logger.error(
        `Failed to release slot for job ${jobId}, file ${fileId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Get available slots for a job
   */
  async getAvailableSlots(jobId: string): Promise<number> {
    try {
      const job = await SyncJob.findById(jobId);
      if (!job) {
        return 0;
      }

      const maxConcurrentTransfers = job.maxConcurrentTransfers || 3;
      const usedSlots = await this.getUsedSlots(jobId);

      return Math.max(0, maxConcurrentTransfers - usedSlots.size);
    } catch (error) {
      logger.error(`Failed to get available slots for job ${jobId}:`, error);
      return 0;
    }
  }

  /**
   * Get concurrency information for a job
   */
  async getJobConcurrencyInfo(
    jobId: string,
  ): Promise<JobConcurrencyInfo | null> {
    try {
      const job = await SyncJob.findById(jobId);
      if (!job) {
        return null;
      }

      const maxSlots = job.maxConcurrentTransfers || 3;
      const activeTransfers = await this.getActiveTransfers(jobId);
      const usedSlots = activeTransfers.length;

      return {
        jobId,
        maxSlots,
        usedSlots,
        availableSlots: Math.max(0, maxSlots - usedSlots),
        activeTransfers,
      };
    } catch (error) {
      logger.error(`Failed to get concurrency info for job ${jobId}:`, error);
      return null;
    }
  }

  /**
   * Get active transfers for a job
   */
  async getActiveTransfers(jobId: string): Promise<ConcurrencySlot[]> {
    try {
      const activeFiles = await FileState.find({
        jobId,
        jobConcurrencySlot: { $exists: true, $ne: null },
        activeTransferId: { $exists: true, $ne: null },
        syncState: { $in: ["queued", "transferring"] },
      });

      return activeFiles.map((file) => ({
        slotId: file.jobConcurrencySlot!,
        fileId: file._id.toString(),
        transferId: file.activeTransferId!,
        assignedAt: file.lastStateChange || file.updatedAt,
        jobId,
      }));
    } catch (error) {
      logger.error(`Failed to get active transfers for job ${jobId}:`, error);
      return [];
    }
  }

  /**
   * Check if a file can be queued (has available slot)
   */
  async canQueueTransfer(jobId: string): Promise<boolean> {
    const availableSlots = await this.getAvailableSlots(jobId);
    return availableSlots > 0;
  }

  /**
   * Force release all slots for a job (emergency cleanup)
   */
  async forceReleaseAllSlots(jobId: string, reason?: string): Promise<number> {
    try {
      const result = await FileState.updateMany(
        {
          jobId,
          jobConcurrencySlot: { $exists: true, $ne: null },
        },
        {
          $unset: {
            jobConcurrencySlot: 1,
            activeTransferId: 1,
          },
          $push: {
            stateHistory: {
              fromState: "transferring",
              toState: "failed",
              timestamp: new Date(),
              reason: reason || "Force released all slots",
              metadata: { forceReleased: true },
            },
          },
          $set: {
            syncState: "failed",
            lastStateChange: new Date(),
          },
        },
      );

      // Clear cache
      this.jobSlotCache.delete(jobId);

      logger.info(
        `Force released ${result.modifiedCount} slots for job ${jobId}`,
        {
          reason: reason || "Emergency cleanup",
        },
      );

      return result.modifiedCount || 0;
    } catch (error) {
      logger.error(`Failed to force release slots for job ${jobId}:`, error);
      return 0;
    }
  }

  /**
   * Get used slots for a job from database
   */
  private async getUsedSlots(jobId: string): Promise<Set<number>> {
    try {
      const filesWithSlots = await FileState.find(
        {
          jobId,
          jobConcurrencySlot: { $exists: true, $ne: null },
        },
        "jobConcurrencySlot",
      );

      const usedSlots = new Set<number>();
      filesWithSlots.forEach((file) => {
        if (
          file.jobConcurrencySlot !== null &&
          file.jobConcurrencySlot !== undefined
        ) {
          usedSlots.add(file.jobConcurrencySlot);
        }
      });

      // Update cache
      this.jobSlotCache.set(jobId, usedSlots);

      return usedSlots;
    } catch (error) {
      logger.error(`Failed to get used slots for job ${jobId}:`, error);
      return new Set();
    }
  }

  /**
   * Find an available slot number
   */
  private findAvailableSlot(
    usedSlots: Set<number>,
    maxSlots: number,
  ): number | null {
    for (let slot = 1; slot <= maxSlots; slot++) {
      if (!usedSlots.has(slot)) {
        return slot;
      }
    }
    return null;
  }

  /**
   * Update slot cache
   */
  private updateSlotCache(
    jobId: string,
    slotId: number,
    assign: boolean,
  ): void {
    let slots = this.jobSlotCache.get(jobId);
    if (!slots) {
      slots = new Set();
      this.jobSlotCache.set(jobId, slots);
    }

    if (assign) {
      slots.add(slotId);
    } else {
      slots.delete(slotId);
    }
  }

  /**
   * Clear cache for a specific job
   */
  clearJobCache(jobId: string): void {
    this.jobSlotCache.delete(jobId);
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.jobSlotCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { totalJobs: number; jobIds: string[] } {
    return {
      totalJobs: this.jobSlotCache.size,
      jobIds: Array.from(this.jobSlotCache.keys()),
    };
  }
}

export default JobConcurrencyController;
