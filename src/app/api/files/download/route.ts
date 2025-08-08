/**
 * File Download API Endpoint
 * Handles downloading files and folders from remote servers
 */

import { NextRequest } from 'next/server';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { TransferQueue } from '@/lib/queue/transfer-queue';
import { TransferType, TransferPriority } from '@/lib/queue/types';
import { EventEmitter } from '@/lib/websocket/emitter';
import connectDB from '@/lib/mongodb';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';

// Schema for download request
const DownloadRequestSchema = z.object({
  fileId: z.string(),
  jobId: z.string(),
  localPath: z.string().optional(), // Optional custom local path
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional().default('NORMAL')
});

/**
 * Escape regex special characters for safe MongoDB regex queries
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find child FileState records for a given parent directory
 */
async function findChildFileStates(jobId: string, parentRelativePath: string, FileState: any) {
  const escapedPath = escapeRegex(parentRelativePath);
  return await FileState.find({
    jobId,
    relativePath: { 
      $regex: `^${escapedPath}/`,
      $options: 'i'
    }
  }).lean();
}

/**
 * POST /api/files/download
 * Download a file or folder from remote server
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'download_file');
  
  // Add request timeout for large file processing
  const timeout = 30000; // 30 seconds
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  // Declare variables for error handling
  let fileId: string | undefined;
  let fileState: any;
  
  try {
    logger.info('Processing download request');
    
    const body = await Promise.race([
      req.json(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout while parsing body')), timeout)
      )
    ]) as unknown;
    const parsedBody = DownloadRequestSchema.parse(body);
    fileId = parsedBody.fileId;
    const { jobId, localPath, priority } = parsedBody;
    
    logger.info('Download request received', {
      fileId,
      jobId,
      localPath,
      priority,
      fileIdLength: fileId?.length,
      isValidObjectId: fileId && /^[0-9a-fA-F]{24}$/.test(fileId)
    });
    
    await connectDB();
    const { SyncJob, FileState } = await import('@/models');
    
    // Get the file state and job info
    logger.info('Looking up FileState', { fileId });
    fileState = await FileState.findById(fileId);
    if (!fileState) {
      logger.error('FileState not found', { 
        fileId,
        jobId,
        searchAttempted: `FileState.findById("${fileId}")` 
      });
      throw new Error('File not found');
    }
    
    logger.info('FileState found', {
      fileId: fileState._id.toString(),
      filename: fileState.filename,
      relativePath: fileState.relativePath,
      isDirectory: fileState.isDirectory,
      syncState: fileState.syncState
    });

    // Check for child directories/files if this is a directory
    let childFileStates: any[] = [];
    let isDirectoryPackage = false;
    let totalPackageSize = fileState.size || 0;

    if (fileState.isDirectory) {
      logger.info('Checking for child FileStates for directory package');
      childFileStates = await findChildFileStates(jobId, fileState.relativePath, FileState);
      
      if (childFileStates.length > 0) {
        isDirectoryPackage = true;
        totalPackageSize = childFileStates.reduce((sum, child) => {
          return sum + (child.remote?.size || child.local?.size || 0);
        }, 0);
        
        logger.info('Directory package detected', {
          parentPath: fileState.relativePath,
          childCount: childFileStates.length,
          totalPackageSize,
          childPaths: childFileStates.map(c => c.relativePath).slice(0, 5), // Log first 5 for debugging
        });
      }
    }
    
    const job = await SyncJob.findById(jobId).populate('serverProfileId');
    if (!job) {
      throw new Error('Job not found');
    }
    
    logger.info('Job found', {
      jobId,
      hasServerProfileId: !!job.serverProfileId,
      serverProfileIdType: typeof job.serverProfileId,
      serverProfileId: job.serverProfileId
    });
    
    if (!job.serverProfileId) {
      throw new Error('Server profile not found for this job');
    }
    
    // Try alternative method to get server profile
    let serverProfile;
    try {
      // First try the populated version
      serverProfile = job.serverProfileId as unknown as {
        address: string;
        port: number;
        user: string;
        privateKey?: string;
        password?: string;
      };
      
      // If populated version doesn't have address, try the instance method
      if (!serverProfile.address) {
        logger.info('Populated serverProfile missing address, trying instance method');
        const profileFromMethod = await job.getServerProfile();
        if (profileFromMethod) {
          serverProfile = profileFromMethod as unknown as {
            address: string;
            port: number;
            user: string;
            privateKey?: string;
            password?: string;
          };
          logger.info('Got server profile from instance method', {
            address: serverProfile.address,
            user: serverProfile.user
          });
        }
      }
    } catch (error) {
      logger.error('Error getting server profile', { error });
      throw new Error('Failed to retrieve server profile');
    }
    
    logger.info('Server profile details', {
      hasAddress: !!serverProfile.address,
      hasUser: !!serverProfile.user,
      address: serverProfile.address,
      user: serverProfile.user,
      hasPrivateKey: !!serverProfile.privateKey,
      hasPassword: !!serverProfile.password,
      serverProfileKeys: Object.keys(serverProfile || {})
    });
    
    // Validate required SSH configuration
    if (!serverProfile.address || !serverProfile.user) {
      throw new Error('Invalid server configuration: missing address or user');
    }
    
    if (!serverProfile.privateKey && !serverProfile.password) {
      throw new Error('Invalid server configuration: missing authentication method');
    }
    
    logger.info('Download request validated', {
      fileId,
      jobId,
      filename: fileState.filename,
      relativePath: fileState.relativePath,
      isDirectory: fileState.isDirectory,
      size: fileState.size,
      serverAddress: serverProfile.address
    });
    
    // Enhanced path debugging
    const constructedSourcePath = path.join(job.remotePath, fileState.relativePath);
    logger.info('Path construction details', {
      jobRemotePath: job.remotePath,
      fileStateRelativePath: fileState.relativePath,
      constructedSourcePath,
      fileStateParentPath: fileState.parentPath,
      fileStateFilename: fileState.filename,
      isDirectoryPackage,
      childCount: childFileStates.length
    });

    // Determine the source path for rsync
    let finalSourcePath = constructedSourcePath;
    if (isDirectoryPackage) {
      // For directory packages, ensure we sync the directory contents with trailing slash
      finalSourcePath = constructedSourcePath.endsWith('/') ? constructedSourcePath : constructedSourcePath + '/';
      logger.info('Directory package source path adjusted', {
        originalPath: constructedSourcePath,
        adjustedPath: finalSourcePath
      });
    }
    
    // Determine local destination path - preserve exact structure for sync compatibility
    let destination: string;
    if (localPath) {
      destination = localPath;
    } else {
      // Always use the full relative path to maintain exact structure for sync
      // This ensures downloaded content matches the remote structure exactly
      destination = path.join(job.localPath, fileState.relativePath);
      
      logger.debug('Destination path constructed', {
        fileId,
        remotePath: fileState.relativePath,
        localPath: job.localPath,
        destination,
        isDirectory: fileState.isDirectory,
        filename: fileState.filename
      });
    }
    
    // Ensure destination directory exists
    const destinationDir = path.dirname(destination);
    try {
      await fs.mkdir(destinationDir, { recursive: true });
    } catch (error) {
      logger.warn('Failed to create destination directory', { 
        destinationDir, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
    
    // Get transfer queue with Socket.IO event emitter
    const eventEmitter = global.io ? new EventEmitter(global.io) : undefined;
    
    logger.info('Transfer queue initialization', {
      hasGlobalIo: !!global.io,
      hasEventEmitter: !!eventEmitter
    });
    
    const transferQueue = TransferQueue.getInstance(undefined, undefined, eventEmitter);
    
    // Determine transfer type based on directory package detection
    let transferType: TransferType;
    if (isDirectoryPackage) {
      transferType = TransferType.DIRECTORY_PACKAGE;
    } else if (fileState.isDirectory) {
      transferType = TransferType.DIRECTORY;
    } else {
      transferType = TransferType.DOWNLOAD;
    }

    // Create transfer job
    const transferData = {
      jobId: job._id.toString(),
      fileId: fileState._id.toString(),
      type: transferType,
      priority: TransferPriority[priority as keyof typeof TransferPriority],
      source: finalSourcePath,
      destination: destination,
      filename: fileState.filename,
      relativePath: fileState.relativePath,
      size: isDirectoryPackage ? totalPackageSize : (fileState.size || 0),
      sshConfig: {
        host: serverProfile.address,
        port: serverProfile.port,
        username: serverProfile.user,
        privateKey: serverProfile.privateKey || ''
      },
      rsyncOptions: {
        verbose: true,
        archive: true,
        compress: true,
        progress: true,
        humanReadable: true,
        partial: true,
        inplace: false,
        // Enhanced options for directory packages
        ...(isDirectoryPackage && {
          recursive: true,
          dirs: true,
          mkpath: true
        })
      },
      maxRetries: 3
    };
    
    // Add to transfer queue
    const transferId = await transferQueue.addTransfer(transferData);
    
    logger.info('Transfer added to queue', {
      transferId,
      fileId,
      jobId,
      filename: fileState.filename,
      source: transferData.source,
      destination: transferData.destination,
      transferType: transferData.type,
      isDirectoryPackage,
      totalSize: transferData.size,
      childCount: childFileStates.length
    });
    
    // Update file state to queued
    await FileState.findByIdAndUpdate(fileId, {
      syncState: 'queued',
      'transfer.transferId': transferId,
      'transfer.progress': 0,
      'transfer.errorMessage': null,
      'transfer.retryCount': 0
    });
    
    logger.info('Download transfer queued successfully', {
      transferId,
      fileId,
      filename: fileState.filename,
      destination,
      duration: timer.end()
    });
    
    return createSuccessResponse({
      transferId,
      fileId,
      filename: fileState.filename,
      destination,
      message: 'Download queued successfully'
    });
    
  } catch (error) {
    timer.endWithError(error);
    
    // Enhanced error handling for network timeouts and large files
    if (error instanceof Error) {
      if (error.message.includes('timeout') || error.message.includes('Request timeout')) {
        logger.error('Download request timeout', {
          fileId,
          filename: fileState?.filename,
          size: fileState?.size,
          isDirectory: fileState?.isDirectory,
          timeout
        });
        throw new Error(`Download request timed out after ${timeout/1000} seconds. This may be due to large file size or network issues.`);
      }
      
      if (error.message.includes('NetworkError') || error.message.includes('fetch')) {
        logger.error('Network error during download request', {
          fileId,
          filename: fileState?.filename,
          error: error.message
        });
        throw new Error('Network error occurred while processing download request. Please check your connection and try again.');
      }
    }
    
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
});
