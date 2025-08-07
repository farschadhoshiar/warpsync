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

/**
 * POST /api/jobs/[id]/scan
 * Trigger a manual directory scan for a sync job
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'manual-scan');
  
  const { id } = await params;
  
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
      error: 'Cannot scan disabled sync job',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  // Update last scan time and perform the actual scan
  syncJob.lastScan = new Date();
  await syncJob.save();

  // Perform the actual file scan using our FileScanner
  try {
    logger.info('Creating FileScanner instance');
    const fileScanner = new FileScanner();
    logger.info('FileScanner created successfully');
    
    // Get server profile for SSH connection
    const serverProfile = syncJob.serverProfileId;
    if (!serverProfile) {
      logger.error('Server profile not found', { jobId: id });
      return NextResponse.json({
        success: false,
        error: 'Server profile not found for sync job',
        timestamp: new Date().toISOString()
      }, { status: 400 });
    }

    logger.info('Server profile found', { 
      serverName: serverProfile.name,
      address: serverProfile.address,
      port: serverProfile.port,
      authMethod: serverProfile.authMethod
    });

    // Build SSH config
    const sshConfig = {
      id: `${serverProfile._id}`,
      name: serverProfile.name,
      host: serverProfile.address,
      port: serverProfile.port,
      username: serverProfile.user,
      ...(serverProfile.authMethod === 'password' 
        ? { password: serverProfile.password }
        : { privateKey: serverProfile.privateKey }
      )
    };

    logger.info('Starting directory comparison', {
      remotePath: syncJob.remotePath,
      localPath: syncJob.localPath,
      sshHost: sshConfig.host,
      sshPort: sshConfig.port
    });

    // Perform the scan and wait for completion with timeout
    const scanPromise = fileScanner.compareDirectories(
      syncJob._id.toString(),
      sshConfig,
      syncJob.remotePath,
      syncJob.localPath
    );

    // Set a timeout for the scan operation (5 minutes)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Scan operation timed out after 5 minutes')), 5 * 60 * 1000);
    });

    const comparison = await Promise.race([scanPromise, timeoutPromise]) as Awaited<typeof scanPromise>;

    logger.info('Directory comparison completed', {
      stats: comparison.stats
    });

    // Create the response structure that the frontend expects
    const scanResults = {
      jobId: id,
      jobName: syncJob.name,
      remotePath: syncJob.remotePath,
      localPath: syncJob.localPath,
      scanCompleted: comparison.comparedAt.toISOString(),
      status: 'completed',
      newFiles: comparison.stats.remoteOnly,
      changedFiles: comparison.stats.desynced,
      syncedFiles: comparison.stats.synced,
      localOnlyFiles: comparison.stats.localOnly,
      totalRemoteFiles: comparison.stats.totalRemote,
      totalLocalFiles: comparison.stats.totalLocal,
      totalRemoteSize: comparison.stats.totalSizeRemote,
      totalLocalSize: comparison.stats.totalSizeLocal
    };

    logger.info('File scan completed successfully', {
      jobId: id,
      stats: comparison.stats,
      duration: timer.end()
    });

    return NextResponse.json({
      success: true,
      data: {
        scanResults
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: unknown) {
    logger.error('Failed to complete scan', {
      jobId: id,
      error: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json({
      success: false,
      error: 'Failed to complete directory scan',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});
