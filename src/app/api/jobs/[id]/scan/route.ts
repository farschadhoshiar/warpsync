/**
 * Sync Job Scan Operation Endpoint
 * Handles manual directory scanning for a specific sync job
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { Types } from 'mongoose';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * POST /api/jobs/[id]/scan
 * Trigger a manual directory scan for a sync job
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
  
  logger.info('Triggering manual scan for sync job', { jobId: id });
  
  await connectDB();
  const { SyncJob } = await import('@/models');
  
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
      error: 'Cannot scan disabled sync job',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  // Update last scan time
  syncJob.lastScan = new Date();
  await syncJob.save();
  
  // TODO: In a real implementation, this would trigger the actual scan process
  // For now, we'll simulate the scan operation
  const scanResult = {
    jobId: id,
    jobName: syncJob.name,
    remotePath: syncJob.remotePath,
    localPath: syncJob.localPath,
    scanStarted: new Date().toISOString(),
    status: 'initiated',
    message: 'Directory scan has been queued for processing'
  };
  
  logger.info('Manual scan triggered successfully', {
    jobId: id,
    jobName: syncJob.name,
    remotePath: syncJob.remotePath,
    localPath: syncJob.localPath,
    duration: timer.getDuration()
  });
  
  return NextResponse.json({
    success: true,
    data: scanResult,
    timestamp: new Date().toISOString()
  });
});
