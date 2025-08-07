/**
 * Bulk File Actions API Endpoint
 * Handles bulk operations on file states
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { Types } from 'mongoose';
import { z } from 'zod';

interface RouteParams {
  params: {
    jobId: string;
  };
}

// Schema for bulk file actions
const BulkFileActionSchema = z.object({
  action: z.enum(['queue', 'unqueue', 'deleteLocal', 'deleteRemote', 'deleteEverywhere', 'retry']),
  fileIds: z.array(z.string().refine(id => Types.ObjectId.isValid(id), 'Invalid file ID')),
  options: z.object({
    force: z.boolean().optional().default(false),
    skipConfirmation: z.boolean().optional().default(false)
  }).optional().default({})
});

/**
 * POST /api/jobs/[jobId]/files/actions
 * Perform bulk actions on multiple files
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const timer = new PerformanceTimer();
  const logger = getRequestLogger(req);
  
  const { jobId } = params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(jobId)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Processing bulk file action', { jobId });
  
  const body = await req.json();
  const { action, fileIds, options } = BulkFileActionSchema.parse(body);
  
  await connectDB();
  const { SyncJob, FileState } = await import('@/models');
  
  // Verify job exists
  const syncJob = await SyncJob.findById(jobId);
  if (!syncJob) {
    return NextResponse.json({
      success: false,
      error: 'Sync job not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  // Verify all files belong to this job
  const files = await FileState.find({
    _id: { $in: fileIds },
    jobId: jobId
  });
  
  if (files.length !== fileIds.length) {
    return NextResponse.json({
      success: false,
      error: 'Some files not found or do not belong to this job',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  let updateQuery: any = {};
  let updateResult: any;
  let actionMessage = '';
  
  switch (action) {
    case 'queue':
      updateQuery = {
        syncState: 'queued',
        'transfer.errorMessage': null,
        'transfer.retryCount': 0
      };
      actionMessage = 'Files queued for transfer';
      break;
      
    case 'unqueue':
      updateQuery = {
        $set: {
          syncState: 'remote_only'
        },
        $unset: {
          'transfer.progress': '',
          'transfer.speed': '',
          'transfer.eta': '',
          'transfer.errorMessage': ''
        }
      };
      actionMessage = 'Files removed from queue';
      break;
      
    case 'retry':
      updateQuery = {
        syncState: 'queued',
        'transfer.errorMessage': null,
        'transfer.retryCount': 0,
        'transfer.progress': 0
      };
      actionMessage = 'Failed transfers queued for retry';
      break;
      
    case 'deleteLocal':
      // TODO: In a real implementation, this would trigger actual file deletion
      updateQuery = {
        syncState: 'remote_only',
        $unset: {
          'local.size': '',
          'local.modTime': ''
        }
      };
      actionMessage = 'Local files marked for deletion';
      break;
      
    case 'deleteRemote':
      // TODO: In a real implementation, this would trigger actual file deletion
      updateQuery = {
        syncState: 'local_only',
        $unset: {
          'remote.size': '',
          'remote.modTime': ''
        }
      };
      actionMessage = 'Remote files marked for deletion';
      break;
      
    case 'deleteEverywhere':
      // TODO: In a real implementation, this would trigger actual file deletion
      // For now, we'll remove the file state records
      updateResult = await FileState.deleteMany({
        _id: { $in: fileIds },
        jobId: jobId
      });
      actionMessage = 'Files marked for deletion everywhere';
      break;
      
    default:
      return NextResponse.json({
        success: false,
        error: 'Invalid action',
        timestamp: new Date().toISOString()
      }, { status: 400 });
  }
  
  // Apply the update if not already handled
  if (!updateResult) {
    updateResult = await FileState.updateMany(
      {
        _id: { $in: fileIds },
        jobId: jobId
      },
      updateQuery
    );
  }
  
  const result = {
    action,
    filesProcessed: action === 'deleteEverywhere' ? updateResult.deletedCount : updateResult.modifiedCount,
    totalRequested: fileIds.length,
    message: actionMessage,
    options
  };
  
  logger.info('Bulk file action completed', {
    jobId,
    action,
    filesProcessed: result.filesProcessed,
    totalRequested: fileIds.length,
    duration: timer.getDuration()
  });
  
  return NextResponse.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString()
  });
});
