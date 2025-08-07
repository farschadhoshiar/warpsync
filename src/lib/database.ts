/**
 * Database connection optimization utilities
 * Provides a reusable pattern for API routes to manage database connections efficiently
 */

import connectDB from './mongodb';
import { connectionManager } from './database/connection-manager';
import { logger } from './logger';

/**
 * Higher-order function that ensures database connection and model imports
 * Reduces redundant connection calls and standardizes the pattern
 */
export async function withDatabase<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    // Check connection health before proceeding
    const health = await connectionManager.performHealthCheck();
    
    if (!health.healthy) {
      logger.warn('Database connection unhealthy, attempting to reconnect', {
        error: health.error,
        connectionTime: health.connectionTime
      });
      
      // Attempt to force reconnection if health check fails
      await connectionManager.forceReconnect();
    }
    
    // Ensure database connection is established
    await connectDB();
    
    // Import models after connection to ensure they're registered
    await import('../models');
    
    // Execute the operation with timeout
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Database operation timeout')), 30000)
      )
    ]);
  } catch (error) {
    logger.error('Database operation failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stats: connectionManager.getConnectionStats()
    });
    throw error;
  }
}

/**
 * Type-safe model getter that ensures models are imported
 */
export async function getModels() {
  // Ensure database connection and model registration
  await connectDB();
  return import('../models');
}

/**
 * Get database connection statistics
 */
export function getDatabaseStats() {
  return connectionManager.getConnectionStats();
}

/**
 * Perform database health check
 */
export async function checkDatabaseHealth() {
  return connectionManager.performHealthCheck();
}
