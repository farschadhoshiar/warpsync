/**
 * Unified Download API Endpoint
 * Handles all download scenarios through a single interface
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { getDownloadService, UnifiedDownloadSchema } from '@/lib/services/download-service';
import { EventEmitter } from '@/lib/websocket/emitter';
import { withMiddleware } from '@/lib/auth/middleware';

/**
 * POST /api/downloads
 * Unified download endpoint
 */
export const POST = withMiddleware(
  withErrorHandler(async (req: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, 'unified_download');
    
    try {
      logger.info('Processing unified download request');
      
      const body = await req.json();
      const parsedRequest = UnifiedDownloadSchema.parse(body);
      
      logger.info('Unified download request validated', {
        source: parsedRequest.source,
        scope: parsedRequest.scope,
        targetCount: parsedRequest.targets.length,
        hasOptions: !!parsedRequest.options,
        options: parsedRequest.options
      });

      // Get download service with Socket.IO event emitter
      const eventEmitter = global.io ? new EventEmitter(global.io) : undefined;
      const downloadService = getDownloadService(eventEmitter);

      // Process the download request
      const result = await downloadService.processDownload(parsedRequest);

      if (!result.success) {
        logger.error('Unified download request failed', {
          errors: result.errors,
          warnings: result.warnings,
          duration: timer.end()
        });

        return NextResponse.json({
          success: false,
          error: result.errors?.[0] || 'Download request failed',
          errors: result.errors,
          warnings: result.warnings,
          timestamp: result.timestamp
        }, { status: 400 });
      }

      logger.info('Unified download request completed successfully', {
        transferIds: result.data.transferIds,
        queuedCount: result.data.queuedCount,
        skippedCount: result.data.skippedCount,
        upgradedCount: result.data.upgradedCount,
        totalSize: result.data.totalSize,
        duration: timer.end()
      });

      return createSuccessResponse({
        transferIds: result.data.transferIds,
        queuedCount: result.data.queuedCount,
        skippedCount: result.data.skippedCount,
        upgradedCount: result.data.upgradedCount,
        totalSize: result.data.totalSize,
        estimatedDuration: result.data.estimatedDuration,
        message: result.data.message,
        warnings: result.warnings
      });

    } catch (error) {
      timer.endWithError(error);
      
      logger.error('Unified download request error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw error;
    }
  }),
  {
    auth: 'optional', // Allow both authenticated and unauthenticated access
    rateLimit: { limit: 50, windowMs: 15 * 60 * 1000 }, // 50 requests per 15 minutes
    validateSize: 1024 * 1024 // 1MB max request size
  }
);

/**
 * GET /api/downloads
 * Get download queue information and statistics
 */
export const GET = withMiddleware(
  withErrorHandler(async (req: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, 'get_download_stats');
    
    try {
      const url = new URL(req.url);
      const jobId = url.searchParams.get('jobId');
      const status = url.searchParams.get('status');
      
      logger.info('Getting download queue information', { jobId, status });

      // Get download service
      const eventEmitter = global.io ? new EventEmitter(global.io) : undefined;
      const downloadService = getDownloadService(eventEmitter);
      
      // This would require additional methods in the download service
      // For now, return basic queue stats
      const { TransferQueue } = await import('@/lib/queue/transfer-queue');
      const transferQueue = TransferQueue.getInstance();
      const stats = transferQueue.getStats();
      
      let transfers = transferQueue.getTransfers();
      
      // Apply filters
      if (jobId) {
        transfers = transfers.filter(t => t.jobId === jobId);
      }
      
      if (status) {
        transfers = transfers.filter(t => t.status === status);
      }

      const response = {
        stats,
        transfers: transfers.map(t => ({
          id: t.id,
          jobId: t.jobId,
          fileId: t.fileId,
          filename: t.filename,
          status: t.status,
          priority: t.priority,
          progress: t.progress,
          size: t.size,
          createdAt: t.createdAt,
          startedAt: t.startedAt,
          completedAt: t.completedAt
        })),
        totalCount: transfers.length
      };

      logger.info('Download queue information retrieved', {
        totalTransfers: transfers.length,
        queueStats: stats,
        duration: timer.end()
      });

      return createSuccessResponse(response);

    } catch (error) {
      timer.endWithError(error);
      throw error;
    }
  }),
  {
    auth: 'optional',
    rateLimit: { limit: 100, windowMs: 15 * 60 * 1000 }
  }
);

/**
 * DELETE /api/downloads
 * Cancel multiple downloads
 */
export const DELETE = withMiddleware(
  withErrorHandler(async (req: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, 'cancel_downloads');
    
    try {
      const body = await req.json();
      const { transferIds } = body;
      
      if (!Array.isArray(transferIds) || transferIds.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'transferIds array is required'
        }, { status: 400 });
      }

      logger.info('Cancelling multiple downloads', { transferIds });

      const { TransferQueue } = await import('@/lib/queue/transfer-queue');
      const transferQueue = TransferQueue.getInstance();
      
      const results = [];
      for (const transferId of transferIds) {
        try {
          const cancelled = await transferQueue.cancelTransfer(transferId);
          results.push({
            transferId,
            cancelled,
            error: cancelled ? null : 'Transfer not found or could not be cancelled'
          });
        } catch (error) {
          results.push({
            transferId,
            cancelled: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      const successCount = results.filter(r => r.cancelled).length;
      const failureCount = results.length - successCount;

      logger.info('Bulk cancel operation completed', {
        totalRequested: transferIds.length,
        successCount,
        failureCount,
        duration: timer.end()
      });

      return createSuccessResponse({
        cancelled: successCount,
        failed: failureCount,
        results,
        message: `Cancelled ${successCount} of ${transferIds.length} transfers`
      });

    } catch (error) {
      timer.endWithError(error);
      throw error;
    }
  }),
  {
    auth: 'optional',
    rateLimit: { limit: 20, windowMs: 15 * 60 * 1000 }
  }
);

/**
 * OPTIONS /api/downloads
 * Handle preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
