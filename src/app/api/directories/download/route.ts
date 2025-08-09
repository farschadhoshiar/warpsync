/**
 * Directory Copy API Endpoint
 * Handles directory-based download operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { getDownloadService, UnifiedDownloadRequest } from '@/lib/services/download-service';
import { EventEmitter } from '@/lib/websocket/emitter';
import { withMiddleware } from '@/lib/auth/middleware';
import { z } from 'zod';

// Schema for directory download request
const DirectoryDownloadSchema = z.object({
  directoryPath: z.string(),
  jobId: z.string(),
  localPath: z.string().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional().default('HIGH'),
  recursive: z.boolean().optional().default(true),
  createStructure: z.boolean().optional().default(true),
  preserveHierarchy: z.boolean().optional().default(true),
  rsyncOptions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
});

/**
 * POST /api/directories/download
 * Download all files in a directory
 */
export const POST = withMiddleware(
  withErrorHandler(async (req: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, 'directory_download');
    
    try {
      logger.info('Processing directory download request');
      
      const body = await req.json();
      const parsedRequest = DirectoryDownloadSchema.parse(body);
      
      logger.info('Directory download request validated', {
        directoryPath: parsedRequest.directoryPath,
        jobId: parsedRequest.jobId,
        localPath: parsedRequest.localPath,
        priority: parsedRequest.priority,
        recursive: parsedRequest.recursive
      });

      // Get download service with Socket.IO event emitter
      const eventEmitter = global.io ? new EventEmitter(global.io) : undefined;
      const downloadService = getDownloadService(eventEmitter);

      // Convert to unified download request
      const unifiedRequest: UnifiedDownloadRequest = {
        source: 'manual',
        scope: 'directory',
        targets: [parsedRequest.directoryPath],
        options: {
          jobId: parsedRequest.jobId,
          priority: parsedRequest.priority,
          localPath: parsedRequest.localPath,
          rsyncOptions: {
            ...parsedRequest.rsyncOptions,
            recursive: parsedRequest.recursive
          },
          dryRun: false,
          createStructure: parsedRequest.createStructure,
          preserveHierarchy: parsedRequest.preserveHierarchy,
          overwriteExisting: false
        }
      };

      // Process the download request
      const result = await downloadService.processDownload(unifiedRequest);

      if (!result.success) {
        logger.error('Directory download request failed', {
          directoryPath: parsedRequest.directoryPath,
          errors: result.errors,
          warnings: result.warnings,
          duration: timer.end()
        });

        return NextResponse.json({
          success: false,
          error: result.errors?.[0] || 'Directory download request failed',
          errors: result.errors,
          warnings: result.warnings,
          timestamp: result.timestamp
        }, { status: 400 });
      }

      logger.info('Directory download request completed successfully', {
        directoryPath: parsedRequest.directoryPath,
        queuedCount: result.data.queuedCount,
        skippedCount: result.data.skippedCount,
        upgradedCount: result.data.upgradedCount,
        totalSize: result.data.totalSize,
        duration: timer.end()
      });

      return createSuccessResponse({
        directoryPath: parsedRequest.directoryPath,
        ...result.data,
        warnings: result.warnings
      });

    } catch (error) {
      timer.endWithError(error);
      
      logger.error('Directory download request error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw error;
    }
  }),
  {
    auth: 'optional',
    rateLimit: { limit: 30, windowMs: 15 * 60 * 1000 }, // 30 requests per 15 minutes
    validateSize: 1024 * 1024 // 1MB max request size
  }
);

/**
 * OPTIONS /api/directories/download
 * Handle preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
