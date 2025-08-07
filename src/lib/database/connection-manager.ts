/**
 * MongoDB Connection Manager
 * Provides centralized connection management, health monitoring, and statistics
 */

import mongoose from 'mongoose';
import { logger } from '@/lib/logger';

export interface ConnectionStats {
  isConnected: boolean;
  readyState: number;
  host: string;
  port: number;
  name: string;
  connectionCount: number;
  poolSize: {
    current: number;
    max: number;
    min: number;
  };
  lastConnectionTime?: Date;
  uptime?: number;
  errors: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  connectionTime: number;
  error?: string;
  stats: ConnectionStats;
}

export class ConnectionManager {
  private static instance: ConnectionManager;
  private connectionErrors: number = 0;
  private lastConnectionTime?: Date;
  private healthCheckInterval?: NodeJS.Timeout;

  private constructor() {
    this.setupHealthMonitoring();
  }

  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  /**
   * Get current connection statistics
   */
  getConnectionStats(): ConnectionStats {
    const connection = mongoose.connection;
    
    return {
      isConnected: connection.readyState === 1,
      readyState: connection.readyState,
      host: connection.host || 'unknown',
      port: connection.port || 0,
      name: connection.name || 'unknown',
      connectionCount: 1, // Simplified - mongoose uses a single connection
      poolSize: {
        current: connection.readyState === 1 ? 1 : 0,
        max: 50, // From our configuration
        min: 5,  // From our configuration
      },
      lastConnectionTime: this.lastConnectionTime,
      uptime: this.lastConnectionTime ? Date.now() - this.lastConnectionTime.getTime() : undefined,
      errors: this.connectionErrors
    };
  }

  /**
   * Perform a health check on the database connection
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Simple ping to test connection
      await mongoose.connection.db?.admin().ping();
      
      const connectionTime = Date.now() - startTime;
      const stats = this.getConnectionStats();
      
      return {
        healthy: true,
        connectionTime,
        stats
      };
    } catch (error) {
      const connectionTime = Date.now() - startTime;
      const stats = this.getConnectionStats();
      
      this.connectionErrors++;
      
      logger.error('Database health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        connectionTime
      });
      
      return {
        healthy: false,
        connectionTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        stats
      };
    }
  }

  /**
   * Monitor connection events and update internal state
   */
  private setupHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Monitor connection events
    mongoose.connection.on('connected', () => {
      this.lastConnectionTime = new Date();
      this.connectionErrors = 0;
      logger.info('Database connection established', this.getConnectionStats());
    });

    mongoose.connection.on('error', (error) => {
      this.connectionErrors++;
      logger.error('Database connection error', {
        error: error.message,
        errorCount: this.connectionErrors
      });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('Database connection lost', this.getConnectionStats());
    });

    mongoose.connection.on('reconnected', () => {
      this.lastConnectionTime = new Date();
      logger.info('Database reconnected', this.getConnectionStats());
    });

    // Periodic health checks every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      const health = await this.performHealthCheck();
      if (!health.healthy) {
        logger.warn('Periodic health check failed', health);
      }
    }, 30000);
  }

  /**
   * Get connection ready state as human-readable string
   */
  getReadyStateString(): string {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    return states[mongoose.connection.readyState as keyof typeof states] || 'unknown';
  }

  /**
   * Force reconnection to database
   */
  async forceReconnect(): Promise<void> {
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
      }
      
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/warpsync');
      logger.info('Force reconnection successful');
    } catch (error) {
      this.connectionErrors++;
      logger.error('Force reconnection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Cleanup resources and stop monitoring
   */
  cleanup(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }
}

// Export singleton instance
export const connectionManager = ConnectionManager.getInstance();
