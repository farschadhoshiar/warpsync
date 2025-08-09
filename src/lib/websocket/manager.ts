import { Server as SocketIOServer, Socket } from "socket.io";
import { logger } from "@/lib/logger";
import { rateLimitSocketEvent } from "./middleware";
import {
  isValidObjectId,
  isValidJobId,
  isValidServerId,
  getServerRoomName,
} from "@/lib/utils/validation";

interface SocketWithAuth extends Socket {
  userId?: string;
  requestId: string;
  currentJobId?: string;
  currentServerId?: string;
}

export function setupSocketHandlers(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    const socketWithAuth = socket as SocketWithAuth;

    // Extract jobId from handshake query
    const jobId = socket.handshake.query.jobId as string;
    const serverId = socket.handshake.query.serverId as string;

    logger.info("New socket connection", {
      socketId: socketWithAuth.id,
      userId: socketWithAuth.userId,
      requestId: socketWithAuth.requestId,
      jobId,
      serverId,
    });

    // ✅ Server-side room management based on connection parameters
    handleRoomAssignment(socketWithAuth, jobId, serverId);

    // Handle ping for connection testing
    socketWithAuth.on("ping", (callback) => {
      if (!rateLimitSocketEvent(socket, "ping", 60)) {
        return;
      }

      if (typeof callback === "function") {
        callback({ timestamp: new Date().toISOString() });
      }
    });

    // Handle disconnection
    socketWithAuth.on("disconnect", (reason) => {
      logger.info("Socket disconnected", {
        socketId: socketWithAuth.id,
        userId: socketWithAuth.userId,
        jobId: socketWithAuth.currentJobId,
        serverId: socketWithAuth.currentServerId,
        reason,
      });
    });

    // Handle connection errors
    socketWithAuth.on("error", (error) => {
      logger.error("Socket error", {
        socketId: socketWithAuth.id,
        userId: socketWithAuth.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
  });

  // Log server events
  io.engine.on("connection_error", (err) => {
    logger.error("Socket.IO connection error", {
      message: err.message,
      description: err.description,
      context: err.context,
      type: err.type,
    });
  });
}

/**
 * ✅ Handle automatic room assignment based on connection parameters
 * This is the correct Socket.IO pattern - server manages room membership
 */
function handleRoomAssignment(
  socket: SocketWithAuth,
  jobId?: string,
  serverId?: string,
) {
  // Handle job room assignment
  if (jobId) {
    if (jobId === "all") {
      // ✅ For "All Jobs" view, put socket in special all-jobs room
      socket.join("all-jobs");
      socket.currentJobId = "all";

      logger.info("Socket joined all-jobs room", {
        socketId: socket.id,
        userId: socket.userId,
        roomType: "all-jobs",
      });

      socket.emit("room:joined", {
        roomName: "all-jobs",
        jobId: "all",
        type: "all-jobs",
      });
    } else if (isValidObjectId(jobId)) {
      // ✅ For specific job, put socket in individual job room
      const roomName = `job:${jobId}`;
      socket.join(roomName);
      socket.currentJobId = jobId;

      logger.info("Socket joined job room", {
        socketId: socket.id,
        userId: socket.userId,
        jobId,
        roomName,
      });

      socket.emit("room:joined", {
        roomName,
        jobId,
        type: "job",
      });
    } else {
      // ✅ Handle invalid jobId gracefully - don't error, just log warning
      logger.warn("Invalid jobId provided in handshake", {
        socketId: socket.id,
        userId: socket.userId,
        jobId,
        action: "no_room_assigned",
      });

      socket.emit("room:error", {
        message: "Invalid job ID format",
        jobId,
        type: "validation_error",
      });
    }
  }

  // Handle server room assignment
  if (serverId && isValidServerId(serverId)) {
    const roomName = `server:${serverId}`;
    socket.join(roomName);
    socket.currentServerId = serverId;

    logger.info("Socket joined server room", {
      socketId: socket.id,
      userId: socket.userId,
      serverId,
      roomName,
    });

    socket.emit("room:joined", {
      roomName,
      serverId,
      type: "server",
    });
  } else if (serverId) {
    logger.warn("Invalid serverId provided in handshake", {
      socketId: socket.id,
      userId: socket.userId,
      serverId,
      action: "no_server_room_assigned",
    });
  }
}

/**
 * ✅ Broadcast job progress to appropriate rooms
 * This is the correct pattern - server broadcasts to rooms
 */
export function broadcastJobProgress(
  io: SocketIOServer,
  jobId: string,
  progress: any,
) {
  if (!isValidObjectId(jobId)) {
    logger.warn("Attempted to broadcast progress for invalid jobId", { jobId });
    return;
  }

  const jobRoomName = `job:${jobId}`;

  // Send to specific job room
  io.to(jobRoomName).emit("job:progress", {
    jobId,
    ...progress,
    timestamp: new Date().toISOString(),
  });

  // Also send to all-jobs room for "All Jobs" view
  io.to("all-jobs").emit("job:progress", {
    jobId,
    ...progress,
    timestamp: new Date().toISOString(),
  });

  logger.debug("Broadcasted job progress", {
    jobId,
    jobRoomName,
    progressType: progress.type || "unknown",
  });
}

/**
 * ✅ Broadcast server status to appropriate rooms
 */
export function broadcastServerStatus(
  io: SocketIOServer,
  serverId: string,
  status: any,
) {
  if (!isValidServerId(serverId)) {
    logger.warn("Attempted to broadcast server status for invalid serverId", {
      serverId,
    });
    return;
  }

  const serverRoomName = `server:${serverId}`;

  io.to(serverRoomName).emit("server:status", {
    serverId,
    ...status,
    timestamp: new Date().toISOString(),
  });

  logger.debug("Broadcasted server status", {
    serverId,
    serverRoomName,
    statusType: status.type || "unknown",
  });
}

/**
 * ✅ Broadcast to all connected sockets (global announcements)
 */
export function broadcastGlobalMessage(
  io: SocketIOServer,
  event: string,
  data: any,
) {
  io.emit(event, {
    ...data,
    timestamp: new Date().toISOString(),
  });

  logger.debug("Broadcasted global message", {
    event,
    dataKeys: Object.keys(data),
  });
}

// Utility to get connection stats
export function getConnectionStats(io: SocketIOServer) {
  const sockets = io.sockets.sockets;
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
