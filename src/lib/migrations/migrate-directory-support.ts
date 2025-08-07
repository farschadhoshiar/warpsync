/**
 * Migration Script: Add Directory Support to FileState
 * 
 * This migration adds the new directory-related fields to existing FileState records:
 * - isDirectory: boolean (default: false)
 * - parentPath: string (extracted from relativePath)
 * - directorySize: number (default: 0)
 * - fileCount: number (default: 0)
 * - remote.isDirectory: boolean (default: false)
 * - local.isDirectory: boolean (default: false)
 */

import connectDB from '@/lib/mongodb';
import { logger } from '@/lib/logger';

interface MigrationStats {
  totalRecords: number;
  updatedRecords: number;
  directoriesFound: number;
  errors: number;
}

/**
 * Extract parent path from relative path
 */
function extractParentPath(relativePath: string): string {
  if (!relativePath || !relativePath.includes('/')) {
    return '';
  }
  return relativePath.substring(0, relativePath.lastIndexOf('/'));
}

/**
 * Determine if a path represents a directory based on common patterns
 * This is a best-effort approach since we don't have the original isDirectory flag
 */
function inferIsDirectory(relativePath: string, filename: string, size?: number): boolean {
  // If size is 0 and path doesn't have file extension, likely a directory
  if (size === 0 && !filename.includes('.')) {
    return true;
  }
  
  // Common directory patterns
  if (filename.match(/^[A-Za-z0-9\s\-_]+$/) && !filename.includes('.')) {
    return true;
  }
  
  // If it's clearly a file (has extension), it's not a directory
  if (filename.includes('.') && filename.split('.').pop()?.length && filename.split('.').pop()!.length <= 4) {
    return false;
  }
  
  return false;
}

/**
 * Run the migration
 */
export async function migrateFileStateDirectorySupport(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    totalRecords: 0,
    updatedRecords: 0,
    directoriesFound: 0,
    errors: 0
  };
  
  try {
    await connectDB();
    const { FileState } = await import('@/models');
    
    logger.info('Starting FileState directory support migration');
    
    // Get all FileState records that need migration (don't have isDirectory field)
    const records = await FileState.find({
      $or: [
        { isDirectory: { $exists: false } },
        { parentPath: { $exists: false } },
        { 'remote.isDirectory': { $exists: false } },
        { 'local.isDirectory': { $exists: false } }
      ]
    });
    
    stats.totalRecords = records.length;
    logger.info(`Found ${stats.totalRecords} records to migrate`);
    
    if (stats.totalRecords === 0) {
      logger.info('No records need migration');
      return stats;
    }
    
    // Process records in batches
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      for (const record of batch) {
        try {
          const parentPath = extractParentPath(record.relativePath);
          const isDirectory = inferIsDirectory(
            record.relativePath, 
            record.filename, 
            record.remote.size || record.local.size
          );
          
          // Update the record
          const updateData: Record<string, unknown> = {
            isDirectory,
            parentPath,
            directorySize: isDirectory ? (record.remote.size || record.local.size || 0) : 0,
            fileCount: isDirectory ? 0 : undefined, // Will be calculated later if needed
            'remote.isDirectory': isDirectory && record.remote.exists,
            'local.isDirectory': isDirectory && record.local.exists
          };
          
          await FileState.updateOne(
            { _id: record._id },
            { $set: updateData }
          );
          
          stats.updatedRecords++;
          if (isDirectory) {
            stats.directoriesFound++;
          }
          
          if (stats.updatedRecords % 100 === 0) {
            logger.info(`Migration progress: ${stats.updatedRecords}/${stats.totalRecords} records processed`);
          }
          
        } catch (error) {
          logger.error('Error migrating record', {
            recordId: record._id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          stats.errors++;
        }
      }
    }
    
    // Calculate directory file counts
    logger.info('Calculating directory file counts...');
    await calculateDirectoryFileCounts();
    
    logger.info('FileState directory support migration completed', stats);
    return stats;
    
  } catch (error) {
    logger.error('Migration failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stats
    });
    throw error;
  }
}

/**
 * Calculate file counts for directories
 */
async function calculateDirectoryFileCounts(): Promise<void> {
  const { FileState } = await import('@/models');
  
  // Get all directories
  const directories = await FileState.find({ isDirectory: true });
  
  for (const directory of directories) {
    try {
      // Count files in this directory (direct children only)
      const fileCount = await FileState.countDocuments({
        parentPath: directory.relativePath,
        isDirectory: false
      });
      
      // Update the directory with file count
      await FileState.updateOne(
        { _id: directory._id },
        { $set: { fileCount } }
      );
      
    } catch (error) {
      logger.error('Error calculating file count for directory', {
        directoryId: directory._id,
        directoryPath: directory.relativePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

/**
 * CLI runner for the migration
 */
if (require.main === module) {
  migrateFileStateDirectorySupport()
    .then((stats) => {
      console.log('Migration completed successfully:', stats);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}
