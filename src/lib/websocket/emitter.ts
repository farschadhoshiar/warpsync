import { Server as SocketIOServer } from "socket.io";
import {
  SocketEvents,
  FileStateUpdateSchema,
  UnifiedTransferProgressSchema,
  TransferStatusSchema,
} from "./events";
import { logger } from "@/lib/logger";
import {
  broadcastJobProgress,
  broadcastServerStatus,
  broadcastGlobalMessage,
} from "./manager";
import { isValidObjectId } from "@/lib/utils/validation";

export class EventEmitter {
  private io: SocketIOServer;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  // ✅ Emit file state update using new broadcasting pattern
  emitFileStateUpdate(data: SocketEvents["file:state:update"]) {
    try {
      const validated = FileStateUpdateSchema.parse(data);

      // Use new broadcasting function that handles both individual job rooms and all-jobs room
      broadcastJobProgress(this.io, data.jobId, {
        type: "file:state:update",
        ...validated,
      });

      // Debug logging removed to reduce noise
    } catch (error) {
      logger.error("Failed to emit file state update", { error });
    }
  }

  // ✅ Emit unified transfer progress using new broadcasting pattern
  private unifiedProgressThrottleMap = new Map<string, number>();

  emitUnifiedTransferProgress(data: SocketEvents["transfer:progress"]) {
    try {
      const validated = UnifiedTransferProgressSchema.parse(data);
      const key = `${data.transferId}:${data.fileId}`;
      const now = Date.now();
      const lastEmit = this.unifiedProgressThrottleMap.get(key) || 0;

      // Throttle progress updates to max every 200ms for better responsiveness
      if (now - lastEmit < 200) {
        return;
      }

      this.unifiedProgressThrottleMap.set(key, now);

      // ✅ Use new broadcasting function - this will automatically handle:
      // - Sending to specific job room: job:${jobId}
      // - Sending to all-jobs room: all-jobs
      broadcastJobProgress(this.io, data.jobId, {
        type: "transfer:progress",
        ...validated,
      });

      // Debug logging for development
      logger.debug("Emitted unified transfer progress", {
        transferId: data.transferId,
        jobId: data.jobId,
        fileId: data.fileId,
        filename: data.filename,
        progress: data.progress,
        speed: data.speed,
        status: data.status,
      });
    } catch (error) {
      logger.error("Failed to emit unified transfer progress", { error });
    }
  }

  // ✅ Emit transfer status changes using new broadcasting
  emitTransferStatus(data: SocketEvents["transfer:status"]) {
    try {
      const validated = TransferStatusSchema.parse(data);

      // ✅ Use new broadcasting function
      broadcastJobProgress(this.io, data.jobId, {
        type: "transfer:status",
        ...validated,
      });

      logger.info("Emitted transfer status change", {
        transferId: data.transferId,
        fileId: data.fileId,
        oldStatus: data.oldStatus,
        newStatus: data.newStatus,
        jobId: data.jobId,
      });
    } catch (error) {
      logger.error("Failed to emit transfer status", { error });
    }
  }

  // ✅ Emit scan completion using new broadcasting
  emitScanComplete(data: SocketEvents["scan:complete"]) {
    try {
      // ✅ Use new broadcasting function
      broadcastJobProgress(this.io, data.jobId, {
        type: "scan:complete",
        ...data,
      });

      logger.info("Emitted scan completion", {
        jobId: data.jobId,
        filesFound: data.filesFound,
        duration: data.duration,
      });
    } catch (error) {
      logger.error("Failed to emit scan completion", { error });
    }
  }

  // ✅ Emit scan SSH connecting using new broadcasting
  emitScanSSHConnecting(data: SocketEvents["scan:ssh-connecting"]) {
    try {
      if (data.jobId && isValidObjectId(data.jobId)) {
        broadcastJobProgress(this.io, data.jobId, {
          type: "scan:ssh-connecting",
          ...data,
        });
      }

      logger.info("Emitted scan SSH connecting", {
        jobId: data.jobId,
        serverAddress: data.serverAddress,
      });
    } catch (error) {
      logger.error("Failed to emit scan SSH connecting", { error });
    }
  }

