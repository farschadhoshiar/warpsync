/**
 * Directory Statistics Recalculation API Endpoint
 * Triggers recalculation of directory sizes and file counts for a specific job
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { recalculateJobDirectoryStats, RecalculationProgress } from '@/lib/services/directory-recalculator';
import { Types } from 'mongoose';

/**
 * POST /api/jobs/[id]/recalculate-stats
 * Recalculate directory statistics for a specific sync job
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'recalculate-directory-stats');
  
  const { id: jobId } = await params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(jobId)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Starting directory statistics recalculation', { jobId });
  
  await connectDB();
  const { SyncJob } = await import('@/models');
  
  // Verify job exists
  const syncJob = await SyncJob.findById(jobId);
  if (!syncJob) {
    return NextResponse.json({
      success: false,
      error: 'Sync job not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  try {
    // Track progress for logging
    const progressUpdates: RecalculationProgress[] = [];
    
    const result = await recalculateJobDirectoryStats(
      jobId,
      (progress) => {
        progressUpdates.push({ ...progress });
        
        // Log significant progress milestones
        if (progress.processedDirectories % 10 === 0 || progress.completed) {
          logger.info('Directory recalculation progress', {
            jobId,
            processed: progress.processedDirectories,
            total: progress.totalDirectories,
            currentDirectory: progress.currentDirectory,
            completed: progress.completed,
            errorsCount: progress.errors.length
          });
        }
      }
    );

    const duration = timer.end();

    if (result.success) {
      logger.info('Directory statistics recalculation completed successfully', {
        jobId,
        directoriesProcessed: result.directoriesProcessed,
        errorsCount: result.errors.length,
        duration
      });

      return NextResponse.json({
        success: true,
        data: {
          jobId,
          directoriesProcessed: result.directoriesProcessed,
          totalErrors: result.errors.length,
          errors: result.errors.slice(0, 5), // Return first 5 errors
          duration: result.duration,
          hasMoreErrors: result.errors.length > 5
        },
        message: `Successfully recalculated directory statistics for ${result.directoriesProcessed} directories`,
        timestamp: new Date().toISOString()
      });
    } else {
      logger.error('Directory statistics recalculation failed', {
        jobId,
        errors: result.errors,
        duration
      });

      return NextResponse.json({
        success: false,
        error: 'Directory statistics recalculation failed',
        details: {
          jobId,
          directoriesProcessed: result.directoriesProcessed,
          errors: result.errors.slice(0, 10), // Return first 10 errors
          hasMoreErrors: result.errors.length > 10
        },
        timestamp: new Date().toISOString()
      }, { status: 500 });
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('Directory statistics recalculation failed with exception', {
      jobId,
      error: errorMessage,
      duration: timer.end()
    });

    return NextResponse.json({
      success: false,
      error: 'Failed to recalculate directory statistics',
      details: errorMessage,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});
