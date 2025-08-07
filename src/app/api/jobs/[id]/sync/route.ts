/**
 * Sync Job Sync Operation Endpoint
 * Handles manual sync operation triggers for a specific sync job
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { Types } from 'mongoose';
import { z } from 'zod';

interface RouteParams {
  params: {
    id: string;
  };
}

// Schema for sync operation options
const SyncOptionsSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  force: z.boolean().optional().default(false),
  fileIds: z.array(z.string()).optional(),
  syncType: z.enum(['all', 'queued', 'selected']).optional().default('queued')
});

/**
 * POST /api/jobs/[id]/sync
 * Trigger a manual sync operation for a sync job
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const timer = new PerformanceTimer();
  const logger = getRequestLogger(req);
  
  const { id } = params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Triggering manual sync for sync job', { jobId: id });
  
  // Parse request body
  const body = await req.json().catch(() => ({}));
  const options = SyncOptionsSchema.parse(body);
  
  await connectDB();
  const { SyncJob, FileState } = await import('@/models');
  
  // Check if job exists and is enabled
  const syncJob = await SyncJob.findById(id)
    .populate('serverProfileId', 'name address port user authMethod');
  
  if (!syncJob) {
    return NextResponse.json({
      success: false,
      error: 'Sync job not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  if (!syncJob.enabled) {
    return NextResponse.json({
      success: false,
      error: 'Cannot sync disabled sync job',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  // Build filter for files to sync
  let fileFilter: any = { jobId: id };
  
  switch (options.syncType) {
    case 'all':
      fileFilter.syncState = { $in: ['remote_only', 'desynced', 'queued'] };
      break;
    case 'queued':
      fileFilter.syncState = 'queued';
      break;
    case 'selected':
      if (!options.fileIds || options.fileIds.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'No files selected for sync',
          timestamp: new Date().toISOString()
        }, { status: 400 });
      }
      fileFilter._id = { $in: options.fileIds };
      break;
  }
  
  // Get files to sync
  const filesToSync = await FileState.find(fileFilter).lean();
  
  if (filesToSync.length === 0) {
    return NextResponse.json({
      success: false,
      error: 'No files found matching sync criteria',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  // If not a dry run, update file states to 'transferring'
  if (!options.dryRun) {
    await FileState.updateMany(
      fileFilter,
      { 
        syncState: 'transferring',
        'transfer.progress': 0,
        'transfer.speed': '',
        'transfer.eta': '',
        'transfer.errorMessage': null
      }
    );
  }
  
  // TODO: In a real implementation, this would trigger the actual sync process
  // For now, we'll simulate the sync operation
  const syncResult = {
    jobId: id,
    jobName: syncJob.name,
    remotePath: syncJob.remotePath,
    localPath: syncJob.localPath,
    syncStarted: new Date().toISOString(),
    options,
    filesToSync: filesToSync.length,
    status: options.dryRun ? 'dry-run-complete' : 'initiated',
    message: options.dryRun 
      ? `Dry run complete: ${filesToSync.length} files would be synced`
      : `Sync operation initiated for ${filesToSync.length} files`
  };
  
  logger.info('Manual sync triggered successfully', {
    jobId: id,
    jobName: syncJob.name,
    filesToSync: filesToSync.length,
    syncType: options.syncType,
    dryRun: options.dryRun,
    duration: timer.getDuration()
  });
  
  return NextResponse.json({
    success: true,
    data: syncResult,
    timestamp: new Date().toISOString()
  });
});
