import { promises as fs } from 'fs';
import { join, basename, resolve } from 'path';
import { logger } from '@/lib/logger';
import { 
  FileMetadata, 
  ScanResult, 
  ScanOptions, 
  ScanProgress,
  DEFAULT_SCAN_OPTIONS 
} from './types';

export class LocalScanner {
  /**
   * Scan local directory and return file metadata
   */
  async scanDirectory(
    localPath: string,
    options: Partial<ScanOptions> = {},
    onProgress?: (progress: ScanProgress) => void
  ): Promise<ScanResult> {
    const scanOptions = { ...DEFAULT_SCAN_OPTIONS, ...options };
    const resolvedPath = resolve(localPath);
    
    logger.info('Starting local directory scan', {
      localPath: resolvedPath,
      options: scanOptions
    });

    const startTime = Date.now();
    const progress: ScanProgress = {
      jobId: `local_scan_${Date.now()}`,
      phase: 'local',
      currentPath: resolvedPath,
      filesScanned: 0,
      bytesScanned: 0,
      startTime: new Date(),
      errors: []
    };

    try {
      // Check if path exists
      const pathStats = await fs.stat(resolvedPath);
      if (!pathStats.isDirectory()) {
        throw new Error(`Path is not a directory: ${resolvedPath}`);
      }

      const files = await this.scanRecursive(
        resolvedPath,
        scanOptions,
        progress,
        onProgress
      );

      const result: ScanResult = {
        path: resolvedPath,
        files,
        scannedAt: new Date(),
        totalFiles: files.length,
        totalSize: files.reduce((sum, file) => sum + file.size, 0),
        errors: progress.errors
      };

      logger.info('Local scan completed', {
        path: resolvedPath,
        totalFiles: result.totalFiles,
        totalSize: result.totalSize,
        duration: Date.now() - startTime,
        errors: result.errors.length
      });

      return result;
    } catch (error) {
      logger.error('Local scan failed', {
        path: resolvedPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Check if local path exists
   */
  async pathExists(localPath: string): Promise<boolean> {
    try {
      await fs.access(localPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file metadata for a specific local file
   */
  async getFileInfo(localPath: string): Promise<FileMetadata> {
    try {
      const stats = await fs.stat(localPath);
      return {
        path: resolve(localPath),
        name: basename(localPath),
        size: stats.isDirectory() ? 0 : stats.size,
        modTime: stats.mtime,
        isDirectory: stats.isDirectory(),
        permissions: this.formatPermissions(stats.mode)
      };
    } catch (error) {
      logger.error('Failed to get local file info', {
        path: localPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get file count estimate for progress tracking
   */
  async getFileCountEstimate(localPath: string, maxDepth = 3): Promise<number> {
    try {
      let count = 0;
      await this.countFiles(localPath, 0, maxDepth, () => count++);
      return count;
    } catch {
      return 0;
    }
  }

  private async scanRecursive(
    currentPath: string,
    options: ScanOptions,
    progress: ScanProgress,
    onProgress?: (progress: ScanProgress) => void,
    currentDepth = 0
  ): Promise<FileMetadata[]> {
    const files: FileMetadata[] = [];

    // Check depth limit
    if (options.maxDepth !== undefined && currentDepth > options.maxDepth) {
      return files;
    }

    try {
      progress.currentPath = currentPath;
      onProgress?.(progress);

      const dirEntries = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of dirEntries) {
        try {
          const fullPath = join(currentPath, entry.name);
          
          // Skip hidden files if not included
          if (!options.includeHidden && entry.name.startsWith('.')) {
            continue;
          }

          // Apply pattern filters
          if (!this.matchesPatterns(entry.name, fullPath, options)) {
            continue;
          }

          const stats = await fs.stat(fullPath);
          
          const fileMetadata: FileMetadata = {
            path: fullPath,
            name: entry.name,
            size: entry.isDirectory() ? 0 : stats.size,
            modTime: stats.mtime,
            isDirectory: entry.isDirectory(),
            permissions: this.formatPermissions(stats.mode)
          };

          // Update progress
          progress.filesScanned++;
          progress.bytesScanned += fileMetadata.size;

          if (entry.isDirectory()) {
            // Recursively scan subdirectories
            if (options.followSymlinks || !entry.isSymbolicLink()) {
              const subFiles = await this.scanRecursive(
                fullPath,
                options,
                progress,
                onProgress,
                currentDepth + 1
              );
              files.push(...subFiles);
            }
          }
          
          // Add file/directory to results
          files.push(fileMetadata);
          onProgress?.(progress);
          
        } catch (error) {
          const errorMsg = `Failed to process ${entry.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          progress.errors.push(errorMsg);
          logger.warn(errorMsg);
        }
      }
    } catch (error) {
      const errorMsg = `Failed to scan directory ${currentPath}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      progress.errors.push(errorMsg);
      logger.error(errorMsg);
    }

    return files;
  }

  private async countFiles(
    dirPath: string,
    currentDepth: number,
    maxDepth: number,
    counter: () => void
  ): Promise<void> {
    if (currentDepth > maxDepth) return;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        counter();
        
        if (entry.isDirectory()) {
          await this.countFiles(
            join(dirPath, entry.name),
            currentDepth + 1,
            maxDepth,
            counter
          );
        }
      }
    } catch {
      // Ignore errors during counting
    }
  }

  private matchesPatterns(filename: string, fullPath: string, options: ScanOptions): boolean {
    // Check exclude patterns first
    if (options.excludePatterns?.length) {
      for (const pattern of options.excludePatterns) {
        if (this.matchesGlob(filename, pattern) || this.matchesGlob(fullPath, pattern)) {
          return false;
        }
      }
    }

    // Check include patterns if specified
    if (options.includePatterns?.length) {
      for (const pattern of options.includePatterns) {
        if (this.matchesGlob(filename, pattern) || this.matchesGlob(fullPath, pattern)) {
          return true;
        }
      }
      return false; // Include patterns specified but none matched
    }

    return true; // No include patterns or matched exclude patterns
  }

  private matchesGlob(text: string, pattern: string): boolean {
    // Simple glob matching - convert to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(text);
  }

  private formatPermissions(mode: number): string {
    // Extract permission bits (last 3 octets)
    const perms = mode & parseInt('777', 8);
    return perms.toString(8);
  }
}
