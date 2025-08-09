import { logger } from '@/lib/logger';
import { EventEmitter } from '../websocket/emitter';
import { Types } from 'mongoose';

export interface StateTransition {
  fileId: string;
  fromState: string;
  toState: string;
  transferId?: string;
  reason?: string;
  metadata?: any;
}

export interface StateTransitionResult {
  success: boolean;
  fileId: string;
  fromState: string;
  toState: string;
  error?: string;
}

export class TransferStateManager {
  private eventEmitter?: EventEmitter;

  // Valid state transitions mapping
  private readonly VALID_TRANSITIONS = {
    remote_only: ['queued', 'failed'],
    queued: ['transferring', 'failed', 'remote_only'],
    transferring: ['synced', 'failed', 'queued'],
    failed: ['queued', 'remote_only'],
    synced: ['desynced', 'failed'],
    desynced: ['queued', 'failed'],
    local_only: ['failed']
  } as const;

  constructor(eventEmitter?: EventEmitter) {
    this.eventEmitter = eventEmitter;
  }

  /**
   * Perform atomic state transition with database sync
   */
  async transitionState(
    fileId: string,
    fromState: string,
    toState: string,
    transferId?: string,
    metadata?: any
  ): Promise<boolean> {
    try {
      // Validate state transition
      if (!this.isValidTransition(fromState, toState)) {
        logger.error('Invalid state transition attempted', {
          fileId,
          fromState,
          toState,
          transferId
        });
        return false;
      }

      const { FileState } = await import('@/models');

      // Find and update the file state atomically
      const updateData: any = {
        syncState: toState,
        'transfer.lastStateChange': new Date()
      };

      // Add transfer ID if provided
      if (transferId) {
        updateData['transfer.activeTransferId'] = transferId;
      }

      // Add metadata if provided
      if (metadata) {
        if (metadata.progress !== undefined) {
          updateData['transfer.progress'] = metadata.progress;
        }
        if (metadata.speed !== undefined) {
          updateData['transfer.speed'] = metadata.speed;
        }
        if (metadata.eta !== undefined) {
          updateData['transfer.eta'] = metadata.eta;
        }
        if (metadata.error !== undefined) {
          updateData['transfer.errorMessage'] = metadata.error;
        }
        if (metadata.jobConcurrencySlot !== undefined) {
          updateData['transfer.jobConcurrencySlot'] = metadata.jobConcurrencySlot;
        }
      }

      // Handle state-specific updates
      switch (toState) {
        case 'transferring':
          updateData['transfer.startedAt'] = new Date();
          updateData['transfer.progress'] = 0;
          break;
        case 'synced':
          updateData['transfer.progress'] = 100;
          updateData['transfer.completedAt'] = new Date();
          updateData['local.exists'] = true;
          break;
        case 'failed':
          updateData['transfer.completedAt'] = new Date();
          updateData['transfer.retryCount'] = { $inc: 1 };
          break;
      }

      // Add state history entry
      const stateHistoryEntry = {
        fromState,
        toState,
        timestamp: new Date(),
        reason: metadata?.reason || `Transition from ${fromState} to ${toState}`
      };

      updateData['$push'] = {
        'transfer.stateHistory': {
          $each: [stateHistoryEntry],
          $slice: -10 // Keep only last 10 entries
        }
      };

      // Perform atomic update
      const updatedFile = await FileState.findByIdAndUpdate(
        fileId,
        updateData,
        {
          new: true,
          runValidators: true
        }
      );

      if (!updatedFile) {
        logger.error('File not found for state transition', { fileId });
        return false;
      }

      // Emit state change event
      this.emitStateChange(updatedFile, fromState, toState);

      logger.info('State transition successful', {
        fileId,
        fromState,
        toState,
        transferId,
        filename: updatedFile.filename
      });

      return true;

    } catch (error) {
      logger.error('State transition failed', {
        fileId,
        fromState,
        toState,
        transferId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Batch state transitions for performance
   */
  async batchTransitionStates(transitions: StateTransition[]): Promise<StateTransitionResult[]> {
    const results: StateTransitionResult[] = [];

    logger.info('Starting batch state transitions', {
      count: transitions.length
    });

    // Process transitions in parallel but with controlled concurrency
    const BATCH_SIZE = 10;
    for (let i = 0; i < transitions.length; i += BATCH_SIZE) {
      const batch = transitions.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (transition) => {
        const success = await this.transitionState(
          transition.fileId,
          transition.fromState,
          transition.toState,
          transition.transferId,
          transition.metadata
        );

        return {
          success,
          fileId: transition.fileId,
          fromState: transition.fromState,
          toState: transition.toState,
          error: success ? undefined : 'State transition failed'
        };
      });

      const batchResults = await Promise.allSettled(batchPromises);

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          logger.error('Batch transition failed', {
            error: result.reason
          });
        }
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    logger.info('Batch state transitions completed', {
      total: transitions.length,
      successful: successCount,
      failed: failureCount
    });

    return results;
  }

  /**
   * Emit state change events for real-time updates
   */
  private emitStateChange(fileState: any, oldState: string, newState: string): void {
    if (!this.eventEmitter) {
      return;
    }

    try {
      // Emit file state update
      this.eventEmitter.emitFileStateUpdate({
        jobId: fileState.jobId.toString(),
        fileId: fileState._id.toString(),
        filename: fileState.filename,
        relativePath: fileState.relativePath,
        oldState: oldState as any,
        newState: newState as any,
        timestamp: new Date().toISOString()
      });

      // Emit transfer status change if we have transfer info
      if (fileState.transfer?.activeTransferId) {
        this.eventEmitter.emitTransferStatus({
          transferId: fileState.transfer.activeTransferId,
          fileId: fileState._id.toString(),
          jobId: fileState.jobId.toString(),
          filename: fileState.filename,
          oldStatus: oldState,
          newStatus: newState,
          timestamp: new Date().toISOString(),
          metadata: {
            progress: fileState.transfer.progress,
            speed: fileState.transfer.speed,
            eta: fileState.transfer.eta,
            error: fileState.transfer.errorMessage
          }
        });
      }

    } catch (error) {
      logger.error('Failed to emit state change event', {
        fileId: fileState._id,
        oldState,
        newState,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Validate state transitions
   */
  private isValidTransition(from: string, to: string): boolean {
    // Allow same-state transitions (for metadata updates)
    if (from === to) {
      return true;
    }

    const validStates = this.VALID_TRANSITIONS[from as keyof typeof this.VALID_TRANSITIONS];
    return validStates ? validStates.includes(to as any) : false;
  }

  /**
   * Add state history entry (used by other services)
   */
  async addStateHistoryEntry(
    fileId: string,
    fromState: string,
    toState: string,
    reason: string
  ): Promise<void> {
    try {
      const { FileState } = await import('@/models');

      await FileState.findByIdAndUpdate(fileId, {
        $push: {
          'transfer.stateHistory': {
            $each: [{
              fromState,
              toState,
              timestamp: new Date(),
              reason
            }],
            $slice: -10 // Keep only last 10 entries
          }
        }
      });

    } catch (error) {
      logger.error('Failed to add state history entry', {
        fileId,
        fromState,
        toState,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get current state of a file
   */
  async getCurrentState(fileId: string): Promise<string | null> {
    try {
      const { FileState } = await import('@/models');

      const file = await FileState.findById(fileId, 'syncState').lean();
      return file?.syncState || null;

    } catch (error) {
      logger.error('Failed to get current state', {
        fileId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get state history for a file
   */
  async getStateHistory(fileId: string, limit: number = 10): Promise<any[]> {
    try {
      const { FileState } = await import('@/models');

      const file = await FileState.findById(fileId, 'transfer.stateHistory').lean();
      if (!file?.transfer?.stateHistory) {
        return [];
      }

      return file.transfer.stateHistory
        .slice(-limit)
        .sort((a: any, b: any) => b.timestamp.getTime() - a.timestamp.getTime());

    } catch (error) {
      logger.error('Failed to get state history', {
        fileId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Clean up old state history entries
   */
  async cleanupOldStateHistory(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const { FileState } = await import('@/models');
      const cutoff = new Date(Date.now() - maxAge);

      const result = await FileState.updateMany(
        {},
        {
          $pull: {
            'transfer.stateHistory': {
              timestamp: { $lt: cutoff }
            }
          }
        }
      );

      logger.info('Cleaned up old state history entries', {
        modifiedCount: result.modifiedCount,
        cutoff: cutoff.toISOString()
      });

      return result.modifiedCount;

    } catch (error) {
      logger.error('Failed to cleanup old state history', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Reset file state (used for recovery)
   */
  async resetFileState(
    fileId: string,
    targetState: string,
    reason: string,
    clearTransferData: boolean = false
  ): Promise<boolean> {
    try {
      const { FileState } = await import('@/models');

      const updateData: any = {
        syncState: targetState,
        'transfer.lastStateChange': new Date()
      };

      if (clearTransferData) {
        updateData['transfer.activeTransferId'] = undefined;
        updateData['transfer.jobConcurrencySlot'] = undefined;
        updateData['transfer.progress'] = 0;
        updateData['transfer.speed'] = undefined;
        updateData['transfer.eta'] = undefined;
        updateData['transfer.errorMessage'] = undefined;
        updateData['transfer.startedAt'] = undefined;
        updateData['transfer.completedAt'] = undefined;
      }

      // Add state history entry
      updateData['$push'] = {
        'transfer.stateHistory': {
          $each: [{
            fromState: 'unknown',
            toState: targetState,
            timestamp: new Date(),
            reason
          }],
          $slice: -10
        }
      };

      const result = await FileState.findByIdAndUpdate(
        fileId,
        updateData,
        { new: true }
      );

      if (result) {
        logger.info('File state reset successfully', {
          fileId,
          targetState,
          reason
        });
        return true;
      }

      return false;

    } catch (error) {
      logger.error('Failed to reset file state', {
        fileId,
        targetState,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
}
