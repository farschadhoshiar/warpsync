import { FileState } from "../../models/FileState";
import { WebSocketManager } from "../websocket/websocket-manager";
import { logger } from "../logger";

export type TransferState =
  | "idle"
  | "queued"
  | "transferring"
  | "completed"
  | "failed"
  | "cancelled";

export interface StateTransitionOptions {
  transferId?: string;
  metadata?: Record<string, any>;
  reason?: string;
  force?: boolean;
}

export interface TransferStateInfo {
  fileId: string;
  currentState: TransferState;
  transferId?: string;
  lastStateChange: Date;
  metadata?: Record<string, any>;
}

export class TransferStateManager {
  private static instance: TransferStateManager;
  private websocketManager: WebSocketManager;

  constructor() {
    this.websocketManager = WebSocketManager.getInstance();
  }

  public static getInstance(): TransferStateManager {
    if (!TransferStateManager.instance) {
      TransferStateManager.instance = new TransferStateManager();
    }
    return TransferStateManager.instance;
  }

  /**
   * Atomically transition a file's transfer state
   */
  async transitionState(
    fileId: string,
    newState: TransferState,
    options: StateTransitionOptions = {},
  ): Promise<boolean> {
    try {
      const fileState = await FileState.findById(fileId);
      if (!fileState) {
        logger.error(`File not found for state transition: ${fileId}`);
        return false;
      }

      const oldState = fileState.syncState as TransferState;

      // Validate state transition
      if (!this.isValidStateTransition(oldState, newState) && !options.force) {
        logger.warn(
          `Invalid state transition from ${oldState} to ${newState} for file ${fileId}`,
        );
        return false;
      }

      // Perform atomic state transition
      const result = await fileState.atomicStateTransition(newState, {
        transferId: options.transferId,
        metadata: options.metadata,
        reason:
          options.reason || `State transition: ${oldState} -> ${newState}`,
      });

      if (result) {
        // Emit WebSocket event for real-time updates
        await this.emitStateChangeEvent(fileId, oldState, newState, {
          transferId: options.transferId,
          metadata: options.metadata,
        });

        logger.info(
          `State transition successful: ${fileId} ${oldState} -> ${newState}`,
          {
            transferId: options.transferId,
            metadata: options.metadata,
          },
        );
      }

      return result;
    } catch (error) {
      logger.error(`Failed to transition state for file ${fileId}:`, error);
      return false;
    }
  }

  /**
   * Batch state transitions for multiple files
   */
  async batchTransition(
    fileIds: string[],
    newState: TransferState,
    options: StateTransitionOptions = {},
  ): Promise<{ successful: string[]; failed: string[] }> {
    const successful: string[] = [];
    const failed: string[] = [];

    await Promise.allSettled(
      fileIds.map(async (fileId) => {
        const result = await this.transitionState(fileId, newState, options);
        if (result) {
          successful.push(fileId);
        } else {
          failed.push(fileId);
        }
      }),
    );

    logger.info(
      `Batch state transition completed: ${successful.length} successful, ${failed.length} failed`,
      {
        newState,
        successful,
        failed,
      },
    );

    return { successful, failed };
  }

  /**
   * Get current transfer state for a file
   */
  async getTransferState(fileId: string): Promise<TransferStateInfo | null> {
    try {
      const fileState = await FileState.findById(fileId);
      if (!fileState) {
        return null;
      }

      return {
        fileId,
        currentState: fileState.syncState as TransferState,
        transferId: fileState.activeTransferId || undefined,
        lastStateChange: fileState.lastStateChange || fileState.updatedAt,
        metadata: fileState.stateHistory?.[0]?.metadata,
      };
    } catch (error) {
      logger.error(`Failed to get transfer state for file ${fileId}:`, error);
      return null;
    }
  }

  /**
   * Get all active transfers
   */
  async getActiveTransfers(): Promise<TransferStateInfo[]> {
    try {
      const activeFiles = await FileState.find({
        syncState: { $in: ["queued", "transferring"] },
        activeTransferId: { $exists: true, $ne: null },
      });

      return activeFiles.map((file) => ({
        fileId: file._id.toString(),
        currentState: file.syncState as TransferState,
        transferId: file.activeTransferId || undefined,
        lastStateChange: file.lastStateChange || file.updatedAt,
        metadata: file.stateHistory?.[0]?.metadata,
      }));
    } catch (error) {
      logger.error("Failed to get active transfers:", error);
      return [];
    }
  }

