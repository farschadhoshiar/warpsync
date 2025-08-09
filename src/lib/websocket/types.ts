/**
 * Socket.IO Type Definitions for WarpSync
 *
 * This file contains comprehensive TypeScript interfaces for Socket.IO event handlers
 * and data structures. All callback functions defined here are CLIENT-SIDE event handlers,
 * not Next.js Server Actions.
 */

/**
 * Utility type for client-side Socket.IO event callbacks
 * These are NOT Server Actions - they execute in the browser
 */
export type ClientCallback<T = any> = (data: T) => void;

/**
 * Base interface for all Socket.IO event data
 */
export interface BaseEventData {
  timestamp?: number;
  eventId?: string;
}

/**
 * Job-related event data interfaces
 */
export interface JobProgressData extends BaseEventData {
  jobId: string;
  transferId?: string;
  fileId?: string;
  progress?: number;
  percentage?: number;
  speed?: string;
  eta?: string;
  bytesTransferred?: number;
  totalBytes?: number;
  currentFile?: string;
}

export interface JobStatusData extends BaseEventData {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  message?: string;
  details?: Record<string, any>;
}

export interface JobErrorData extends BaseEventData {
  jobId: string;
  type: 'validation' | 'transfer' | 'connection' | 'system' | 'unknown';
  message: string;
  details?: {
    code?: string;
    stack?: string;
    context?: Record<string, any>;
  };
}

export interface JobCompleteData extends BaseEventData {
  jobId: string;
  success: boolean;
  stats?: {
    totalFiles?: number;
    totalBytes?: number;
    duration?: number;
    averageSpeed?: string;
  };
  message?: string;
}

/**
 * Server-related event data interfaces
 */
export interface ServerStatusData extends BaseEventData {
  serverId: string;
  status: 'online' | 'offline' | 'maintenance' | 'error';
  uptime?: number;
  lastSeen?: string;
  message?: string;
}

export interface ServerMetricsData extends BaseEventData {
  serverId: string;
  metrics: {
    cpu?: number;
    memory?: number;
    disk?: number;
    network?: {
      bytesIn?: number;
      bytesOut?: number;
    };
    activeConnections?: number;
    activeTransfers?: number;
  };
}

export interface ServerAlertData extends BaseEventData {
  serverId: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  alertType: 'performance' | 'security' | 'system' | 'network';
  details?: Record<string, any>;
}

/**
 * Client-side Socket.IO event handler interfaces
 *
 * These interfaces define callback functions that execute in the browser
 * in response to Socket.IO events. They are NOT Next.js Server Actions.
 */

/**
 * Job event handlers - all callbacks execute CLIENT-SIDE
 */
export interface JobEventHandlers {
  /**
   * Called when job progress updates are received
   * @client-side This callback executes in the browser
   */
  onProgress?: ClientCallback<JobProgressData>;

  /**
   * Called when job status changes
   * @client-side This callback executes in the browser
   */
  onStatusChange?: ClientCallback<JobStatusData>;

  /**
   * Called when job errors occur
   * @client-side This callback executes in the browser
   */
  onError?: ClientCallback<JobErrorData>;

  /**
   * Called when job completes
   * @client-side This callback executes in the browser
   */
  onComplete?: ClientCallback<JobCompleteData>;
}

/**
 * Server event handlers - all callbacks execute CLIENT-SIDE
 */
export interface ServerEventHandlers {
  /**
   * Called when server status changes
   * @client-side This callback executes in the browser
   */
  onStatusChange?: ClientCallback<ServerStatusData>;

  /**
   * Called when server metrics are updated
   * @client-side This callback executes in the browser
   */
  onMetricsUpdate?: ClientCallback<ServerMetricsData>;

  /**
   * Called when server alerts are received
   * @client-side This callback executes in the browser
   */
  onAlert?: ClientCallback<ServerAlertData>;
}

/**
 * Socket.IO event map for type safety
 */
export interface SocketIOEventMap {
  // Job events
  'job:progress': JobProgressData;
  'job:status': JobStatusData;
  'job:error': JobErrorData;
  'job:complete': JobCompleteData;

  // Server events
  'server:status': ServerStatusData;
  'server:metrics': ServerMetricsData;
  'server:alert': ServerAlertData;

  // Connection events
  'connect': void;
  'disconnect': string;
  'connect_error': Error;
  'reconnect': number;
  'reconnect_error': Error;

  // Room events
  'room:joined': {
    roomName: string;
    jobId?: string;
    serverId?: string;
    type: string;
  };
  'room:error': {
    message: string;
    jobId?: string;
    type: string;
  };
}

/**
 * Utility types for event handler management
 */
export type EventHandler<T = any> = (data: T) => void;
export type EventHandlerTuple = [string, EventHandler];
export type EventHandlerMap = Map<string, EventHandler[]>;

/**
 * Hook configuration interfaces
 */
export interface WebSocketHookConfig {
  autoConnect?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
}

/**
 * WebSocket context interface
 */
export interface WebSocketContextType {
  socket: any | null; // Socket from socket.io-client
  isConnected: boolean;
  connectionError: string | null;
  currentRooms: Set<string>;
  reconnectCount: number;

  // Event management methods
  subscribe: (event: string, handler: EventHandler) => void;
  unsubscribe: (event: string, handler: EventHandler) => void;
  emit: (event: string, data?: unknown) => void;

  // Connection management
  reconnect: () => void;
  disconnect: () => void;
}
