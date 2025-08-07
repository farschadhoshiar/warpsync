/**
 * Server Directory Browsing API Endpoint
 * Provides remote directory listing functionality
 */

import { NextRequest } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler, createSuccessResponse, NotFoundError, ValidationError } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { SSHConnectionManager } from '@/lib/ssh/ssh-connection';

/**
 * GET /api/servers/[id]/browse
 * List directory contents for remote server
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'browse_server_directory');
  
  const { id } = await params;
  const url = new URL(req.url);
  const remotePath = url.searchParams.get('path') || '/';
  
  logger.info('Browsing server directory', { serverId: id, remotePath });
  
  await connectDB();
  const { ServerProfile } = await import('@/models');
  
  // Find server profile
  const serverProfile = await ServerProfile.findById(id);
  if (!serverProfile) {
    throw new NotFoundError('Server profile not found');
  }
  
  // Validate path
  if (!remotePath || typeof remotePath !== 'string') {
    throw new ValidationError('Valid path parameter is required');
  }
  
  try {
    // Build SSH configuration
    const sshConfig = {
      id: `browse-${id}`,
      name: `Browse ${serverProfile.name}`,
      host: serverProfile.address,
      port: serverProfile.port,
      username: serverProfile.user,
      ...(serverProfile.authMethod === 'password' 
        ? { password: serverProfile.password }
        : { privateKey: serverProfile.privateKey }
      )
    };
    
    // Get SSH manager and list directory
    const sshManager = SSHConnectionManager.getInstance();
    const directoryListing = await sshManager.listDirectory(sshConfig, remotePath);
    
    // Sort files: directories first, then by name
    const sortedFiles = directoryListing.files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    
    const duration = timer.end({
      serverId: id,
      remotePath,
      fileCount: sortedFiles.length,
      totalSize: directoryListing.totalSize
    });
    
    logger.info('Directory listing completed', {
      serverId: id,
      remotePath,
      fileCount: sortedFiles.length,
      duration
    });
    
    return createSuccessResponse({
      path: directoryListing.path,
      files: sortedFiles.map(file => ({
        name: file.name,
        path: file.path,
        size: file.size,
        modTime: file.modTime,
        isDirectory: file.isDirectory,
        permissions: file.permissions
      })),
      scannedAt: directoryListing.scannedAt,
      totalFiles: directoryListing.totalFiles,
      totalSize: directoryListing.totalSize,
      serverName: serverProfile.name
    });
    
  } catch (error) {
    timer.endWithError(error);
    
    logger.error('Failed to browse directory', {
      serverId: id,
      remotePath,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    throw error;
  }
});
