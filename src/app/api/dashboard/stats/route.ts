/**
 * Dashboard Statistics API Endpoint
 * Provides aggregated metrics for dashboard and header components
 */

import { NextResponse } from 'next/server';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { getModels } from '@/lib/database';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { SSHConnectionManager } from '@/lib/ssh/ssh-connection';

export const GET = withErrorHandler(async () => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get_dashboard_stats');
  
  try {
    logger.info('Fetching dashboard statistics');
    
    // Get database models
    const { ServerProfile, SyncJob, FileState } = await getModels();
    
    // Get component instances for real-time data
    const transferQueue = TransferQueue.getInstance();
    const sshManager = SSHConnectionManager.getInstance();
    
    // Parallel data fetching for better performance
    const [
      totalServers,
      totalJobs,
      activeJobs,
      totalFileStates,
      queueStats,
      sshStats
    ] = await Promise.all([
      ServerProfile.countDocuments(),
      SyncJob.countDocuments(),
      SyncJob.countDocuments({ enabled: true }),
      FileState.countDocuments(),
      Promise.resolve(transferQueue.getStats()),
      Promise.resolve(sshManager.getPoolStats())
    ]);

    // Test server connections to get accurate active count
    const servers = await ServerProfile.find().lean();
    let activeServers = 0;
    
    // For now, estimate active servers based on SSH pool connections
    // In a production system, you'd want to cache this or run periodic tests
    activeServers = Math.min(sshStats.inUse, totalServers);

    const dashboardStats = {
      servers: {
        total: totalServers,
        active: activeServers,
        inactive: totalServers - activeServers
      },
      jobs: {
        total: totalJobs,
        active: activeJobs,
        inactive: totalJobs - activeJobs
      },
      transfers: {
        active: queueStats.active,
        queued: queueStats.queued,
        completed: queueStats.completed,
        total: queueStats.total
      },
      files: {
        total: totalFileStates
      },
      system: {
        sshConnections: {
          total: sshStats.total,
          active: sshStats.inUse,
          available: sshStats.available
        }
      },
      timestamp: new Date().toISOString()
    };
    



    return createSuccessResponse(dashboardStats);

  } catch (error) {
    timer.endWithError(error);
    logger.error('Failed to fetch dashboard statistics', { error });
    throw error;
  }
});
