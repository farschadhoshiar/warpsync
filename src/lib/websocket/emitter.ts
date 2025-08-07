import { Server as SocketIOServer } from 'socket.io';
import { SocketEvents, FileStateUpdateSchema, TransferProgressSchema } from './events';
import { logger } from '@/lib/logger';

export class EventEmitter {
  private io: SocketIOServer;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  // Emit file state update to job room
  emitFileStateUpdate(data: SocketEvents['file:state:update']) {
    try {
      const validated = FileStateUpdateSchema.parse(data);
      this.io.to(`job:${data.jobId}`).emit('file:state:update', validated);
      
      logger.debug('Emitted file state update', {
        jobId: data.jobId,
        fileId: data.fileId,
        oldState: data.oldState,
        newState: data.newState
      });
    } catch (error) {
      logger.error('Failed to emit file state update', { error, data });
    }
  }

  // Emit transfer progress with throttling
  private progressThrottleMap = new Map<string, number>();
  
  emitTransferProgress(data: SocketEvents['file:transfer:progress']) {
    try {
      const validated = TransferProgressSchema.parse(data);
      const key = `${data.jobId}:${data.fileId}`;
      const now = Date.now();
      const lastEmit = this.progressThrottleMap.get(key) || 0;
      
      // Throttle progress updates to max every 500ms
      if (now - lastEmit < 500) {
        return;
      }
      
      this.progressThrottleMap.set(key, now);
      this.io.to(`job:${data.jobId}`).emit('file:transfer:progress', validated);
      
      logger.debug('Emitted transfer progress', {
        jobId: data.jobId,
        fileId: data.fileId,
        progress: data.progress
      });
    } catch (error) {
      logger.error('Failed to emit transfer progress', { error, data });
    }
  }

  // Emit scan completion
  emitScanComplete(data: SocketEvents['scan:complete']) {
    try {
      this.io.to(`job:${data.jobId}`).emit('scan:complete', data);
      
      logger.info('Emitted scan completion', {
        jobId: data.jobId,
        filesFound: data.filesFound,
        duration: data.duration
      });
    } catch (error) {
      logger.error('Failed to emit scan completion', { error, data });
    }
  }

  // Emit log message
  emitLogMessage(data: SocketEvents['log:message']) {
    try {
      if (data.jobId) {
        this.io.to(`job:${data.jobId}`).emit('log:message', data);
      } else {
        this.io.emit('log:message', data);
      }
      
      logger.debug('Emitted log message', {
        jobId: data.jobId,
        level: data.level,
        source: data.source
      });
    } catch (error) {
      logger.error('Failed to emit log message', { error, data });
    }
  }

  // Emit connection test result
  emitConnectionTest(serverId: string, data: SocketEvents['connection:test']) {
    try {
      this.io.to(`server:${serverId}`).emit('connection:test', data);
      
      logger.info('Emitted connection test result', {
        serverId,
        success: data.success,
        duration: data.duration
      });
    } catch (error) {
      logger.error('Failed to emit connection test', { error, data });
    }
  }

  // Emit error event
  emitError(data: SocketEvents['error:occurred']) {
    try {
      if (data.jobId) {
        this.io.to(`job:${data.jobId}`).emit('error:occurred', data);
      } else if (data.serverId) {
        this.io.to(`server:${data.serverId}`).emit('error:occurred', data);
      } else {
        this.io.emit('error:occurred', data);
      }
      
      logger.warn('Emitted error event', {
        type: data.type,
        message: data.message,
        jobId: data.jobId,
        serverId: data.serverId
      });
    } catch (error) {
      logger.error('Failed to emit error event', { error, data });
    }
  }
}

// Global emitter instance
let globalEmitter: EventEmitter | null = null;

export function getEventEmitter(): EventEmitter | null {
  if (typeof global !== 'undefined' && global.io) {
    if (!globalEmitter) {
      globalEmitter = new EventEmitter(global.io);
    }
    return globalEmitter;
  }
  return null;
}

// Utility function for API routes
export function emitIfAvailable<T extends keyof SocketEvents>(
  event: T,
  data: SocketEvents[T]
) {
  const emitter = getEventEmitter();
  if (emitter) {
    switch (event) {
      case 'file:state:update':
        emitter.emitFileStateUpdate(data as SocketEvents['file:state:update']);
        break;
      case 'file:transfer:progress':
        emitter.emitTransferProgress(data as SocketEvents['file:transfer:progress']);
        break;
      case 'scan:complete':
        emitter.emitScanComplete(data as SocketEvents['scan:complete']);
        break;
      case 'log:message':
        emitter.emitLogMessage(data as SocketEvents['log:message']);
        break;
      case 'error:occurred':
        emitter.emitError(data as SocketEvents['error:occurred']);
        break;
    }
  }
}
