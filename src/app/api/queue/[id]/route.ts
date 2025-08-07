/**
 * Individual Transfer Management API
 * Handles single transfer operations (get, pause, resume, cancel)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, createSuccessResponse, NotFoundError } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { TransferJob, TransferStatus } from '@/lib/queue/types';

/**
 * GET /api/queue/[id]
 * Get details of a specific transfer
 */
export const GET = withErrorHandler(async (
  req: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get_transfer_details');
  
  const { id } = await params;
  
  logger.info('Getting transfer details', { transferId: id });
  
  try {
    const transferQueue = TransferQueue.getInstance();
    const transfer = transferQueue.getTransfer(id);
    
    if (!transfer) {
      throw new NotFoundError(`Transfer with ID ${id} not found`);
    }
    
    // Get additional details
    const allTransfers = transferQueue.getTransfers();
    const sortedTransfers = allTransfers
      .filter(t => t.status === 'queued' || t.status === 'scheduled')
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority; // Higher priority first
        }
        return a.createdAt.getTime() - b.createdAt.getTime(); // Older first
      });
    
    const queuePosition = sortedTransfers.findIndex(t => t.id === id) + 1; // 1-based position
    
    const result = {
      transfer,
      queuePosition: queuePosition > 0 ? queuePosition : null,
      isQueued: transfer.status === 'queued' || transfer.status === 'scheduled',
      isActive: transfer.status === 'transferring' || transfer.status === 'starting',
      isCompleted: transfer.status === 'completed' || transfer.status === 'failed' || transfer.status === 'cancelled'
    };
    
    logger.info('Transfer details retrieved', {
      transferId: id,
      status: transfer.status,
      queuePosition,
      duration: timer.end()
    });
    
    return createSuccessResponse(result);
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});

/**
 * PATCH /api/queue/[id]
 * Update transfer (pause, resume, retry, change priority)
 */
export const PATCH = withErrorHandler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'update_transfer');
  
  const { id } = await params;
  
  try {
    const body = await req.json();
    const { action, priority } = body;
    
    logger.info('Updating transfer', { transferId: id, action, priority });
    
    const transferQueue = TransferQueue.getInstance();
    const transfer = transferQueue.getTransfer(id);
    
    if (!transfer) {
      throw new NotFoundError(`Transfer with ID ${id} not found`);
    }
    
    const result: { transfer: TransferJob; message: string } = { transfer, message: '' };
    
    switch (action) {
      case 'cancel':
        await transferQueue.cancelTransfer(id);
        result.message = 'Transfer cancelled successfully';
        break;
        
      case 'retry':
        // For retry, we reset the transfer to queued status manually
        // This is a workaround since retryTransfer method doesn't exist yet
        if (transfer.status === TransferStatus.FAILED || transfer.status === TransferStatus.CANCELLED) {
          transfer.status = TransferStatus.QUEUED;
          transfer.retryCount = (transfer.retryCount || 0) + 1;
          transfer.error = undefined;
          result.message = 'Transfer queued for retry';
        } else {
          throw new Error('Transfer can only be retried if it has failed or been cancelled');
        }
        break;
        
      default:
        throw new Error(`Action '${action}' is not supported. Available actions: cancel, retry. Note: pause, resume, and priority updates will be available in a future version.`);
    }
    
    // Get updated transfer details
    const updatedTransfer = transferQueue.getTransfer(id);
    if (updatedTransfer) {
      result.transfer = updatedTransfer;
    }
    
    logger.info('Transfer updated successfully', {
      transferId: id,
      action,
      newStatus: result.transfer?.status,
      duration: timer.end()
    });
    
    return createSuccessResponse(result);
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});

/**
 * DELETE /api/queue/[id]
 * Cancel a specific transfer
 */
export const DELETE = withErrorHandler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'cancel_transfer');
  
  const { id } = await params;
  
  logger.info('Cancelling transfer', { transferId: id });
  
  try {
    const transferQueue = TransferQueue.getInstance();
    const transfer = transferQueue.getTransfer(id);
    
    if (!transfer) {
      throw new NotFoundError(`Transfer with ID ${id} not found`);
    }
    
    const wasActive = transfer.status === 'transferring' || transfer.status === 'starting';
    
    await transferQueue.cancelTransfer(id);
    
    logger.info('Transfer cancelled successfully', {
      transferId: id,
      wasActive,
      duration: timer.end()
    });
    
    return createSuccessResponse({
      transferId: id,
      cancelled: true,
      wasActive,
      message: 'Transfer cancelled successfully'
    });
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});

// OPTIONS /api/queue/[id] - Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Allow': 'GET, PATCH, DELETE, OPTIONS'
    }
  });
}
