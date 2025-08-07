/**
 * Debug Status API Endpoint
 * Simplified system status for dashboard
 */

import connectDB from '@/lib/mongodb';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { SSHConnectionManager } from '@/lib/ssh/ssh-connection';

/**
 * GET /api/debug/status
 * Get simplified system status for dashboard
 */
export const GET = withErrorHandler(async () => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get_debug_status');
  
  try {
    // Get component instances
    const transferQueue = TransferQueue.getInstance();
    const sshManager = SSHConnectionManager.getInstance();
    
    // Get SSH connection stats
    const sshStats = sshManager.getPoolStats();
    
    // Get transfer queue stats
    const queueStats = transferQueue.getStats();
    
    // Get database stats
    await connectDB();
    const { SyncJob, ServerProfile, FileState } = await import('@/models');
    
    const [jobCount, serverCount, fileStateCount] = await Promise.all([
      SyncJob.countDocuments(),
      ServerProfile.countDocuments(),
      FileState.countDocuments()
    ]);
    
    // Get memory usage
    const processMemory = process.memoryUsage();
    
    const status = {
      timestamp: new Date().toISOString(),
      ssh: {
        totalConnections: sshStats.total,
        activeConnections: sshStats.inUse,
        poolStats: {
          total: sshStats.total,
          inUse: sshStats.inUse,
          available: sshStats.available
        }
      },
      queue: {
        totalTransfers: queueStats.total,
        activeTransfers: queueStats.active,
        queuedTransfers: queueStats.queued,
        completedTransfers: queueStats.completed
      },
      database: {
        connected: true, // If we reach here, DB is connected
        collections: {
          jobs: jobCount,
          servers: serverCount,
          fileStates: fileStateCount
        }
      },
      memory: {
        used: `${Math.round(processMemory.heapUsed / 1024 / 1024)}MB`,
        free: `${Math.round((processMemory.heapTotal - processMemory.heapUsed) / 1024 / 1024)}MB`,
        total: `${Math.round(processMemory.heapTotal / 1024 / 1024)}MB`
      }
    };
    
    const duration = timer.end();
    
    logger.debug('Debug status retrieved', {
      sshConnections: sshStats.total,
      activeTransfers: queueStats.active,
      databaseCollections: jobCount + serverCount + fileStateCount,
      duration
    });
    
    return createSuccessResponse(status);
    
  } catch (error) {
    timer.endWithError(error);
    
    // Return error status
    return createSuccessResponse({
      timestamp: new Date().toISOString(),
      ssh: {
        totalConnections: 0,
        activeConnections: 0,
        poolStats: { total: 0, inUse: 0, available: 0 }
      },
      queue: {
        totalTransfers: 0,
        activeTransfers: 0,
        queuedTransfers: 0,
        completedTransfers: 0
      },
      database: {
        connected: false,
        collections: { jobs: 0, servers: 0, fileStates: 0 }
      },
      memory: {
        used: 'N/A',
        free: 'N/A',
        total: 'N/A'
      },
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
