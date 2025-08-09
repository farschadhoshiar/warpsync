/**
 * General Download API Endpoint
 * Handles all download scenarios through unified interface
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { getDownloadService, UnifiedDownloadSchema } from '@/lib/services/download-service';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { EventEmitter } from '@/lib/websocket/emitter';
import { withMiddleware } from '@/lib/auth/middleware';

/**
 * POST /api/download
 * Universal download endpoint supporting all download scenarios
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
        targetsCount: parsedRequest.targets.length,
        jobId: parsedRequest.options?.jobId,
        priority: parsedRequest.options?.priority,
        dryRun: parsedRequest.options?.dryRun
      });

      // Get download service with Socket.IO event emitter
      const eventEmitter = global.io ? new EventEmitter(global.io) : undefined;
      const downloadService = getDownloadService(eventEmitter);

      // Process the download request
      const result = await downloadService.processDownload(parsedRequest);

      if (!result.success) {
        logger.error('Unified download request failed', {
          scope: parsedRequest.scope,
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
        scope: parsedRequest.scope,
        queuedCount: result.data.queuedCount,
        skippedCount: result.data.skippedCount,
        upgradedCount: result.data.upgradedCount,
        totalSize: result.data.totalSize,
        transferIds: result.data.transferIds.slice(0, 5), // Log first 5 IDs only
        duration: timer.end()
      });

      return createSuccessResponse({
        ...result.data,
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
    auth: 'optional',
    rateLimit: { limit: 50, windowMs: 15 * 60 * 1000 }, // 50 requests per 15 minutes
    validateSize: 2 * 1024 * 1024 // 2MB max request size for batch operations
  }
);

/**
 * GET /api/download/status/:transferId
 * Get status of a specific download transfer
 */
export async function GET(req: NextRequest) {
  const logger = await getRequestLogger();
  
  try {
    const url = new URL(req.url);
    const transferId = url.pathname.split('/').pop();
    
    if (!transferId) {
      return NextResponse.json({
        success: false,
        error: 'Transfer ID is required'
      }, { status: 400 });
    }

    // Get download service
    const eventEmitter = global.io ? new EventEmitter(global.io) : undefined;
    const transferQueue = TransferQueue.getInstance(undefined, undefined, eventEmitter);
    
    // Get transfer status
    const status = transferQueue.getTransfer(transferId);
    
    if (!status) {
      return NextResponse.json({
        success: false,
        error: 'Transfer not found'
      }, { status: 404 });
    }

    return createSuccessResponse(status);

  } catch (error) {
    logger.error('Error getting transfer status', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json({
      success: false,
      error: 'Failed to get transfer status'
    }, { status: 500 });
  }
}

/**
 * DELETE /api/download/:transferId
 * Cancel a specific download transfer
 */
export async function DELETE(req: NextRequest) {
  const logger = await getRequestLogger();
  
  try {
    const url = new URL(req.url);
    const transferId = url.pathname.split('/').pop();
    
    if (!transferId) {
      return NextResponse.json({
        success: false,
        error: 'Transfer ID is required'
      }, { status: 400 });
    }

    // Get download service
    const eventEmitter = global.io ? new EventEmitter(global.io) : undefined;
    const transferQueue = TransferQueue.getInstance(undefined, undefined, eventEmitter);
    
    // Cancel transfer
    const cancelled = await transferQueue.cancelTransfer(transferId);
    
    if (!cancelled) {
      return NextResponse.json({
        success: false,
        error: 'Transfer not found or could not be cancelled'
      }, { status: 404 });
    }

    logger.info('Transfer cancelled successfully', { transferId });

    return createSuccessResponse({
      message: 'Transfer cancelled successfully',
      transferId
    });

  } catch (error) {
    logger.error('Error cancelling transfer', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json({
      success: false,
      error: 'Failed to cancel transfer'
    }, { status: 500 });
  }
}

/**
 * OPTIONS /api/download
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
