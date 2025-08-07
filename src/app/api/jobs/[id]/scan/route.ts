/**
 * Sync Job Scan Operation Endpoint
 * Handles manual directory scanning for a specific sync job
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { Types } from 'mongoose';
import { FileScanner } from '@/lib/scanner/file-scanner';

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
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'manual-scan');
  
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
  
  // Update last scan time and perform the actual scan
  syncJob.lastScan = new Date();
  await syncJob.save();

  // Perform the actual file scan using our FileScanner
  try {
    const fileScanner = new FileScanner();
    
    // Get server profile for SSH connection
    const serverProfile = syncJob.serverProfileId;
    if (!serverProfile) {
      return NextResponse.json({
        success: false,
        error: 'Server profile not found for sync job',
        timestamp: new Date().toISOString()
      }, { status: 400 });
    }

    // Start the scan asynchronously
    const scanPromise = fileScanner.compareDirectories(
      syncJob._id.toString(),
      {
        id: `${serverProfile._id}`,
        name: serverProfile.name,
        host: serverProfile.address,
        port: serverProfile.port,
        username: serverProfile.user,
        ...(serverProfile.authMethod === 'password' 
          ? { password: serverProfile.password }
          : { privateKey: serverProfile.privateKey }
        )
      },
      syncJob.remotePath,
      syncJob.localPath
    );

    // Don't await the scan - let it run in background
    scanPromise.catch((error: unknown) => {
      logger.error('Background scan failed', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    const scanResult = {
      jobId: id,
      jobName: syncJob.name,
      remotePath: syncJob.remotePath,
      localPath: syncJob.localPath,
      scanStarted: new Date().toISOString(),
      status: 'initiated',
      message: 'Directory scan has been started in background'
    };

    logger.info('File scan initiated successfully', {
      jobId: id,
      duration: timer.end()
    });

    return NextResponse.json({
      success: true,
      data: scanResult,
      timestamp: new Date().toISOString()
    });

  } catch (error: unknown) {
    logger.error('Failed to initiate scan', {
      jobId: id,
      error: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json({
      success: false,
      error: 'Failed to initiate directory scan',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});
