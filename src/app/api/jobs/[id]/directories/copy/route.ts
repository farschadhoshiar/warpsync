/**
 * Directory Copy API Endpoint
 * Handles copying entire directories with structure preservation
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { TransferType, TransferPriority } from '@/lib/queue/types';
import { Types } from 'mongoose';

interface CopyDirectoryRequest {
  directoryPaths?: string[];
  createStructure?: boolean;
  preserveHierarchy?: boolean;
}

/**
 * POST /api/jobs/[id]/directories/copy
 * Queue entire directories for transfer with structure preservation
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'copy-directories-trigger');
  
  const { id } = await params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  const body: CopyDirectoryRequest = await req.json();
  const { directoryPaths, createStructure = true, preserveHierarchy = true } = body;
  
  logger.info('Triggering directory copy for sync job', { 
    jobId: id, 
    directoryPaths,
    createStructure,
    preserveHierarchy
  });
  
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
  
  // Build filter for directory-based file selection
  const filter: Record<string, unknown> = {
    jobId: id,
    syncState: 'remote_only'
  };
  
  if (directoryPaths && directoryPaths.length > 0) {
    // Copy specific directories
    filter.$or = directoryPaths.map(dirPath => ({
      $or: [
        { relativePath: dirPath, isDirectory: true },
        { parentPath: dirPath },
        { relativePath: { $regex: `^${dirPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/` } }
      ]
    }));
  }
  
  // Get all files and directories to copy
  const itemsToCopy = await FileState.find(filter).sort({ 
    isDirectory: -1, // Directories first
    relativePath: 1   // Then alphabetical
  });
  
  if (itemsToCopy.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        message: directoryPaths ? 
          'No remote-only items found in specified directories' : 
          'No remote-only items found to copy',
        queuedItems: 0,
        queuedDirectories: 0,
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
    let directoriesCount = 0;
    let filesCount = 0;

    // Process directories first to ensure structure exists
    const directories = itemsToCopy.filter(item => item.isDirectory);
    const files = itemsToCopy.filter(item => !item.isDirectory);

    // Queue directories for creation
    for (const directory of directories) {
      const remotePath = `${syncJob.remotePath}/${directory.relativePath}`.replace(/\/+/g, '/');
      const localPath = `${syncJob.localPath}/${directory.relativePath}`.replace(/\/+/g, '/');

      await transferQueue.addTransfer({
        jobId: id,
        fileId: directory._id.toString(),
        type: TransferType.DIRECTORY,
        priority: TransferPriority.HIGH, // High priority for directory creation
        source: remotePath,
        destination: localPath,
        filename: directory.filename,
        relativePath: directory.relativePath,
        size: directory.directorySize || 0,
        sshConfig: {
          host: serverProfile.address,
          port: serverProfile.port,
          username: serverProfile.user,
          ...(serverProfile.authMethod === 'password' 
            ? { password: serverProfile.password }
            : { privateKey: serverProfile.privateKey }
          )
        },
        rsyncOptions: {
          archive: true,
          verbose: true,
          progress: true,
          compress: true,
          preserveTimestamps: true,
          preservePermissions: true,
          createDirs: createStructure,
          preserveHierarchy: preserveHierarchy
        },
        maxRetries: 3
      });

      // Update file state to queued
      directory.syncState = 'queued';
      directory.transfer.retryCount = 0;
      await directory.save();

      queuedCount++;
      directoriesCount++;
    }

    // Queue files after directories
    for (const fileState of files) {
      const remotePath = `${syncJob.remotePath}/${fileState.relativePath}`.replace(/\/+/g, '/');
      const localPath = `${syncJob.localPath}/${fileState.relativePath}`.replace(/\/+/g, '/');

      await transferQueue.addTransfer({
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
          ...(serverProfile.authMethod === 'password' 
            ? { password: serverProfile.password }
            : { privateKey: serverProfile.privateKey }
          )
        },
        rsyncOptions: {
          archive: true,
          verbose: true,
          progress: true,
          compress: true,
          preserveTimestamps: true,
          preservePermissions: true
        },
        maxRetries: 3
      });

      // Update file state to queued
      fileState.syncState = 'queued';
      fileState.transfer.retryCount = 0;
      await fileState.save();

      queuedCount++;
      filesCount++;
    }

    logger.info('Directory copy jobs queued successfully', {
      jobId: id,
      totalQueued: queuedCount,
      directories: directoriesCount,
      files: filesCount,
      duration: timer.end()
    });

    return NextResponse.json({
      success: true,
      data: {
        message: `${queuedCount} items queued for transfer (${directoriesCount} directories, ${filesCount} files)`,
        queuedItems: queuedCount,
        queuedDirectories: directoriesCount,
        queuedFiles: filesCount,
        preserveStructure: createStructure,
        preserveHierarchy: preserveHierarchy
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: unknown) {
    logger.error('Failed to queue directory copy jobs', {
      jobId: id,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: timer.end()
    });

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to queue directory copy jobs',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});
