import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '@/lib/logger';
import { rateLimitSocketEvent } from './middleware';

interface SocketWithAuth extends Socket {
  userId?: string;
  requestId: string;
}

export function setupSocketHandlers(io: SocketIOServer) {
  io.on('connection', (socket: Socket) => {
    const socketWithAuth = socket as SocketWithAuth;
    logger.info('New socket connection', {
      socketId: socketWithAuth.id,
      userId: socketWithAuth.userId,
      requestId: socketWithAuth.requestId
    });

    // Handle room subscription
    socketWithAuth.on('subscribe:job', (jobId: string) => {
      if (!rateLimitSocketEvent(socket, 'subscribe:job', 10)) {
        return;
      }
      
      if (typeof jobId !== 'string' || !jobId.match(/^[a-f\d]{24}$/i)) {
        socketWithAuth.emit('error', { message: 'Invalid job ID format' });
        return;
      }
      
      socketWithAuth.join(`job:${jobId}`);
      socketWithAuth.emit('subscribed:job', { jobId });
      
      logger.debug('Socket subscribed to job', {
        socketId: socketWithAuth.id,
        userId: socketWithAuth.userId,
        jobId
      });
    });

    socketWithAuth.on('unsubscribe:job', (jobId: string) => {
      if (!rateLimitSocketEvent(socket, 'unsubscribe:job', 10)) {
        return;
      }
      
      socketWithAuth.leave(`job:${jobId}`);
      socketWithAuth.emit('unsubscribed:job', { jobId });
      
      logger.debug('Socket unsubscribed from job', {
        socketId: socketWithAuth.id,
        userId: socketWithAuth.userId,
        jobId
      });
    });

    // Handle server subscription
    socketWithAuth.on('subscribe:server', (serverId: string) => {
      if (!rateLimitSocketEvent(socket, 'subscribe:server', 10)) {
        return;
      }
      
      if (typeof serverId !== 'string' || !serverId.match(/^[a-f\d]{24}$/i)) {
        socketWithAuth.emit('error', { message: 'Invalid server ID format' });
        return;
      }
      
      socketWithAuth.join(`server:${serverId}`);
      socketWithAuth.emit('subscribed:server', { serverId });
      
      logger.debug('Socket subscribed to server', {
        socketId: socketWithAuth.id,
        userId: socketWithAuth.userId,
        serverId
      });
    });

    socketWithAuth.on('unsubscribe:server', (serverId: string) => {
      if (!rateLimitSocketEvent(socket, 'unsubscribe:server', 10)) {
        return;
      }
      
      socketWithAuth.leave(`server:${serverId}`);
      socketWithAuth.emit('unsubscribed:server', { serverId });
      
      logger.debug('Socket unsubscribed from server', {
        socketId: socketWithAuth.id,
        userId: socketWithAuth.userId,
        serverId
      });
    });

    // Handle ping for connection testing
    socketWithAuth.on('ping', (callback) => {
      if (!rateLimitSocketEvent(socket, 'ping', 60)) {
        return;
      }
      
      if (typeof callback === 'function') {
        callback({ timestamp: new Date().toISOString() });
      }
    });

    // Handle disconnection
    socketWithAuth.on('disconnect', (reason) => {
      logger.info('Socket disconnected', {
        socketId: socketWithAuth.id,
        userId: socketWithAuth.userId,
        reason
      });
    });

    // Handle connection errors
    socketWithAuth.on('error', (error) => {
      logger.error('Socket error', {
        socketId: socketWithAuth.id,
        userId: socketWithAuth.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    });
  });

  // Log server events
  io.engine.on('connection_error', (err) => {
    logger.error('Socket.IO connection error', {
      message: err.message,
      description: err.description,
      context: err.context,
      type: err.type
    });
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
    timestamp: new Date().toISOString()
  };
}