  // ✅ Emit scan SSH connected using new broadcasting
  emitScanSSHConnected(data: SocketEvents["scan:ssh-connected"]) {
    try {
      if (data.jobId && isValidObjectId(data.jobId)) {
        broadcastJobProgress(this.io, data.jobId, {
          type: "scan:ssh-connected",
          ...data,
        });
      }

      logger.info("Emitted scan SSH connected", {
        jobId: data.jobId,
        serverAddress: data.serverAddress,
      });
    } catch (error) {
      logger.error("Failed to emit scan SSH connected", { error });
    }
  }

  // ✅ Emit scan syncing states using new broadcasting
  emitScanSyncingStates(data: SocketEvents["scan:syncing-states"]) {
    try {
      if (data.jobId && isValidObjectId(data.jobId)) {
        broadcastJobProgress(this.io, data.jobId, {
          type: "scan:syncing-states",
          ...data,
        });
      }

      logger.info("Emitted scan syncing states", {
        jobId: data.jobId,
        remotePath: data.remotePath,
        localPath: data.localPath,
      });
    } catch (error) {
      logger.error("Failed to emit scan syncing states", { error });
    }
  }

  // ✅ Emit log message with improved routing
  emitLogMessage(data: SocketEvents["log:message"]) {
    try {
      if (data.jobId && isValidObjectId(data.jobId)) {
        // Send to specific job and all-jobs rooms
        broadcastJobProgress(this.io, data.jobId, {
          type: "log:message",
          ...data,
        });
      } else {
        // Send globally
        broadcastGlobalMessage(this.io, "log:message", data);
      }

      // Debug logging removed to reduce noise
    } catch (error) {
      logger.error("Failed to emit log message", { error });
    }
  }

  // ✅ Emit connection test result using server broadcasting
  emitConnectionTest(serverId: string, data: SocketEvents["connection:test"]) {
    try {
      if (!isValidObjectId(serverId)) {
        logger.warn("Invalid serverId for connection test", { serverId });
        return;
      }

      broadcastServerStatus(this.io, serverId, {
        type: "connection:test",
        ...data,
      });

      logger.info("Emitted connection test result", {
        serverId,
        success: data.success,
        duration: data.duration,
      });
    } catch (error) {
      logger.error("Failed to emit connection test", { error });
    }
  }

  // ✅ Emit error event with improved routing
  emitError(data: SocketEvents["error:occurred"]) {
    try {
      if (data.jobId && isValidObjectId(data.jobId)) {
        // Send to job rooms (specific + all-jobs)
        broadcastJobProgress(this.io, data.jobId, {
          type: "error:occurred",
          ...data,
        });
      } else if (data.serverId && isValidObjectId(data.serverId)) {
        // Send to server room
        broadcastServerStatus(this.io, data.serverId, {
          type: "error:occurred",
          ...data,
        });
      } else {
        // Send globally
        broadcastGlobalMessage(this.io, "error:occurred", data);
      }

      logger.warn("Emitted error event", {
        type: data.type,
        message: data.message,
        jobId: data.jobId,
        serverId: data.serverId,
      });
    } catch (error) {
      logger.error("Failed to emit error event", { error });
    }
  }

  // ✅ New method: Emit job-specific progress events
  emitJobProgress(jobId: string, progressData: any) {
    try {
      if (!isValidObjectId(jobId)) {
        logger.warn("Invalid jobId for job progress", { jobId });
        return;
      }

      broadcastJobProgress(this.io, jobId, {
        type: "job:progress",
        jobId,
        ...progressData,
        timestamp: new Date().toISOString(),
      });

      logger.debug("Emitted job progress", {
        jobId,
        progressType: progressData.type || "unknown",
      });
    } catch (error) {
      logger.error("Failed to emit job progress", { error });
    }
  }

