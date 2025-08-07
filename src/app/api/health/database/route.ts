/**
 * Database Health Check API Endpoint
 * Provides real-time database connection status and statistics
 */

import { NextResponse } from 'next/server';
import { connectionManager } from '@/lib/database/connection-manager';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger } from '@/lib/logger/request';

/**
 * GET /api/health/database
 * Check database connection health and get statistics
 */
export const GET = withErrorHandler(async () => {
  const logger = await getRequestLogger();
  
  try {
    const healthCheck = await connectionManager.performHealthCheck();
    const stats = connectionManager.getConnectionStats();
    const readyState = connectionManager.getReadyStateString();
    
    logger.info('Database health check completed', {
      healthy: healthCheck.healthy,
      connectionTime: healthCheck.connectionTime,
      readyState
    });
    
    return NextResponse.json({
      success: true,
      data: {
        healthy: healthCheck.healthy,
        readyState,
        connectionTime: healthCheck.connectionTime,
        stats,
        error: healthCheck.error
      },
      timestamp: new Date().toISOString()
    }, {
      status: healthCheck.healthy ? 200 : 503
    });
    
  } catch (error) {
    logger.error('Database health check failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json({
      success: false,
      error: 'Database health check failed',
      data: {
        healthy: false,
        readyState: connectionManager.getReadyStateString(),
        stats: connectionManager.getConnectionStats()
      },
      timestamp: new Date().toISOString()
    }, { status: 503 });
  }
});
