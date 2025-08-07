/**
 * Transfer Queue Statistics API
 * Real-time statistics and monitoring endpoints
 */

import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { TransferStatus, TransferPriority } from '@/lib/queue/types';

/**
 * GET /api/queue/stats
 * Get comprehensive queue statistics and health metrics
 */
export const GET = withErrorHandler(async () => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get_queue_stats');
  
  logger.info('Fetching queue statistics');
  
  try {
    const transferQueue = TransferQueue.getInstance();
    
    // Get basic stats
    const basicStats = transferQueue.getStats();
    
    // Get all transfers for detailed analysis
    const allTransfers = transferQueue.getTransfers();
    
    // Calculate additional metrics
    const now = new Date().getTime();
    const hourAgo = now - (60 * 60 * 1000);
    const dayAgo = now - (24 * 60 * 60 * 1000);
    
    // Recent activity metrics
    const recentTransfers = allTransfers.filter(t => 
      t.createdAt.getTime() > hourAgo
    );
    
    const completedToday = allTransfers.filter(t => 
      t.completedAt && 
      t.completedAt.getTime() > dayAgo &&
      t.status === TransferStatus.COMPLETED
    );
    
    const failedToday = allTransfers.filter(t => 
      t.completedAt && 
      t.completedAt.getTime() > dayAgo &&
      t.status === TransferStatus.FAILED
    );
    
    // Priority distribution
    const priorityStats = {
      [TransferPriority.URGENT]: 0,
      [TransferPriority.HIGH]: 0,
      [TransferPriority.NORMAL]: 0,
      [TransferPriority.LOW]: 0
    };
    
    allTransfers.forEach(transfer => {
      priorityStats[transfer.priority]++;
    });
    
    // Queue position analysis
    const queuedTransfers = allTransfers
      .filter(t => t.status === TransferStatus.QUEUED || t.status === TransferStatus.SCHEDULED)
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
    
    // Calculate average transfer time for completed transfers
    const completedTransfers = allTransfers.filter(t => 
      t.status === TransferStatus.COMPLETED && 
      t.startedAt && 
      t.completedAt
    );
    
    const averageTransferTime = completedTransfers.length > 0
      ? completedTransfers.reduce((sum, t) => 
          sum + (t.completedAt!.getTime() - t.startedAt!.getTime()), 0
        ) / completedTransfers.length
      : 0;
    
    // Throughput calculation (bytes per second over last hour)
    const recentCompleted = allTransfers.filter(t => 
      t.status === TransferStatus.COMPLETED &&
      t.completedAt &&
      t.completedAt.getTime() > hourAgo
    );
    
    const totalBytesRecentlyTransferred = recentCompleted.reduce((sum, t) => sum + t.size, 0);
    const currentThroughput = recentCompleted.length > 0 
      ? totalBytesRecentlyTransferred / (60 * 60) // bytes per second
      : 0;
    
    // Estimate completion times for queued transfers
    const estimatedCompletionTimes = queuedTransfers.slice(0, 10).map((transfer, index) => ({
      transferId: transfer.id,
      filename: transfer.filename,
      queuePosition: index + 1,
      estimatedStartTime: averageTransferTime > 0 
        ? new Date(now + (index * averageTransferTime))
        : null,
      estimatedCompletionTime: averageTransferTime > 0
        ? new Date(now + ((index + 1) * averageTransferTime))
        : null
    }));
    
    const result = {
      // Basic queue stats
      basic: basicStats,
      
      // Activity metrics
      activity: {
        transfersLastHour: recentTransfers.length,
        completedToday: completedToday.length,
        failedToday: failedToday.length,
        successRate: completedToday.length + failedToday.length > 0 
          ? (completedToday.length / (completedToday.length + failedToday.length)) * 100 
          : 0
      },
      
      // Priority distribution
      priorities: {
        urgent: priorityStats[TransferPriority.URGENT],
        high: priorityStats[TransferPriority.HIGH],
        normal: priorityStats[TransferPriority.NORMAL],
        low: priorityStats[TransferPriority.LOW]
      },
      
      // Performance metrics
      performance: {
        averageTransferTimeMs: Math.round(averageTransferTime),
        currentThroughputBytesPerSec: Math.round(currentThroughput),
        totalCompletedTransfers: completedTransfers.length,
        totalFailedTransfers: allTransfers.filter(t => t.status === TransferStatus.FAILED).length
      },
      
      // Queue analysis
      queueAnalysis: {
        nextTransfers: estimatedCompletionTimes,
        oldestQueuedTransfer: queuedTransfers.length > 0 
          ? queuedTransfers[queuedTransfers.length - 1].createdAt
          : null,
        averageQueueWaitTime: queuedTransfers.length > 0
          ? queuedTransfers.reduce((sum, t) => sum + (now - t.createdAt.getTime()), 0) / queuedTransfers.length
          : 0
      },
      
      // Health indicators
      health: {
        status: basicStats.failed > basicStats.completed ? 'warning' : 'healthy',
        issues: [] as string[]
      }
    };
    
    // Add health issues
    if (basicStats.failed > basicStats.completed) {
      result.health.issues.push('High failure rate detected');
    }
    
    if (queuedTransfers.length > 100) {
      result.health.issues.push('Large queue backlog');
    }
    
    if (result.queueAnalysis.averageQueueWaitTime > 60 * 60 * 1000) { // 1 hour
      result.health.issues.push('Long queue wait times');
    }
    
    logger.info('Queue statistics calculated', {
      totalTransfers: basicStats.total,
      activeTransfers: basicStats.active,
      queuedTransfers: basicStats.queued,
      healthStatus: result.health.status,
      duration: timer.end()
    });
    
    return createSuccessResponse(result);
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});