  // ✅ New method: Emit server status updates
  emitServerStatus(serverId: string, statusData: any) {
    try {
      if (!isValidObjectId(serverId)) {
        logger.warn("Invalid serverId for server status", { serverId });
        return;
      }

      broadcastServerStatus(this.io, serverId, {
        type: "server:status",
        serverId,
        ...statusData,
        timestamp: new Date().toISOString(),
      });

      logger.debug("Emitted server status", {
        serverId,
        statusType: statusData.type || "unknown",
      });
    } catch (error) {
      logger.error("Failed to emit server status", { error });
    }
  }

  // ✅ New method: Get connection stats for debugging
  getConnectionStats() {
    const sockets = this.io.sockets.sockets;
    const roomCounts: Record<string, number> = {};

    for (const [, socket] of sockets) {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          roomCounts[room] = (roomCounts[room] || 0) + 1;
        }
      }
    }

    return {
      totalConnections: sockets.size,
      rooms: roomCounts,
      timestamp: new Date().toISOString(),
    };
  }
}

// Global emitter instance with improved lifecycle management
let globalEmitter: EventEmitter | null = null;

export function getEventEmitter(): EventEmitter | null {
  if (typeof global !== "undefined" && global.io) {
    if (!globalEmitter) {
      globalEmitter = new EventEmitter(global.io);
      logger.info("Created global event emitter");
    }
    return globalEmitter;
  }
  return null;
}

// ✅ Reset global emitter (useful for testing or server restart)
export function resetEventEmitter(): void {
  globalEmitter = null;
}

// ✅ Improved utility function for API routes with better error handling
export function emitIfAvailable<T extends keyof SocketEvents>(
  event: T,
  data: SocketEvents[T],
): boolean {
  const emitter = getEventEmitter();
  if (!emitter) {
    logger.warn("Event emitter not available", { event: String(event) });
    return false;
  }
  try {
    switch (event) {
      case "file:state:update":
        emitter.emitFileStateUpdate(data as SocketEvents["file:state:update"]);
        break;
      case "transfer:progress":
        emitter.emitUnifiedTransferProgress(
          data as SocketEvents["transfer:progress"],
        );
        break;
      case "transfer:status":
        emitter.emitTransferStatus(data as SocketEvents["transfer:status"]);
        break;
      case "scan:complete":
        emitter.emitScanComplete(data as SocketEvents["scan:complete"]);
        break;
      case "scan:ssh-connecting":
        emitter.emitScanSSHConnecting(
          data as SocketEvents["scan:ssh-connecting"],
        );
        break;
      case "scan:ssh-connected":
        emitter.emitScanSSHConnected(
          data as SocketEvents["scan:ssh-connected"],
        );
        break;
      case "scan:syncing-states":
        emitter.emitScanSyncingStates(
          data as SocketEvents["scan:syncing-states"],
        );
        break;
      case "log:message":
        emitter.emitLogMessage(data as SocketEvents["log:message"]);
        break;
      case "error:occurred":
        emitter.emitError(data as SocketEvents["error:occurred"]);
        break;
      default:
        logger.warn("Unknown event type", { event });
        return false;
    }
    return true;
  } catch (error) {
    logger.error("Failed to emit event", { event: String(event), error });
    return false;
  }
}

// ✅ Convenience functions for common operations
export function emitJobProgressIfAvailable(
  jobId: string,
  progressData: any,
): boolean {
  const emitter = getEventEmitter();
  if (emitter) {
    emitter.emitJobProgress(jobId, progressData);
    return true;
  }
  return false;
}

export function emitServerStatusIfAvailable(
  serverId: string,
  statusData: any,
): boolean {
  const emitter = getEventEmitter();
  if (emitter) {
    emitter.emitServerStatus(serverId, statusData);
    return true;
  }
  return false;
}

// ✅ Debug function to check emitter status
export function getEmitterStatus() {
  const emitter = getEventEmitter();
  return {
    available: !!emitter,
    stats: emitter ? emitter.getConnectionStats() : null,
    timestamp: new Date().toISOString(),
  };
}
