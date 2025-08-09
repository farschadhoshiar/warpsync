/**
 * Transfer Queue Management API Endpoints
 * Handles queue operations and statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { TransferType, TransferPriority, TransferStatus } from '@/lib/queue/types';
import { z } from 'zod';

// Schema for bulk transfer addition
const BulkTransferSchema = z.object({
  transfers: z.array(z.object({
    jobId: z.string(),
    fileId: z.string(),
    type: z.enum(['download', 'upload', 'sync']),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional().default('NORMAL'),
    source: z.string(),
    destination: z.string(),
    filename: z.string(),
    relativePath: z.string(),
    size: z.number().min(0),
    sshConfig: z.object({
      host: z.string(),
      port: z.number(),
      username: z.string(),
      privateKey: z.string().optional(),
      password: z.string().optional()
    }).optional(),
    rsyncOptions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    maxRetries: z.number().min(0).optional().default(3)
  }))
});

/**
 * GET /api/queue
 * Retrieve transfer queue statistics and active transfers
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get_queue_status');
  
  logger.info('Fetching transfer queue status');
  
  try {
    // Get queue instance
    const transferQueue = TransferQueue.getInstance();
    
    // Parse query parameters for filtering
    const url = new URL(req.url);
    const status = url.searchParams.getAll('status');
    const priority = url.searchParams.getAll('priority');
    const jobId = url.searchParams.get('jobId');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    
    // Get queue statistics
    const stats = transferQueue.getStats();
    
    // Get filtered transfers
    const filters = {
      ...(status.length > 0 && { status: status as TransferStatus[] }),
      ...(priority.length > 0 && { priority: priority.map(p => TransferPriority[p as keyof typeof TransferPriority]) }),
      ...(jobId && { jobId })
    };
    
    const allTransfers = transferQueue.getTransfers(filters);
    const transfers = allTransfers.slice(offset, offset + limit);
    
    const result = {
      stats,
      transfers,
      pagination: {
        total: allTransfers.length,
        limit,
        offset,
        hasMore: offset + limit < allTransfers.length
      }
    };
    
    logger.info('Transfer queue status retrieved', {
      totalTransfers: stats.total,
      activeTransfers: stats.active,
      queuedTransfers: stats.queued,
      duration: timer.end()
    });
    
    return createSuccessResponse(result);
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});

/**
 * POST /api/queue
 * Add transfers to queue (bulk operations)
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'add_transfers_to_queue');
  
  logger.info('Adding transfers to queue');
  
  try {
    const body = await req.json();
    const { transfers } = BulkTransferSchema.parse(body);
    
    // Get queue instance
    const transferQueue = TransferQueue.getInstance();
    
    // Add transfers to queue
    const transferIds = await transferQueue.addBatch(
      transfers.map(transfer => {
        // Only include sshConfig if privateKey is provided
        const sshConfig = transfer.sshConfig && transfer.sshConfig.privateKey 
          ? {
              host: transfer.sshConfig.host,
              port: transfer.sshConfig.port,
              username: transfer.sshConfig.username,
              privateKey: transfer.sshConfig.privateKey
            }
          : undefined;

        return {
          ...transfer,
          type: transfer.type as TransferType,
          priority: TransferPriority[transfer.priority as keyof typeof TransferPriority],
          rsyncOptions: transfer.rsyncOptions as Record<string, string | number | boolean> | undefined,
          sshConfig
        };
      })
    );
    
    logger.info('Transfers added to queue', {
      transferCount: transfers.length,
      successfulTransfers: transferIds.length,
      duration: timer.end()
    });
    
    return createSuccessResponse({
      transferIds,
      totalAdded: transferIds.length,
      totalRequested: transfers.length,
      message: `Successfully added ${transferIds.length} transfers to queue`
    });
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});

/**
 * DELETE /api/queue
 * Clear queue or cancel all transfers
 */
export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'clear_transfer_queue');
  
  logger.info('Clearing transfer queue');
  
  try {
    const url = new URL(req.url);
    const clearType = url.searchParams.get('type') || 'queued'; // 'queued' | 'all'
    
    const transferQueue = TransferQueue.getInstance();
    
    // Get current queue stats
    const beforeStats = transferQueue.getStats();
    
    if (clearType === 'all') {
      // Cancel all transfers including active ones
      const allTransfers = transferQueue.getTransfers();
      const cancelPromises = allTransfers.map(transfer => 
        transferQueue.cancelTransfer(transfer.id)
      );
      await Promise.all(cancelPromises);
    } else {
      // Only clear queued transfers
      const queuedTransfers = transferQueue.getTransfers({ 
        status: [TransferStatus.QUEUED, TransferStatus.SCHEDULED]
      });
      const cancelPromises = queuedTransfers.map(transfer => 
        transferQueue.cancelTransfer(transfer.id)
      );
      await Promise.all(cancelPromises);
    }
    
    const afterStats = transferQueue.getStats();
    
    logger.info('Transfer queue cleared', {
      clearType,
      transfersCleared: beforeStats.total - afterStats.total,
      duration: timer.end()
    });
    
    return createSuccessResponse({
      cleared: beforeStats.total - afterStats.total,
      remaining: afterStats.total,
      clearType,
      message: `Cleared ${beforeStats.total - afterStats.total} transfers from queue`
    });
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});

// OPTIONS /api/queue - Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Allow': 'GET, POST, DELETE, OPTIONS'
    }
  });
}