  /**
   * Get transfers by state
   */
  async getTransfersByState(
    state: TransferState,
  ): Promise<TransferStateInfo[]> {
    try {
      const files = await FileState.find({ syncState: state });

      return files.map((file) => ({
        fileId: file._id.toString(),
        currentState: file.syncState as TransferState,
        transferId: file.activeTransferId || undefined,
        lastStateChange: file.lastStateChange || file.updatedAt,
        metadata: file.stateHistory?.[0]?.metadata,
      }));
    } catch (error) {
      logger.error(`Failed to get transfers by state ${state}:`, error);
      return [];
    }
  }

  /**
   * Clear transfer state (reset to idle)
   */
  async clearTransferState(fileId: string, reason?: string): Promise<boolean> {
    return this.transitionState(fileId, "idle", {
      transferId: undefined,
      reason: reason || "Transfer state cleared",
    });
  }

  /**
   * Mark transfer as failed with error details
   */
  async markTransferFailed(
    fileId: string,
    error: string,
    transferId?: string,
  ): Promise<boolean> {
    return this.transitionState(fileId, "failed", {
      transferId,
      metadata: { error, timestamp: new Date().toISOString() },
      reason: `Transfer failed: ${error}`,
    });
  }

  /**
   * Validate if a state transition is allowed
   */
  private isValidStateTransition(
    fromState: TransferState,
    toState: TransferState,
  ): boolean {
    const allowedTransitions: Record<TransferState, TransferState[]> = {
      idle: ["queued"],
      queued: ["transferring", "cancelled", "idle"],
      transferring: ["completed", "failed", "cancelled"],
      completed: ["idle", "queued"],
      failed: ["idle", "queued"],
      cancelled: ["idle", "queued"],
    };

    return allowedTransitions[fromState]?.includes(toState) || false;
  }

  /**
   * Emit WebSocket event for state changes
   */
  private async emitStateChangeEvent(
    fileId: string,
    oldState: TransferState,
    newState: TransferState,
    metadata: { transferId?: string; metadata?: Record<string, any> },
  ): Promise<void> {
    try {
      const eventData = {
        type: "file:state:update",
        fileId,
        oldState,
        newState,
        transferId: metadata.transferId,
        metadata: metadata.metadata,
        timestamp: new Date().toISOString(),
      };

      // Emit to job-specific room if we have transfer metadata
      if (metadata.transferId) {
        this.websocketManager.emitToRoom(
          `transfer:${metadata.transferId}`,
          "transfer:status",
          eventData,
        );
      }

      // Emit to file-specific room
      this.websocketManager.emitToRoom(
        `file:${fileId}`,
        "file:state:update",
        eventData,
      );

      // Emit to global room for system monitoring
      this.websocketManager.emitToRoom(
        "system",
        "file:state:update",
        eventData,
      );
    } catch (error) {
      logger.error("Failed to emit state change event:", error);
    }
  }

  /**
   * Get state transition history for a file
   */
  async getStateHistory(fileId: string, limit: number = 10): Promise<any[]> {
    try {
      const fileState = await FileState.findById(fileId);
      if (!fileState || !fileState.stateHistory) {
        return [];
      }

      return fileState.stateHistory
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, limit);
    } catch (error) {
      logger.error(`Failed to get state history for file ${fileId}:`, error);
      return [];
    }
  }

  /**
   * Clean up old state history entries
   */
  async cleanupStateHistory(
    maxAge: number = 7 * 24 * 60 * 60 * 1000,
  ): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - maxAge);

      const result = await FileState.updateMany(
        {},
        {
          $pull: {
            stateHistory: {
              timestamp: { $lt: cutoffDate },
            },
          },
        },
      );

      logger.info(
        `Cleaned up state history: ${result.modifiedCount} files updated`,
      );
      return result.modifiedCount || 0;
    } catch (error) {
      logger.error("Failed to cleanup state history:", error);
      return 0;
    }
  }
}

export default TransferStateManager;
