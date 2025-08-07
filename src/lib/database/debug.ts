/**
 * Database Debug Utilities
 * Provides debugging tools for database connection monitoring and troubleshooting
 */

import mongoose from 'mongoose';
import { connectionManager } from './connection-manager';
import { logger } from '@/lib/logger';

export interface ConnectionDebugInfo {
  readyState: {
    value: number;
    description: string;
  };
  host: string;
  port: number;
  name: string;
  eventListeners: {
    [eventName: string]: number;
  };
  lastConnectionTime?: Date;
  uptime?: number;
  errors: number;
  memoryUsage: NodeJS.MemoryUsage;
}

export class DatabaseDebugger {
  private static instance: DatabaseDebugger;

  private constructor() {}

  static getInstance(): DatabaseDebugger {
    if (!DatabaseDebugger.instance) {
      DatabaseDebugger.instance = new DatabaseDebugger();
    }
    return DatabaseDebugger.instance;
  }

  /**
   * Get comprehensive debug information about the database connection
   */
  getDebugInfo(): ConnectionDebugInfo {
    const connection = mongoose.connection;
    const stats = connectionManager.getConnectionStats();
    
    // Get event listener counts
    const eventListeners: { [eventName: string]: number } = {};
    const events = ['connected', 'error', 'disconnected', 'reconnected', 'close', 'open'];
    
    events.forEach(eventName => {
      const listeners = connection.listenerCount(eventName);
      if (listeners > 0) {
        eventListeners[eventName] = listeners;
      }
    });

    return {
      readyState: {
        value: connection.readyState,
        description: this.getReadyStateDescription(connection.readyState)
      },
      host: connection.host || 'unknown',
      port: connection.port || 0,
      name: connection.name || 'unknown',
      eventListeners,
      lastConnectionTime: stats.lastConnectionTime,
      uptime: stats.uptime,
      errors: stats.errors,
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Log current connection status and statistics
   */
  logConnectionStatus(): void {
    const debugInfo = this.getDebugInfo();
    
    logger.info('Database connection debug info', {
      readyState: debugInfo.readyState,
      host: debugInfo.host,
      port: debugInfo.port,
      name: debugInfo.name,
      eventListeners: debugInfo.eventListeners,
      uptime: debugInfo.uptime,
      errors: debugInfo.errors,
      memoryUsageMB: {
        rss: Math.round(debugInfo.memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(debugInfo.memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(debugInfo.memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(debugInfo.memoryUsage.external / 1024 / 1024)
      }
    });
  }

  /**
   * Check for potential memory leaks in event listeners
   */
  checkForMemoryLeaks(): { hasLeaks: boolean; issues: string[] } {
    const debugInfo = this.getDebugInfo();
    const issues: string[] = [];
    let hasLeaks = false;

    // Check for excessive event listeners
    Object.entries(debugInfo.eventListeners).forEach(([eventName, count]) => {
      if (count > 10) {
        hasLeaks = true;
        issues.push(`Event '${eventName}' has ${count} listeners (max recommended: 10)`);
      }
    });

    // Check memory usage
    const memoryMB = debugInfo.memoryUsage.heapUsed / 1024 / 1024;
    if (memoryMB > 500) {
      issues.push(`High memory usage: ${Math.round(memoryMB)}MB heap used`);
    }

    // Check for connection state issues
    if (debugInfo.readyState.value === 0 && debugInfo.errors > 5) {
      hasLeaks = true;
      issues.push(`Connection disconnected with ${debugInfo.errors} errors`);
    }

    return { hasLeaks, issues };
  }

  /**
   * Force garbage collection if available
   */
  forceGarbageCollection(): void {
    if (global.gc) {
      global.gc();
      logger.info('Forced garbage collection');
    } else {
      logger.warn('Garbage collection not available (run with --expose-gc)');
    }
  }

  /**
   * Reset connection event listeners to prevent accumulation
   */
  resetEventListeners(): void {
    const connection = mongoose.connection;
    const events = ['connected', 'error', 'disconnected', 'reconnected', 'close', 'open'];
    
    logger.info('Resetting database event listeners');
    
    events.forEach(eventName => {
      const listenerCount = connection.listenerCount(eventName);
      if (listenerCount > 1) {
        connection.removeAllListeners(eventName);
        logger.warn(`Removed ${listenerCount} listeners for event '${eventName}'`);
      }
    });
  }

  /**
   * Start periodic memory leak monitoring
   */
  startMemoryLeakMonitoring(intervalMs: number = 60000): NodeJS.Timeout {
    return setInterval(() => {
      const leakCheck = this.checkForMemoryLeaks();
      
      if (leakCheck.hasLeaks) {
        logger.warn('Potential memory leaks detected', {
          issues: leakCheck.issues,
          debugInfo: this.getDebugInfo()
        });
      }
    }, intervalMs);
  }

  /**
   * Cleanup resources and stop monitoring
   */
  cleanup(): void {
    // Note: Any monitoring intervals would be cleaned up here
    logger.info('Database debugger cleanup completed');
  }

  private getReadyStateDescription(state: number): string {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    return states[state as keyof typeof states] || 'unknown';
  }
}

// Export singleton instance
export const databaseDebugger = DatabaseDebugger.getInstance();
