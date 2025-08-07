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
 * POST /api/files/download
 * Download a file or folder from remote server
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'download_file');
  
  logger.info('Processing download request');
  
  try {
    const body = await req.json();
    const { fileId, jobId, localPath, priority } = DownloadRequestSchema.parse(body);
    
    await connectDB();
    const { SyncJob, FileState } = await import('@/models');
    
    // Get the file state and job info
    const fileState = await FileState.findById(fileId);
    if (!fileState) {
      throw new Error('File not found');
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
    
    // Determine local destination path
    const destination = localPath || path.join(job.localPath, fileState.relativePath);
    
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
    
    // Create transfer job
    const transferData = {
      jobId: job._id.toString(),
      fileId: fileState._id.toString(),
      type: TransferType.DOWNLOAD,
      priority: TransferPriority[priority as keyof typeof TransferPriority],
      source: path.join(job.remotePath, fileState.relativePath),
      destination: destination,
      filename: fileState.filename,
      relativePath: fileState.relativePath,
      size: fileState.size || 0,
      sshConfig: {
        host: serverProfile.address,
        port: serverProfile.port,
        username: serverProfile.user,
        privateKey: serverProfile.privateKey,
        password: serverProfile.password
      },
      rsyncOptions: {
        verbose: true,
        archive: true,
        compress: true,
        progress: true,
        humanReadable: true,
        partial: true,
        inplace: false
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
      destination: transferData.destination
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
    throw error;
  }
});
