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
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { TransferType, TransferPriority } from '@/lib/queue/types';

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
export const POST = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'manual-sync');
  
  const { id } = await params;
  
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
  const fileFilter: Record<string, unknown> = { jobId: id };
  
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
  
  // If not a dry run, start the actual transfer process
  if (!options.dryRun) {
    try {
      // Initialize transfer queue
      const transferQueue = new TransferQueue();
      
      // Get server profile for SSH connection
      const serverProfile = syncJob.serverProfileId;
      if (!serverProfile) {
        return NextResponse.json({
          success: false,
          error: 'Server profile not found for sync job',
          timestamp: new Date().toISOString()
        }, { status: 400 });
      }

      // Build SSH config
      const serverAuth = serverProfile.authMethod === 'password' 
        ? { password: serverProfile.password }
        : { privateKey: serverProfile.privateKey };

      // Enqueue files for transfer
      for (const file of filesToSync) {
        const fileDoc = file as unknown as { _id: { toString(): string }; filename: string; relativePath: string; remote?: { size?: number } };
        await transferQueue.addTransfer({
          jobId: syncJob._id.toString(),
          fileId: fileDoc._id.toString(),
          type: TransferType.DOWNLOAD,
          priority: TransferPriority.NORMAL,
          source: syncJob.remotePath + '/' + fileDoc.relativePath,
          destination: syncJob.localPath + '/' + fileDoc.relativePath,
          filename: fileDoc.filename,
          relativePath: fileDoc.relativePath,
          size: fileDoc.remote?.size || 0,
          sshConfig: {
            host: serverProfile.address,
            port: serverProfile.port,
            username: serverProfile.user,
            ...serverAuth
          },
          maxRetries: 3
        });
      }

      logger.info('Files enqueued for transfer', {
        jobId: id,
        fileCount: filesToSync.length
      });

    } catch (error: unknown) {
      logger.error('Failed to enqueue files for transfer', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error)
      });

      return NextResponse.json({
        success: false,
        error: 'Failed to initiate file transfers',
        timestamp: new Date().toISOString()
      }, { status: 500 });
    }
  }
  
  // Return sync operation result
  const syncResult = {
    jobId: id,
    jobName: syncJob.name,
    remotePath: syncJob.remotePath,
    localPath: syncJob.localPath,
    syncStarted: new Date().toISOString(),
    options,
    filesToSync: filesToSync.length,
    status: options.dryRun ? 'dry-run-complete' : 'queued',
    message: options.dryRun 
      ? `Dry run complete: ${filesToSync.length} files would be synced`
      : `${filesToSync.length} files added to transfer queue`
  };
  
  logger.info('Manual sync triggered successfully', {
    jobId: id,
    fileCount: filesToSync.length,
    dryRun: options.dryRun,
    duration: timer.end()
  });
  
  return NextResponse.json({
    success: true,
    data: syncResult,
    timestamp: new Date().toISOString()
  });
});
