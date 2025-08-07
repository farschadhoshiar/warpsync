/**
 * Directory Recalculator Service
 * Handles recalculation and updating of directory statistics in the database
 */

import { Types } from 'mongoose';
import connectDB from '@/lib/mongodb';
import { logger } from '@/lib/logger';
import { 
  calculateAllDirectoryStats, 
  validateDirectoryStats,
  FileStateRecord 
} from '../scanner/directory-stats';

export interface RecalculationProgress {
  jobId: string;
  totalDirectories: number;
  processedDirectories: number;
  currentDirectory?: string;
  completed: boolean;
  errors: string[];
}

export interface RecalculationResult {
  success: boolean;
  jobId: string;
  directoriesProcessed: number;
  errors: string[];
  duration: number;
}

/**
 * Recalculate directory statistics for a specific job
 */
export async function recalculateJobDirectoryStats(
  jobId: string,
  onProgress?: (progress: RecalculationProgress) => void
): Promise<RecalculationResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let directoriesProcessed = 0;

  try {
    logger.info('Starting directory statistics recalculation', { jobId });

    await connectDB();
    const { FileState } = await import('@/models');

    // Validate job ID
    if (!Types.ObjectId.isValid(jobId)) {
      throw new Error('Invalid job ID format');
    }

    // Get all file states for the job
    const fileStates = await FileState.find({ jobId }).lean() as unknown as FileStateRecord[];
    
    if (fileStates.length === 0) {
      logger.warn('No file states found for job', { jobId });
      return {
        success: true,
        jobId,
        directoriesProcessed: 0,
        errors: [],
        duration: Date.now() - startTime
      };
    }

    // Get directories for progress tracking
    const directories = fileStates.filter(fs => fs.isDirectory);
    const totalDirectories = directories.length;

    // Initial progress update
    onProgress?.({
      jobId,
      totalDirectories,
      processedDirectories: 0,
      completed: false,
      errors: []
    });

    // Calculate statistics for all directories
    logger.info('Calculating directory statistics', { 
      jobId, 
      totalFiles: fileStates.length,
      totalDirectories 
    });

    const statsMap = calculateAllDirectoryStats(fileStates);

    // Update database with calculated statistics
    const bulkOps = [];
    
    for (const [directoryPath, stats] of statsMap) {
      try {
        // Validate calculated stats
        if (!validateDirectoryStats(stats, directoryPath)) {
          errors.push(`Invalid stats calculated for directory: ${directoryPath}`);
          continue;
        }

        // Prepare bulk update operation
        bulkOps.push({
          updateOne: {
            filter: { 
              jobId: new Types.ObjectId(jobId), 
              relativePath: directoryPath,
              isDirectory: true
            },
            update: {
              $set: {
                directorySize: stats.directorySize,
                fileCount: stats.fileCount
              }
            }
          }
        });

        directoriesProcessed++;

        // Progress update
        onProgress?.({
          jobId,
          totalDirectories,
          processedDirectories: directoriesProcessed,
          currentDirectory: directoryPath,
          completed: false,
          errors: [...errors]
        });

      } catch (error) {
        const errorMessage = `Failed to process directory ${directoryPath}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMessage);
        logger.error('Directory processing error', {
          jobId,
          directoryPath,
          error: errorMessage
        });
      }
    }

    // Execute bulk update if we have operations
    if (bulkOps.length > 0) {
      logger.info('Executing bulk update for directory statistics', {
        jobId,
        operationsCount: bulkOps.length
      });

      const result = await FileState.bulkWrite(bulkOps);
      
      logger.info('Bulk update completed', {
        jobId,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount
      });
    }

    // Final progress update
    onProgress?.({
      jobId,
      totalDirectories,
      processedDirectories: directoriesProcessed,
      completed: true,
      errors: [...errors]
    });

    const duration = Date.now() - startTime;
    
    logger.info('Directory statistics recalculation completed', {
      jobId,
      directoriesProcessed,
      errorsCount: errors.length,
      duration
    });

    return {
      success: true,
      jobId,
      directoriesProcessed,
      errors,
      duration
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    errors.push(errorMessage);
    
    logger.error('Directory statistics recalculation failed', {
      jobId,
      error: errorMessage,
      duration: Date.now() - startTime
    });

    // Final progress update on error
    onProgress?.({
      jobId,
      totalDirectories: 0,
      processedDirectories: directoriesProcessed,
      completed: true,
      errors: [...errors]
    });

    return {
      success: false,
      jobId,
      directoriesProcessed,
      errors,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Recalculate directory statistics for all jobs
 */
export async function recalculateAllDirectoryStats(
  onProgress?: (progress: RecalculationProgress) => void
): Promise<RecalculationResult[]> {
  try {
    await connectDB();
    const { SyncJob } = await import('@/models');

    // Get all job IDs
    const jobs = await SyncJob.find({}, { _id: 1 }).lean();
    const results: RecalculationResult[] = [];

    logger.info('Starting directory statistics recalculation for all jobs', {
      totalJobs: jobs.length
    });

    // Process each job
    for (const job of jobs) {
      const result = await recalculateJobDirectoryStats(
        (job._id as Types.ObjectId).toString(),
        onProgress
      );
      results.push(result);
    }

    logger.info('Completed directory statistics recalculation for all jobs', {
      totalJobs: jobs.length,
      successfulJobs: results.filter(r => r.success).length,
      failedJobs: results.filter(r => !r.success).length
    });

    return results;

  } catch (error) {
    logger.error('Failed to recalculate directory statistics for all jobs', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}
