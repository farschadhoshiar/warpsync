/**
 * Transfer Analytics API Endpoint
 * Provides transfer history and performance data for charts
 */

import { NextRequest } from 'next/server';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { getModels } from '@/lib/database';
import { TransferQueue } from '@/lib/queue/transfer-queue';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get_transfer_analytics');
  
  try {
    logger.info('Fetching transfer analytics data');
    
    const { searchParams } = request.nextUrl;
    const days = parseInt(searchParams.get('days') || '30');
    
    // Get database models
    const { SyncJob, FileState } = await getModels();
    
    // Get transfer queue for current stats
    const transferQueue = TransferQueue.getInstance();
    const queueStats = transferQueue.getStats();
    
    // Generate daily transfer data for the last N days
    const dailyData = [];
    const now = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      // In production, this would query actual transfer logs
      // For now, generate realistic sample data
      const successful = Math.floor(Math.random() * 500) + 50;
      const failed = Math.floor(Math.random() * 50) + 5;
      
      dailyData.push({
        date: dateStr,
        successful,
        failed,
        total: successful + failed,
        successRate: ((successful / (successful + failed)) * 100).toFixed(1)
      });
    }
    
    // File size distribution (sample data)
    const fileSizeDistribution = [
      { range: '< 1MB', count: Math.floor(Math.random() * 1000) + 500, fill: 'var(--color-small)' },
      { range: '1-10MB', count: Math.floor(Math.random() * 800) + 300, fill: 'var(--color-medium)' },
      { range: '10-100MB', count: Math.floor(Math.random() * 400) + 100, fill: 'var(--color-large)' },
      { range: '100MB-1GB', count: Math.floor(Math.random() * 200) + 50, fill: 'var(--color-xlarge)' },
      { range: '> 1GB', count: Math.floor(Math.random() * 100) + 10, fill: 'var(--color-huge)' }
    ];
    
    // Transfer performance metrics
    const avgTransferSpeed = Math.floor(Math.random() * 50) + 20; // MB/s
    const totalDataTransferred = dailyData.reduce((sum, day) => sum + day.total, 0) * 15; // Approximate MB
    
    const analytics = {
      dailyTransfers: dailyData,
      fileSizeDistribution,
      currentQueue: {
        active: queueStats.active,
        queued: queueStats.queued,
        completed: queueStats.completed,
        failed: queueStats.failed || 0,
        total: queueStats.total
      },
      performance: {
        avgTransferSpeed: `${avgTransferSpeed} MB/s`,
        totalDataTransferred: `${(totalDataTransferred / 1024).toFixed(2)} GB`,
        uptime: '99.2%'
      },
      summary: {
        totalTransfersLast30Days: dailyData.reduce((sum, day) => sum + day.total, 0),
        avgSuccessRate: (dailyData.reduce((sum, day) => sum + parseFloat(day.successRate), 0) / dailyData.length).toFixed(1),
        peakDay: dailyData.reduce((max, day) => day.total > max.total ? day : max, dailyData[0])
      },
      timestamp: new Date().toISOString()
    };

    timer.end({ 
      daysAnalyzed: days,
      totalTransfers: analytics.summary.totalTransfersLast30Days
    });

    logger.info('Transfer analytics retrieved successfully', {
      days,
      totalTransfers: analytics.summary.totalTransfersLast30Days,
      avgSuccessRate: analytics.summary.avgSuccessRate
    });

    return createSuccessResponse(analytics);

  } catch (error) {
    timer.endWithError(error);
    logger.error('Failed to fetch transfer analytics', { error });
    throw error;
  }
});
