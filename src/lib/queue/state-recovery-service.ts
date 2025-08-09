import { logger } from '@/lib/logger';
import { TransferStateManager } from './transfer-state-manager';
import { JobConcurrencyController } from './job-concurrency-controller';
import { Types } from 'mongoose';

export interface RecoveryResult {
  orphanedCount: number;
  recoveredCount: number;
  failedCount: number;
  queuedCount: number;
  cleanedUpCount: number;
  duration: number;
}

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  memoryCount: number;
  databaseCount: number;
  inconsistentStates: number;
}

export interface ValidationIssue {
  type: 'missing_in_memory' | 'missing_in_database' | 'state_mismatch' | 'slot_conflict';
  fileId: string;
  transferId?: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export class StateRecoveryService {
  private readonly ORPHAN_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly STUCK_TIMEOUT = 60 * 60 * 1000; // 1 hour
  private readonly OLD_TRANSFER_CLEANUP = 7 * 24 * 60 * 60 * 1000; // 7 days

  private stateManager: TransferStateManager;
  private concurrencyController: JobConcurrencyController;

  constructor(
    stateManager: TransferStateManager,
    concurrencyController: JobConcurrencyController
  ) {
    this.stateManager = stateManager;
    this.concurrencyController = concurrencyController;
  }

  /**
   * Recover system state on startup
   */
  async recoverSystemState(): Promise<RecoveryResult> {
    const startTime = Date.now();
    logger.info('Starting system state recovery');

    try {
      // Step 1: Handle orphaned transfers
      const orphanedCount = await this.handleOrphanedTransfers();

      // Step 2: Reset stuck transfers
      const stuckCount = await this.resetStuckTransfers();

      // Step 3: Initialize concurrency controller
      await this.concurrencyController.initializeJobSlots();

      // Step 4: Clean up old completed transfers
      const cleanedUpCount = await this.cleanupOldTransfers(this.OLD_TRANSFER_CLEANUP);

      // Step 5: Get current queued transfers count
      const queuedCount = await this.getQueuedTransfersCount();

      const duration = Date.now() - startTime;

      const result: RecoveryResult = {
        orphanedCount,
        recoveredCount: stuckCount,
        failedCount: 0,
        queuedCount,
        cleanedUpCount,
        duration
      };

      logger.info('System state recovery completed', result);
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('System state recovery failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });

      return {
        orphanedCount: 0,
        recoveredCount: 0,
        failedCount: 1,
        queuedCount: 0,
        cleanedUpCount: 0,
        duration
      };
    }
  }

  /**
   * Find and handle orphaned transfers
   */
  async handleOrphanedTransfers(): Promise<number> {
    try {
      logger.info('Handling orphaned transfers');

      const { FileState } = await import('@/models');

      // Find orphaned transfers (transferring state but too old)
      const orphanedTransfers = await FileState.findOrphanedTransfers(this.ORPHAN_TIMEOUT);

      if (orphanedTransfers.length === 0) {
        logger.info('No orphaned transfers found');
        return 0;
      }

      logger.warn('Found orphaned transfers', { count: orphanedTransfers.length });

      // Reset orphaned transfers to failed state
      const transferIds = orphanedTransfers
        .map(t => t.transfer.activeTransferId)
        .filter(Boolean) as string[];

      const resetCount = await FileState.resetOrphanedTransfers(transferIds);

      // Release concurrency slots for orphaned transfers
      for (const transfer of orphanedTransfers) {
        if (transfer.transfer.activeTransferId) {
          await this.concurrencyController.releaseSlotByTransferId(
            transfer.transfer.activeTransferId
          );
        }
      }

      logger.info('Orphaned transfers handled', {
        found: orphanedTransfers.length,
        reset: resetCount,
        slotsReleased: transferIds.length
      });

      return resetCount;

    } catch (error) {
      logger.error('Failed to handle orphaned transfers', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Rebuild in-memory queue from database
   */
  async rebuildTransferQueue(transferQueue: any): Promise<void> {
    try {
      logger.info('Rebuilding transfer queue from database');

      const { FileState } = await import('@/models');

      // Get all queued and transferring files
      const activeFiles = await FileState.find({
        syncState: { $in: ['queued', 'transferring'] },
        'transfer.activeTransferId': { $exists: true }
      }).populate('jobId');

      let rebuiltCount = 0;

      for (const file of activeFiles) {
        try {
          // Add transfer back to queue if it's not already there
          const existingTransfer = transferQueue.getTransfer(file.transfer.activeTransferId);

          if (!existingTransfer && file.jobId) {
            // Reconstruct transfer data from file state
            const transferData = {
              jobId: file.jobId._id.toString(),
              fileId: file._id.toString(),
              type: file.isDirectory ? 'directory' : 'file',
              priority: file.transfer.manualPriority ? 'URGENT' : 'NORMAL',
              source: file.transfer.source || 'automatic',
              destination: '', // Will be reconstructed
              filename: file.filename,
              relativePath: file.relativePath,
              size: file.remote?.size || file.local?.size || 0,
              sshConfig: {
                // Will be populated from job's server profile
                host: '',
                port: 22,
                username: '',
                privateKey: ''
              },
              rsyncOptions: {
                verbose: true,
                archive: true,
                compress: true,
                progress: true,
                humanReadable: true,
                partial: true,
                inplace: false
              },
              maxRetries: 3
            };

            // Add to queue with existing transfer ID
            await transferQueue.addTransferWithId(file.transfer.activeTransferId, transferData);
            rebuiltCount++;
          }

        } catch (error) {
          logger.error('Failed to rebuild individual transfer', {
            fileId: file._id,
            filename: file.filename,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      logger.info('Transfer queue rebuilt from database', {
        activeFiles: activeFiles.length,
        rebuiltTransfers: rebuiltCount
      });

    } catch (error) {
      logger.error('Failed to rebuild transfer queue', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Validate state consistency between memory and database
   */
  async validateStateConsistency(transferQueue?: any): Promise<ValidationResult> {
    try {
      logger.info('Validating state consistency');

      const { FileState } = await import('@/models');
      const issues: ValidationIssue[] = [];

      // Get database state
      const dbTransfers = await FileState.find({
        syncState: { $in: ['queued', 'transferring'] },
        'transfer.activeTransferId': { $exists: true }
      });

      const databaseCount = dbTransfers.length;
      let memoryCount = 0;
      let inconsistentStates = 0;

      if (transferQueue) {
        // Get memory state
        const memoryTransfers = transferQueue.getTransfers();
        memoryCount = memoryTransfers.length;

        // Check for transfers in memory but not in database
        for (const memoryTransfer of memoryTransfers) {
          const dbMatch = dbTransfers.find(db =>
            db.transfer.activeTransferId === memoryTransfer.id
          );

          if (!dbMatch) {
            issues.push({
              type: 'missing_in_database',
              fileId: memoryTransfer.fileId,
              transferId: memoryTransfer.id,
              description: `Transfer exists in memory but not in database`,
              severity: 'high'
            });
            inconsistentStates++;
          }
        }

        // Check for transfers in database but not in memory
        for (const dbTransfer of dbTransfers) {
          if (dbTransfer.transfer.activeTransferId) {
            const memoryMatch = memoryTransfers.find(mem =>
              mem.id === dbTransfer.transfer.activeTransferId
            );

            if (!memoryMatch) {
              issues.push({
                type: 'missing_in_memory',
                fileId: dbTransfer._id.toString(),
                transferId: dbTransfer.transfer.activeTransferId,
                description: `Transfer exists in database but not in memory`,
                severity: 'medium'
              });
              inconsistentStates++;
            } else {
              // Check for state mismatches
              const expectedMemoryStatus = dbTransfer.syncState === 'queued' ? 'QUEUED' : 'TRANSFERRING';
              if (memoryMatch.status !== expectedMemoryStatus) {
                issues.push({
                  type: 'state_mismatch',
                  fileId: dbTransfer._id.toString(),
                  transferId: dbTransfer.transfer.activeTransferId,
                  description: `State mismatch: DB=${dbTransfer.syncState}, Memory=${memoryMatch.status}`,
                  severity: 'medium'
                });
                inconsistentStates++;
              }
            }
          }
        }
      }

      // Check for concurrency slot conflicts
      const slotConflicts = await this.checkConcurrencySlotConflicts();
      issues.push(...slotConflicts);

      const isValid = issues.filter(i => i.severity === 'high').length === 0;

      const result: ValidationResult = {
        isValid,
        issues,
        memoryCount,
        databaseCount,
        inconsistentStates
      };

      logger.info('State consistency validation completed', {
        isValid,
        issuesFound: issues.length,
        memoryCount,
        databaseCount,
        inconsistentStates
      });

      return result;

    } catch (error) {
      logger.error('Failed to validate state consistency', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        isValid: false,
        issues: [{
          type: 'state_mismatch',
          fileId: '',
          description: 'Validation failed due to error',
          severity: 'high'
        }],
        memoryCount: 0,
        databaseCount: 0,
        inconsistentStates: 0
      };
    }
  }

  /**
   * Reset stuck transfers to queued state
   */
  async resetStuckTransfers(): Promise<number> {
    try {
      logger.info('Resetting stuck transfers');

      const { FileState } = await import('@/models');
      const stuckCutoff = new Date(Date.now() - this.STUCK_TIMEOUT);

      // Find transfers that have been "transferring" too long
      const stuckTransfers = await FileState.find({
        syncState: 'transferring',
        'transfer.startedAt': { $lt: stuckCutoff },
        'transfer.lastStateChange': { $lt: stuckCutoff }
      });

      if (stuckTransfers.length === 0) {
        logger.info('No stuck transfers found');
        return 0;
      }

      logger.warn('Found stuck transfers', { count: stuckTransfers.length });

      let resetCount = 0;

      for (const transfer of stuckTransfers) {
        try {
          // Reset to queued state
          const success = await this.stateManager.resetFileState(
            transfer._id.toString(),
            'queued',
            'Reset from stuck transferring state',
            false // Don't clear all transfer data, keep retry info
          );

          if (success) {
            resetCount++;

            // Release concurrency slot if it exists
            if (transfer.transfer.activeTransferId) {
              await this.concurrencyController.releaseSlotByTransferId(
                transfer.transfer.activeTransferId
              );
            }
          }

        } catch (error) {
          logger.error('Failed to reset individual stuck transfer', {
            fileId: transfer._id,
            filename: transfer.filename,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      logger.info('Stuck transfers reset', {
        found: stuckTransfers.length,
        reset: resetCount
      });

      return resetCount;

    } catch (error) {
      logger.error('Failed to reset stuck transfers', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Clean up old completed transfers
   */
  async cleanupOldTransfers(maxAge: number): Promise<number> {
    try {
      logger.info('Cleaning up old completed transfers');

      const { FileState } = await import('@/models');
      const cutoff = new Date(Date.now() - maxAge);

      // Clean up old state history entries
      const stateHistoryCleanup = await this.stateManager.cleanupOldStateHistory(maxAge);

      // Reset old completed transfers that still have transfer data
      const result = await FileState.updateMany(
        {
          syncState: { $in: ['synced', 'failed'] },
          'transfer.completedAt': { $lt: cutoff },
          'transfer.activeTransferId': { $exists: true }
        },
        {
          $unset: {
            'transfer.activeTransferId': 1,
            'transfer.jobConcurrencySlot': 1,
            'transfer.speed': 1,
            'transfer.eta': 1,
            'transfer.progress': 1
          }
        }
      );

      const totalCleaned = result.modifiedCount + stateHistoryCleanup;

      logger.info('Old transfers cleaned up', {
        transferDataCleared: result.modifiedCount,
        stateHistoryCleared: stateHistoryCleanup,
        totalCleaned,
        cutoff: cutoff.toISOString()
      });

      return totalCleaned;

    } catch (error) {
      logger.error('Failed to cleanup old transfers', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Get current queued transfers count
   */
  private async getQueuedTransfersCount(): Promise<number> {
    try {
      const { FileState } = await import('@/models');
      return await FileState.countDocuments({ syncState: 'queued' });
    } catch (error) {
      logger.error('Failed to get queued transfers count', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Check for concurrency slot conflicts
   */
  private async checkConcurrencySlotConflicts(): Promise<ValidationIssue[]> {
    try {
      const { FileState } = await import('@/models');
      const issues: ValidationIssue[] = [];

      // Find duplicate concurrency slots within the same job
      const duplicateSlots = await FileState.aggregate([
        {
          $match: {
            syncState: 'transferring',
            'transfer.jobConcurrencySlot': { $exists: true, $ne: null }
          }
        },
        {
          $group: {
            _id: {
              jobId: '$jobId',
              slot: '$transfer.jobConcurrencySlot'
            },
            count: { $sum: 1 },
            files: { $push: { fileId: '$_id', filename: '$filename', transferId: '$transfer.activeTransferId' } }
          }
        },
        {
          $match: {
            count: { $gt: 1 }
          }
        }
      ]);

      for (const duplicate of duplicateSlots) {
        for (const file of duplicate.files) {
          issues.push({
            type: 'slot_conflict',
            fileId: file.fileId.toString(),
            transferId: file.transferId,
            description: `Duplicate concurrency slot ${duplicate._id.slot} in job ${duplicate._id.jobId}`,
            severity: 'high'
          });
        }
      }

      return issues;

    } catch (error) {
      logger.error('Failed to check concurrency slot conflicts', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Health check for the recovery system
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    checks: { name: string; passed: boolean; message: string }[];
  }> {
    const checks = [];
    let healthy = true;

    try {
      // Check database connection
      const { FileState } = await import('@/models');
      await FileState.countDocuments({}).limit(1);
      checks.push({
        name: 'Database Connection',
        passed: true,
        message: 'Database accessible'
      });

    } catch (error) {
      healthy = false;
      checks.push({
        name: 'Database Connection',
        passed: false,
        message: 'Database connection failed'
      });
    }

    try {
      // Check for excessive orphaned transfers
      const { FileState } = await import('@/models');
      const orphanedCount = (await FileState.findOrphanedTransfers(this.ORPHAN_TIMEOUT)).length;
      const passed = orphanedCount < 10; // Threshold

      if (!passed) healthy = false;

      checks.push({
        name: 'Orphaned Transfers',
        passed,
        message: `${orphanedCount} orphaned transfers found`
      });

    } catch (error) {
      healthy = false;
      checks.push({
        name: 'Orphaned Transfers',
        passed: false,
        message: 'Failed to check orphaned transfers'
      });
    }

    try {
      // Check concurrency controller health
      const stats = this.concurrencyController.getStats();
      const passed = stats.totalActiveJobs >= 0; // Basic sanity check

      checks.push({
        name: 'Concurrency Controller',
        passed,
        message: `${stats.totalActiveJobs} active jobs, ${stats.totalActiveTransfers} active transfers`
      });

    } catch (error) {
      healthy = false;
      checks.push({
        name: 'Concurrency Controller',
        passed: false,
        message: 'Concurrency controller error'
      });
    }

    return { healthy, checks };
  }
}
