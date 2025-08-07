/**
 * Directory Statistics Calculator
 * Provides utilities to calculate directory sizes and file counts recursively
 */

import { Types } from 'mongoose';
import { logger } from '@/lib/logger';

export interface DirectoryStats {
  directorySize: number;
  fileCount: number;
}

export interface FileStateRecord {
  _id: string;
  jobId: Types.ObjectId;
  relativePath: string;
  filename: string;
  isDirectory: boolean;
  parentPath: string;
  remote: {
    size?: number;
    exists: boolean;
  };
  local: {
    size?: number;
    exists: boolean;
  };
  directorySize: number;
  fileCount: number;
}

/**
 * Calculate directory statistics for a given directory path
 * Recursively sums up sizes and counts of all child files and directories
 */
export function calculateDirectoryStats(
  directoryPath: string,
  allFileStates: FileStateRecord[]
): DirectoryStats {
  let totalSize = 0;
  let totalCount = 0;

  // Find all direct children of this directory
  const children = allFileStates.filter(fileState => 
    fileState.parentPath === directoryPath
  );

  for (const child of children) {
    if (child.isDirectory) {
      // For subdirectories, recursively calculate their stats
      const childStats = calculateDirectoryStats(child.relativePath, allFileStates);
      totalSize += childStats.directorySize;
      totalCount += childStats.fileCount;
      
      // Count the directory itself
      totalCount += 1;
    } else {
      // For files, add their size and count them
      const fileSize = child.remote.size || child.local.size || 0;
      totalSize += fileSize;
      totalCount += 1;
    }
  }

  return {
    directorySize: totalSize,
    fileCount: totalCount
  };
}

/**
 * Calculate statistics for all directories in a job
 * Returns a map of directory paths to their calculated stats
 */
export function calculateAllDirectoryStats(
  allFileStates: FileStateRecord[]
): Map<string, DirectoryStats> {
  const statsMap = new Map<string, DirectoryStats>();
  
  // Get all directories, sorted by depth (deepest first)
  const directories = allFileStates
    .filter(fs => fs.isDirectory)
    .sort((a, b) => {
      const depthA = a.relativePath.split('/').length;
      const depthB = b.relativePath.split('/').length;
      return depthB - depthA; // Deepest first
    });

  // Calculate stats for each directory
  for (const directory of directories) {
    const stats = calculateDirectoryStats(directory.relativePath, allFileStates);
    statsMap.set(directory.relativePath, stats);
    
    logger.debug('Calculated directory stats', {
      path: directory.relativePath,
      size: stats.directorySize,
      count: stats.fileCount
    });
  }

  return statsMap;
}

/**
 * Validate calculated statistics against expected constraints
 */
export function validateDirectoryStats(
  stats: DirectoryStats,
  directoryPath: string
): boolean {
  if (stats.directorySize < 0) {
    logger.warn('Invalid directory size calculated', {
      path: directoryPath,
      size: stats.directorySize
    });
    return false;
  }

  if (stats.fileCount < 0) {
    logger.warn('Invalid file count calculated', {
      path: directoryPath,
      count: stats.fileCount
    });
    return false;
  }

  return true;
}

/**
 * Get file size from a file state record
 * Prioritizes remote size over local size
 */
export function getFileSize(fileState: FileStateRecord): number {
  if (fileState.isDirectory) {
    return fileState.directorySize || 0;
  }
  return fileState.remote.size || fileState.local.size || 0;
}
