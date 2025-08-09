import { logger } from '@/lib/logger';
import { Types } from 'mongoose';

export interface JobConcurrencySettings {
  jobId: string;
  maxConcurrentTransfers: number;
  maxConnectionsPerTransfer: number;
}

export interface SlotInfo {
  slotNumber: number;
  transferId: string;
  fileId: string;
  filename: string;
  assignedAt: Date;
}

export class JobConcurrencyController {
  private jobSlots = new Map<string, Set<number>>(); // jobId -> occupied slot numbers
  private slotTransfers = new Map<string, Map<number, SlotInfo>>(); // jobId -> slot -> transfer info
  private jobSettings = new Map<string, JobConcurrencySettings>(); // jobId -> settings cache
  private settingsCache = new Map<string, { settings: JobConcurrencySettings; expires: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

  constructor() {
    // Initialize monitoring
    this.startSlotMonitoring();
  }

  /**
   * Get available slot for job
   */
  async getAvailableSlot(jobId: string): Promise<number | null> {
    try {
      const maxConcurrency = await this.getJobConcurrencyLimit(jobId);
      if (maxConcurrency <= 0) {
        return null;
      }

      const occupiedSlots = this.jobSlots.get(jobId) || new Set();

      // Find the first available slot (0-based indexing)
      for (let slot = 0; slot < maxConcurrency; slot++) {
        if (!occupiedSlots.has(slot)) {
          return slot;
        }
      }

      return null; // No available slots
    } catch (error) {
      logger.error('Failed to get available slot', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Reserve slot for transfer
   */
  async reserveSlot(jobId: string, transferId: string, fileId?: string, filename?: string): Promise<number | null> {
    try {
      const availableSlot = await this.getAvailableSlot(jobId);
      if (availableSlot === null) {
        return null;
      }

      // Reserve the slot
      let jobSlotSet = this.jobSlots.get(jobId);
      if (!jobSlotSet) {
        jobSlotSet = new Set();
        this.jobSlots.set(jobId, jobSlotSet);
      }
      jobSlotSet.add(availableSlot);

      // Track transfer info
      let jobTransfers = this.slotTransfers.get(jobId);
      if (!jobTransfers) {
        jobTransfers = new Map();
        this.slotTransfers.set(jobId, jobTransfers);
      }

      jobTransfers.set(availableSlot, {
        slotNumber: availableSlot,
        transferId,
        fileId: fileId || '',
        filename: filename || '',
        assignedAt: new Date()
      });

      logger.info('Slot reserved successfully', {
        jobId,
        slotNumber: availableSlot,
        transferId,
        filename
      });

      return availableSlot;
    } catch (error) {
      logger.error('Failed to reserve slot', {
        jobId,
        transferId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Release slot when transfer completes
   */
  async releaseSlot(jobId: string, slotNumber: number): Promise<void> {
    try {
      const jobSlotSet = this.jobSlots.get(jobId);
      if (jobSlotSet) {
        jobSlotSet.delete(slotNumber);

        // Clean up empty sets
        if (jobSlotSet.size === 0) {
          this.jobSlots.delete(jobId);
        }
      }

      const jobTransfers = this.slotTransfers.get(jobId);
      if (jobTransfers) {
        const slotInfo = jobTransfers.get(slotNumber);
        jobTransfers.delete(slotNumber);

        // Clean up empty maps
        if (jobTransfers.size === 0) {
          this.slotTransfers.delete(jobId);
        }

        logger.info('Slot released successfully', {
          jobId,
          slotNumber,
          transferId: slotInfo?.transferId,
          filename: slotInfo?.filename
        });
      }
    } catch (error) {
      logger.error('Failed to release slot', {
        jobId,
        slotNumber,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Release slot by transfer ID
   */
  async releaseSlotByTransferId(transferId: string): Promise<void> {
    try {
      for (const [jobId, jobTransfers] of this.slotTransfers.entries()) {
        for (const [slotNumber, slotInfo] of jobTransfers.entries()) {
          if (slotInfo.transferId === transferId) {
            await this.releaseSlot(jobId, slotNumber);
            return;
          }
        }
      }

      logger.warn('No slot found for transfer ID', { transferId });
    } catch (error) {
      logger.error('Failed to release slot by transfer ID', {
        transferId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get job concurrency settings with caching
   */
  private async getJobConcurrencyLimit(jobId: string): Promise<number> {
    try {
      // Check cache first
      const cached = this.settingsCache.get(jobId);
      if (cached && cached.expires > Date.now()) {
        return cached.settings.maxConcurrentTransfers;
      }

      const { SyncJob } = await import('@/models');
      const job = await SyncJob.findById(jobId, 'parallelism').lean();

      if (!job) {
        logger.error('Job not found for concurrency check', { jobId });
        return 0;
      }

      const maxConcurrency = job.parallelism?.maxConcurrentTransfers || 3; // Default to 3
      const maxConnections = job.parallelism?.maxConnectionsPerTransfer || 5; // Default to 5

      const settings: JobConcurrencySettings = {
        jobId,
        maxConcurrentTransfers: maxConcurrency,
        maxConnectionsPerTransfer: maxConnections
      };

      // Cache the settings
      this.settingsCache.set(jobId, {
        settings,
        expires: Date.now() + this.CACHE_TTL
      });

      return maxConcurrency;
    } catch (error) {
      logger.error('Failed to get job concurrency limit', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 3; // Default fallback
    }
  }

  /**
   * Check if job has available slots
   */
  async hasAvailableSlots(jobId: string): Promise<boolean> {
    try {
      const maxConcurrency = await this.getJobConcurrencyLimit(jobId);
      const occupiedSlots = this.jobSlots.get(jobId)?.size || 0;

      return occupiedSlots < maxConcurrency;
    } catch (error) {
      logger.error('Failed to check available slots', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Get current active transfers count for job
   */
  async getActiveTransfersCount(jobId: string): Promise<number> {
    return this.jobSlots.get(jobId)?.size || 0;
  }

  /**
   * Get detailed slot information for job
   */
  getJobSlotInfo(jobId: string): SlotInfo[] {
    const jobTransfers = this.slotTransfers.get(jobId);
    if (!jobTransfers) {
      return [];
    }

    return Array.from(jobTransfers.values()).sort((a, b) => a.slotNumber - b.slotNumber);
  }

  /**
   * Get all active transfers across all jobs
   */
  getAllActiveTransfers(): Map<string, SlotInfo[]> {
    const result = new Map<string, SlotInfo[]>();

    for (const [jobId, jobTransfers] of this.slotTransfers.entries()) {
      const transfers = Array.from(jobTransfers.values()).sort((a, b) => a.slotNumber - b.slotNumber);
      result.set(jobId, transfers);
    }

    return result;
  }

  /**
   * Initialize slots from database on startup
   */
  async initializeJobSlots(): Promise<void> {
    try {
      logger.info('Initializing job concurrency slots from database');

      const { FileState } = await import('@/models');

      // Find all currently transferring files with concurrency slots
      const activeTransfers = await FileState.find({
        syncState: 'transferring',
        'transfer.jobConcurrencySlot': { $exists: true, $ne: null },
        'transfer.activeTransferId': { $exists: true }
      }, 'jobId transfer.jobConcurrencySlot transfer.activeTransferId filename');

      let initializedCount = 0;

      for (const transfer of activeTransfers) {
        const jobId = transfer.jobId.toString();
        const slotNumber = transfer.transfer.jobConcurrencySlot;
        const transferId = transfer.transfer.activeTransferId;

        // Reserve the slot
        let jobSlotSet = this.jobSlots.get(jobId);
        if (!jobSlotSet) {
          jobSlotSet = new Set();
          this.jobSlots.set(jobId, jobSlotSet);
        }
        jobSlotSet.add(slotNumber);

        // Track transfer info
        let jobTransfers = this.slotTransfers.get(jobId);
        if (!jobTransfers) {
          jobTransfers = new Map();
          this.slotTransfers.set(jobId, jobTransfers);
        }

        jobTransfers.set(slotNumber, {
          slotNumber,
          transferId,
          fileId: transfer._id.toString(),
          filename: transfer.filename,
          assignedAt: new Date() // We don't have the original assignment time
        });

        initializedCount++;
      }

      logger.info('Job concurrency slots initialized', {
        activeTransfers: activeTransfers.length,
        slotsInitialized: initializedCount,
        jobsWithActiveTransfers: this.jobSlots.size
      });

    } catch (error) {
      logger.error('Failed to initialize job slots', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Monitor and enforce concurrency limits
   */
  async enforceConcurrencyLimits(): Promise<void> {
    try {
      const issues = [];

      for (const [jobId, occupiedSlots] of this.jobSlots.entries()) {
        const maxConcurrency = await this.getJobConcurrencyLimit(jobId);

        if (occupiedSlots.size > maxConcurrency) {
          issues.push({
            jobId,
            currentSlots: occupiedSlots.size,
            maxAllowed: maxConcurrency,
            excess: occupiedSlots.size - maxConcurrency
          });
        }
      }

      if (issues.length > 0) {
        logger.warn('Concurrency limit violations detected', { issues });

        // Optional: Auto-correct by cancelling excess transfers
        // This could be dangerous, so we just log for now
      }

    } catch (error) {
      logger.error('Failed to enforce concurrency limits', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Start monitoring slot usage and consistency
   */
  private startSlotMonitoring(): void {
    // Monitor every 5 minutes
    setInterval(async () => {
      try {
        await this.enforceConcurrencyLimits();
        await this.syncWithDatabase();
      } catch (error) {
        logger.error('Slot monitoring error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Sync in-memory slots with database state
   */
  async syncWithDatabase(): Promise<void> {
    try {
      const { FileState } = await import('@/models');

      // Get all transfers that should have slots
      const dbTransfers = await FileState.find({
        syncState: 'transferring',
        'transfer.activeTransferId': { $exists: true }
      }, 'jobId transfer.jobConcurrencySlot transfer.activeTransferId filename');

      const dbSlotMap = new Map<string, Set<number>>(); // jobId -> slots from DB
      const dbTransferMap = new Map<string, Map<number, any>>(); // jobId -> slot -> transfer info

      // Build database state map
      for (const transfer of dbTransfers) {
        const jobId = transfer.jobId.toString();
        const slotNumber = transfer.transfer.jobConcurrencySlot;

        if (slotNumber !== undefined && slotNumber !== null) {
          let jobSlots = dbSlotMap.get(jobId);
          if (!jobSlots) {
            jobSlots = new Set();
            dbSlotMap.set(jobId, jobSlots);
          }
          jobSlots.add(slotNumber);

          let jobTransfers = dbTransferMap.get(jobId);
          if (!jobTransfers) {
            jobTransfers = new Map();
            dbTransferMap.set(jobId, jobTransfers);
          }
          jobTransfers.set(slotNumber, transfer);
        }
      }

      // Sync memory state with database state
      let syncedSlots = 0;
      for (const [jobId, dbSlots] of dbSlotMap.entries()) {
        const memorySlots = this.jobSlots.get(jobId) || new Set();

        // Remove slots that are not in database
        for (const memorySlot of memorySlots) {
          if (!dbSlots.has(memorySlot)) {
            await this.releaseSlot(jobId, memorySlot);
            syncedSlots++;
          }
        }

        // Add slots that are in database but not in memory
        for (const dbSlot of dbSlots) {
          if (!memorySlots.has(dbSlot)) {
            const transferInfo = dbTransferMap.get(jobId)?.get(dbSlot);
            if (transferInfo) {
              await this.reserveSlot(
                jobId,
                transferInfo.transfer.activeTransferId,
                transferInfo._id.toString(),
                transferInfo.filename
              );
              syncedSlots++;
            }
          }
        }
      }

      if (syncedSlots > 0) {
        logger.info('Synced slots with database', { syncedSlots });
      }

    } catch (error) {
      logger.error('Failed to sync with database', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Clear all concurrency data (for testing/reset)
   */
  clearAllSlots(): void {
    this.jobSlots.clear();
    this.slotTransfers.clear();
    this.settingsCache.clear();
    logger.info('All concurrency slots cleared');
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): {
    totalActiveJobs: number;
    totalActiveTransfers: number;
    jobBreakdown: { jobId: string; activeTransfers: number; maxConcurrency: number }[];
  } {
    const jobBreakdown = [];
    let totalActiveTransfers = 0;

    for (const [jobId, slots] of this.jobSlots.entries()) {
      const cached = this.settingsCache.get(jobId);
      const maxConcurrency = cached?.settings?.maxConcurrentTransfers || 0;

      jobBreakdown.push({
        jobId,
        activeTransfers: slots.size,
        maxConcurrency
      });

      totalActiveTransfers += slots.size;
    }

    return {
      totalActiveJobs: this.jobSlots.size,
      totalActiveTransfers,
      jobBreakdown: jobBreakdown.sort((a, b) => b.activeTransfers - a.activeTransfers)
    };
  }
}
