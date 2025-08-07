/**
 * Database Debug API Endpoint
 * Provides debugging information about database connections and potential memory leaks
 */

import { NextRequest, NextResponse } from 'next/server';
import { databaseDebugger } from '@/lib/database/debug';
import { connectionManager } from '@/lib/database/connection-manager';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger } from '@/lib/logger/request';

/**
 * GET /api/debug/database
 * Get comprehensive database debug information
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    
    // Handle special debug actions
    if (action === 'gc') {
      databaseDebugger.forceGarbageCollection();
      return NextResponse.json({
        success: true,
        message: 'Garbage collection triggered',
        timestamp: new Date().toISOString()
      });
    }
    
    if (action === 'reset-listeners') {
      databaseDebugger.resetEventListeners();
      return NextResponse.json({
        success: true,
        message: 'Event listeners reset',
        timestamp: new Date().toISOString()
      });
    }
    
    // Get debug information
    const debugInfo = databaseDebugger.getDebugInfo();
    const connectionStats = connectionManager.getConnectionStats();
    const memoryLeakCheck = databaseDebugger.checkForMemoryLeaks();
    const healthCheck = await connectionManager.performHealthCheck();
    
    logger.info('Database debug information requested', {
      hasMemoryLeaks: memoryLeakCheck.hasLeaks,
      eventListenerCount: Object.keys(debugInfo.eventListeners).length,
      healthy: healthCheck.healthy
    });
    
    return NextResponse.json({
      success: true,
      data: {
        debug: debugInfo,
        stats: connectionStats,
        health: healthCheck,
        memoryLeakCheck,
        recommendations: generateRecommendations(debugInfo, memoryLeakCheck)
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Database debug request failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json({
      success: false,
      error: 'Failed to get database debug information',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});

/**
 * POST /api/debug/database
 * Perform debug actions like cleanup or health checks
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  
  try {
    const body = await req.json();
    const { action } = body;
    
    switch (action) {
      case 'health-check':
        const health = await connectionManager.performHealthCheck();
        return NextResponse.json({
          success: true,
          data: health,
          timestamp: new Date().toISOString()
        });
        
      case 'force-reconnect':
        await connectionManager.forceReconnect();
        return NextResponse.json({
          success: true,
          message: 'Database reconnection forced',
          timestamp: new Date().toISOString()
        });
        
      case 'memory-check':
        const memoryCheck = databaseDebugger.checkForMemoryLeaks();
        return NextResponse.json({
          success: true,
          data: memoryCheck,
          timestamp: new Date().toISOString()
        });
        
      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid action. Supported actions: health-check, force-reconnect, memory-check',
          timestamp: new Date().toISOString()
        }, { status: 400 });
    }
    
  } catch (error) {
    logger.error('Database debug action failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json({
      success: false,
      error: 'Failed to perform debug action',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});

function generateRecommendations(
  debugInfo: ReturnType<typeof databaseDebugger.getDebugInfo>, 
  memoryLeakCheck: ReturnType<typeof databaseDebugger.checkForMemoryLeaks>
): string[] {
  const recommendations: string[] = [];
  
  if (memoryLeakCheck.hasLeaks) {
    recommendations.push('Memory leaks detected - consider restarting the application');
  }
  
  if (Object.keys(debugInfo.eventListeners).length > 5) {
    recommendations.push('High number of event listener types - monitor for accumulation');
  }
  
  if (debugInfo.errors > 10) {
    recommendations.push('High error count - investigate connection stability');
  }
  
  const memoryMB = debugInfo.memoryUsage.heapUsed / 1024 / 1024;
  if (memoryMB > 200) {
    recommendations.push('High memory usage - consider optimizing queries or restarting');
  }
  
  if (debugInfo.readyState.value !== 1) {
    recommendations.push('Database not connected - check connection configuration');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('Database connection appears healthy');
  }
  
  return recommendations;
}
