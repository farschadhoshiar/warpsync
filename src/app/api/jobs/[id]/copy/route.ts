/**
 * Copy Job Trigger Endpoint
 * Handles triggering copy jobs for remote-only files in a sync job
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { TransferType, TransferPriority } from '@/lib/queue/types';
import { Types } from 'mongoose';

/**
 * POST /api/jobs/[id]/copy
 * Queue remote-only files for download/transfer
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'copy-job-trigger');
  
  const { id } = await params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Triggering copy job for sync job', { jobId: id });
  
  await connectDB();
  const { SyncJob, FileState } = await import('@/models');
  
  // Check if job exists and is enabled
  const syncJob = await SyncJob.findById(id)
    .populate('serverProfileId', 'name address port user authMethod password privateKey');
  
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
      error: 'Cannot start copy for disabled sync job',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  // Get all remote-only files for this job
  const remoteOnlyFiles = await FileState.find({
    jobId: id,
    syncState: 'remote_only'
  });
  
  if (remoteOnlyFiles.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        message: 'No remote-only files found to copy',
        queuedFiles: 0
      },
      timestamp: new Date().toISOString()
    });
  }
  
  // Get server profile for transfer configuration
  const serverProfile = syncJob.serverProfileId;
  if (!serverProfile) {
    return NextResponse.json({
      success: false,
      error: 'Server profile not found for sync job',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }

  try {
    const transferQueue = TransferQueue.getInstance();
    let queuedCount = 0;

    // Queue each remote-only file for transfer
    for (const fileState of remoteOnlyFiles) {
      const remotePath = `${syncJob.remotePath}/${fileState.relativePath}`.replace(/\/+/g, '/');
      const localPath = `${syncJob.localPath}/${fileState.relativePath}`.replace(/\/+/g, '/');

      const transferId = await transferQueue.addTransfer({
        jobId: id,
        fileId: fileState._id.toString(),
        type: TransferType.DOWNLOAD,
        priority: TransferPriority.NORMAL,
        source: remotePath,
        destination: localPath,
        filename: fileState.filename,
        relativePath: fileState.relativePath,
        size: fileState.remote.size || 0,
        sshConfig: {
          host: serverProfile.address,
          port: serverProfile.port,
          username: serverProfile.user,
          privateKey: serverProfile.privateKey || ''
        },
        maxRetries: 3
      });

      // Update file state to queued
      fileState.syncState = 'queued';
      fileState.transfer.progress = 0;
      fileState.transfer.retryCount = 0;
      await fileState.save();

      queuedCount++;
    }

    // Calculate total size to transfer
    const totalSize = remoteOnlyFiles.reduce((sum, file) => sum + (file.remote.size || 0), 0);

    const copyResult = {
      jobId: id,
      jobName: syncJob.name,
      queuedFiles: queuedCount,
      totalSize,
      queuedAt: new Date().toISOString(),
      status: 'queued',
      message: `${queuedCount} files queued for download`
    };

    logger.info('Copy job queued successfully', {
      jobId: id,
      queuedFiles: queuedCount,
      totalSize,
      duration: timer.end()
    });

    return NextResponse.json({
      success: true,
      data: copyResult,
      timestamp: new Date().toISOString()
    });

  } catch (error: unknown) {
    logger.error('Failed to queue copy job', {
      jobId: id,
      error: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json({
      success: false,
      error: 'Failed to queue files for copy',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});
