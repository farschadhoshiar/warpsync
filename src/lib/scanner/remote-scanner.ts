import { SSHConnectionManager } from '../ssh/ssh-connection';
import { SSHConnectionConfig } from '../ssh/types';
import { logger } from '@/lib/logger';
import { normalizeRemotePath } from '../ssh/utils';
import { 
  FileMetadata, 
  ScanResult, 
  ScanOptions, 
  ScanProgress,
  DEFAULT_SCAN_OPTIONS 
} from './types';

export class RemoteScanner {
  private sshManager: SSHConnectionManager;

  constructor() {
    this.sshManager = SSHConnectionManager.getInstance();
  }

  /**
   * Scan remote directory and return file metadata
   */
  async scanDirectory(
    config: SSHConnectionConfig,
    remotePath: string,
    options: Partial<ScanOptions> = {},
    onProgress?: (progress: ScanProgress) => void
  ): Promise<ScanResult> {
    const scanOptions = { ...DEFAULT_SCAN_OPTIONS, ...options };
    const normalizedPath = normalizeRemotePath(remotePath);
    
    logger.info('Starting remote directory scan', {
      host: config.host,
      remotePath: normalizedPath,
      options: scanOptions
    });

    const startTime = Date.now();
    const progress: ScanProgress = {
      jobId: `scan_${Date.now()}`,
      phase: 'remote',
      currentPath: normalizedPath,
      filesScanned: 0,
      bytesScanned: 0,
      startTime: new Date(),
      errors: []
    };

    try {
      const files = await this.scanRecursive(
        config,
        normalizedPath,
        scanOptions,
        progress,
        onProgress
      );

      const result: ScanResult = {
        path: normalizedPath,
        files,
        scannedAt: new Date(),
        totalFiles: files.length,
        totalSize: files.reduce((sum, file) => sum + file.size, 0),
        errors: progress.errors
      };

      logger.info('Remote scan completed', {
        path: normalizedPath,
        totalFiles: result.totalFiles,
        totalSize: result.totalSize,
        duration: Date.now() - startTime,
        errors: result.errors.length
      });

      return result;
    } catch (error) {
      logger.error('Remote scan failed', {
        path: normalizedPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Check if remote path exists
   */
  async pathExists(config: SSHConnectionConfig, remotePath: string): Promise<boolean> {
    try {
      return await this.sshManager.pathExists(config, remotePath);
    } catch (error) {
      logger.error('Failed to check remote path existence', {
        path: remotePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Get file count estimate for progress tracking
   */
  async getFileCountEstimate(
    config: SSHConnectionConfig,
    remotePath: string,
    _maxDepth = 3 // TODO: Implement depth-limited scanning
  ): Promise<number> {
    try {
      // Use a simplified approach without direct pool access
      const testResult = await this.sshManager.testConnection(config);
      if (!testResult.success) {
        return 0;
      }
      
      // For now, return a default estimate
      // TODO: Implement proper file counting with depth limit of ${_maxDepth}
      return 100;
    } catch {
      return 0;
    }
  }

  private async scanRecursive(
    config: SSHConnectionConfig,
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

      const listing = await this.sshManager.listDirectory(config, currentPath);
      
      for (const file of listing.files) {
        try {
          // Skip hidden files if not included
          if (!options.includeHidden && file.name.startsWith('.')) {
            continue;
          }

          // Apply pattern filters
          if (!this.matchesPatterns(file.name, file.path, options)) {
            continue;
          }

          // Update progress
          progress.filesScanned++;
          progress.bytesScanned += file.size;
          
          if (file.isDirectory) {
            // Recursively scan subdirectories
            if (options.followSymlinks || !this.isSymlink(file)) {
              const subFiles = await this.scanRecursive(
                config,
                file.path,
                options,
                progress,
                onProgress,
                currentDepth + 1
              );
              files.push(...subFiles);
            }
            
            // Add directory itself
            files.push(this.convertToFileMetadata(file));
          } else {
            // Add regular file
            files.push(this.convertToFileMetadata(file));
          }

          onProgress?.(progress);
        } catch (error) {
          const errorMsg = `Failed to process ${file.path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
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

  private isSymlink(file: FileMetadata): boolean {
    // Check if permissions string indicates symlink
    return file.permissions?.startsWith('l') || false;
  }

  private convertToFileMetadata(sshFile: FileMetadata): FileMetadata {
    return {
      path: sshFile.path,
      name: sshFile.name,
      size: sshFile.size,
      modTime: sshFile.modTime,
      isDirectory: sshFile.isDirectory,
      permissions: sshFile.permissions
    };
  }
}
