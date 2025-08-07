import { Socket } from 'socket.io';
import { logger } from '@/lib/logger';

interface SocketWithAuth extends Socket {
  userId?: string;
  requestId: string;
}

export async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  try {
    const socketWithAuth = socket as SocketWithAuth;
    // Generate request ID for logging
    socketWithAuth.requestId = crypto.randomUUID();
    
    // Extract auth token from handshake
    const token = socketWithAuth.handshake.auth?.token || socketWithAuth.handshake.headers?.authorization;
    
    if (!token) {
      logger.warn('Socket connection without authentication token', {
        socketId: socketWithAuth.id,
        requestId: socketWithAuth.requestId,
        ip: socketWithAuth.handshake.address
      });
      // For now, allow unauthenticated connections in development
      if (process.env.NODE_ENV === 'development') {
        socketWithAuth.userId = 'dev-user';
        return next();
      }
      return next(new Error('Authentication required'));
    }

    // Simple token validation for development
    // TODO: Implement proper JWT validation in production
    const apiKeyToUserId: Record<string, string> = {
      'warp_dev_key_123': 'dev-user',
      'warp_user_key_456': 'test-user'
    };
    
    const cleanToken = token.replace('Bearer ', '');
    const userId = apiKeyToUserId[cleanToken];
    
    if (!userId) {
      logger.warn('Invalid authentication token', {
        socketId: socketWithAuth.id,
        requestId: socketWithAuth.requestId,
        token: cleanToken.substring(0, 10) + '...'
      });
      return next(new Error('Invalid authentication token'));
    }

    socketWithAuth.userId = userId;
    
    logger.info('Socket authenticated successfully', {
      socketId: socketWithAuth.id,
      requestId: socketWithAuth.requestId,
      userId: socketWithAuth.userId,
      ip: socketWithAuth.handshake.address
    });
    
    next();
  } catch (error) {
    logger.error('Socket authentication error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      socketId: socket.id
    });
    next(new Error('Authentication failed'));
  }
}

// Rate limiting for socket events
const eventCounts = new Map<string, { count: number; resetTime: number }>();

export function rateLimitSocketEvent(socket: Socket, eventName: string, maxEvents = 100, windowMs = 60000): boolean {
  const socketWithAuth = socket as SocketWithAuth;
  const key = `${socketWithAuth.id}:${eventName}`;
  const now = Date.now();
  
  const current = eventCounts.get(key);
  if (!current || now > current.resetTime) {
    eventCounts.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  if (current.count >= maxEvents) {
    logger.warn('Socket event rate limit exceeded', {
      socketId: socketWithAuth.id,
      userId: socketWithAuth.userId,
      eventName,
      count: current.count,
      maxEvents
    });
    return false;
  }
  
  current.count++;
  return true;
}
