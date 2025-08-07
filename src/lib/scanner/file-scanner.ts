import { logger } from '@/lib/logger';
import { EventEmitter } from '../websocket/emitter';
import { RemoteScanner } from './remote-scanner';
import { LocalScanner } from './local-scanner';
import { SSHConnectionConfig } from '../ssh/types';
import { 
  DirectoryComparison, 
  FileComparison, 
  FileMetadata, 
  FileState, 
  ScanOptions, 
  ScanProgress,
  ComparisonStats,
  AutoQueueConfig,
  PatternMatcher
} from './types';

export class FileScanner {
  private remoteScanner: RemoteScanner;
  private localScanner: LocalScanner;
  private eventEmitter?: EventEmitter;

  constructor(eventEmitter?: EventEmitter) {
    this.remoteScanner = new RemoteScanner();
    this.localScanner = new LocalScanner();
    this.eventEmitter = eventEmitter;
  }

  /**
   * Perform complete directory comparison between remote and local paths
   */
  async compareDirectories(
    jobId: string,
    config: SSHConnectionConfig,
    remotePath: string,
    localPath: string,
    options: Partial<ScanOptions> = {},
    autoQueueConfig?: AutoQueueConfig
  ): Promise<DirectoryComparison> {
    logger.info('Starting directory comparison', {
      jobId,
      remotePath,
      localPath,
      options
    });

    const startTime = Date.now();

    try {
      // Emit scan start via log message
      this.eventEmitter?.emitLogMessage({
        jobId,
        level: 'info',
        message: `Starting directory scan: ${remotePath} -> ${localPath}`,
        source: 'scanner',
        timestamp: new Date().toISOString()
      });

      // Scan remote directory
      const remoteProgress = (progress: ScanProgress) => {
        this.eventEmitter?.emitLogMessage({
          jobId,
          level: 'debug',
          message: `Remote scan: ${progress.currentPath} (${progress.filesScanned} files, ${progress.bytesScanned} bytes)`,
          source: 'scanner',
          timestamp: new Date().toISOString()
        });
      };

      const remoteResult = await this.remoteScanner.scanDirectory(
        config,
        remotePath,
        options,
        remoteProgress
      );

      // Scan local directory
      const localProgress = (progress: ScanProgress) => {
        this.eventEmitter?.emitLogMessage({
          jobId,
          level: 'debug',
          message: `Local scan: ${progress.currentPath} (${progress.filesScanned} files, ${progress.bytesScanned} bytes)`,
          source: 'scanner',
          timestamp: new Date().toISOString()
        });
      };

      const localResult = await this.localScanner.scanDirectory(
        localPath,
        options,
        localProgress
      );

      // Create file maps for efficient comparison
      const remoteFiles = this.createFileMap(remoteResult.files, remotePath);
      const localFiles = this.createFileMap(localResult.files, localPath);

      // Compare files and determine states
      const comparison = await this.performComparison(
        jobId,
        remotePath,
        localPath,
        remoteFiles,
        localFiles,
        autoQueueConfig
      );

      const duration = Date.now() - startTime;

      // Emit scan completion event
      this.eventEmitter?.emitScanComplete({
        jobId,
        jobName: `Scan Job ${jobId}`,
        remotePath,
        localPath,
        filesFound: comparison.stats.totalRemote + comparison.stats.totalLocal,
        filesAdded: comparison.stats.remoteOnly,
        filesUpdated: comparison.stats.desynced,
        filesRemoved: comparison.stats.localOnly,
        duration,
        timestamp: new Date().toISOString()
      });

      logger.info('Directory comparison completed', {
        jobId,
        duration,
        stats: comparison.stats
      });

      return comparison;
    } catch (error) {
      logger.error('Directory comparison failed', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get file comparison for a specific relative path
   */
  async getFileComparison(
    config: SSHConnectionConfig,
    remotePath: string,
    localPath: string,
    relativePath: string
  ): Promise<FileComparison> {
    const remoteFilePath = this.joinPaths(remotePath, relativePath);
    const localFilePath = this.joinPaths(localPath, relativePath);

    try {
      const [remoteExists, localExists] = await Promise.all([
        this.remoteScanner.pathExists(config, remoteFilePath),
        this.localScanner.pathExists(localFilePath)
      ]);

      let remote: FileMetadata | undefined;
      let local: FileMetadata | undefined;

      if (remoteExists) {
        remote = await this.remoteScanner.scanDirectory(config, remoteFilePath)
          .then(result => result.files[0])
          .catch(() => undefined);
      }

      if (localExists) {
        local = await this.localScanner.getFileInfo(localFilePath)
          .catch(() => undefined);
      }

      const state = this.determineFileState(remote, local);
      const comparison = this.createFileComparison(relativePath, remote, local, state);

      return comparison;
    } catch (error) {
      logger.error('Failed to get file comparison', {
        relativePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        relativePath,
        filename: relativePath.split('/').pop() || relativePath,
        state: FileState.FAILED
      };
    }
  }

  private async performComparison(
    jobId: string,
    remotePath: string,
    localPath: string,
    remoteFiles: Map<string, FileMetadata>,
    localFiles: Map<string, FileMetadata>,
    autoQueueConfig?: AutoQueueConfig
  ): Promise<DirectoryComparison> {
    const stats: ComparisonStats = {
      totalRemote: remoteFiles.size,
      totalLocal: localFiles.size,
      synced: 0,
      remoteOnly: 0,
      localOnly: 0,
      desynced: 0,
      totalSizeRemote: 0,
      totalSizeLocal: 0
    };

    // Calculate total sizes
    for (const file of remoteFiles.values()) {
      stats.totalSizeRemote += file.size;
    }
    for (const file of localFiles.values()) {
      stats.totalSizeLocal += file.size;
    }

    // Get all unique relative paths
    const allPaths = new Set([...remoteFiles.keys(), ...localFiles.keys()]);
    
    // Emit comparison progress via log
    this.eventEmitter?.emitLogMessage({
      jobId,
      level: 'info',
      message: `Comparing ${allPaths.size} files between remote and local`,
      source: 'scanner',
      timestamp: new Date().toISOString()
    });

    let processedFiles = 0;
    const queuedFiles: string[] = [];

    for (const relativePath of allPaths) {
      const remote = remoteFiles.get(relativePath);
      const local = localFiles.get(relativePath);
      const state = this.determineFileState(remote, local);

      // Update statistics
      switch (state) {
        case FileState.SYNCED:
          stats.synced++;
          break;
        case FileState.REMOTE_ONLY:
          stats.remoteOnly++;
          // Check for auto-queue
          if (autoQueueConfig?.enabled && remote && this.shouldAutoQueue(remote, autoQueueConfig)) {
            queuedFiles.push(relativePath);
          }
          break;
        case FileState.LOCAL_ONLY:
          stats.localOnly++;
          break;
        case FileState.DESYNCED:
          stats.desynced++;
          break;
      }

      processedFiles++;
      
      // Emit progress update every 100 files
      if (processedFiles % 100 === 0) {
        this.eventEmitter?.emitLogMessage({
          jobId,
          level: 'debug',
          message: `Comparison progress: ${processedFiles}/${allPaths.size} files processed`,
          source: 'scanner',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Log auto-queued files
    if (queuedFiles.length > 0) {
      logger.info('Auto-queued files for download', {
        jobId,
        count: queuedFiles.length,
        files: queuedFiles.slice(0, 10) // Log first 10 files
      });
    }

    return {
      remotePath,
      localPath,
      remoteFiles,
      localFiles,
      comparedAt: new Date(),
      stats
    };
  }

  private createFileMap(files: FileMetadata[], basePath: string): Map<string, FileMetadata> {
    const fileMap = new Map<string, FileMetadata>();
    
    for (const file of files) {
      const relativePath = this.getRelativePath(file.path, basePath);
      fileMap.set(relativePath, file);
    }
    
    return fileMap;
  }

  private getRelativePath(fullPath: string, basePath: string): string {
    // Normalize paths and get relative path
    const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/$/, '');
    const normalizedFull = fullPath.replace(/\\/g, '/');
    
    if (normalizedFull.startsWith(normalizedBase)) {
      return normalizedFull.substring(normalizedBase.length).replace(/^\//, '');
    }
    
    return normalizedFull;
  }

  private determineFileState(remote?: FileMetadata, local?: FileMetadata): FileState {
    if (!remote && !local) {
      return FileState.FAILED;
    }
    
    if (!remote) {
      return FileState.LOCAL_ONLY;
    }
    
    if (!local) {
      return FileState.REMOTE_ONLY;
    }
    
    // Both files exist - check if they're synced
    const sizeDiff = Math.abs(remote.size - local.size);
    const timeDiff = Math.abs(remote.modTime.getTime() - local.modTime.getTime());
    
    // Consider files synced if size matches and time difference is less than 2 seconds
    if (sizeDiff === 0 && timeDiff < 2000) {
      return FileState.SYNCED;
    }
    
    return FileState.DESYNCED;
  }

  private createFileComparison(
    relativePath: string,
    remote?: FileMetadata,
    local?: FileMetadata,
    state?: FileState
  ): FileComparison {
    const filename = relativePath.split('/').pop() || relativePath;
    const actualState = state || this.determineFileState(remote, local);
    
    const comparison: FileComparison = {
      relativePath,
      filename,
      state: actualState,
      remote,
      local
    };

    if (remote && local) {
      comparison.sizeDifference = remote.size - local.size;
      comparison.timeDifference = remote.modTime.getTime() - local.modTime.getTime();
    }

    return comparison;
  }

  private shouldAutoQueue(file: FileMetadata, config: AutoQueueConfig): boolean {
    // Check file size limits
    if (config.minFileSize && file.size < config.minFileSize) {
      return false;
    }
    if (config.maxFileSize && file.size > config.maxFileSize) {
      return false;
    }

    // Check extension filters
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    
    if (config.excludeExtensions?.includes(extension)) {
      return false;
    }
    
    if (config.includeExtensions?.length && !config.includeExtensions.includes(extension)) {
      return false;
    }

    // Check pattern matchers
    for (const matcher of config.patterns) {
      const matches = this.matchesPatternMatcher(file.name, file.path, matcher);
      
      if (matcher.isInclude && !matches) {
        return false;
      }
      if (!matcher.isInclude && matches) {
        return false;
      }
    }

    return true;
  }

  private matchesPatternMatcher(filename: string, fullPath: string, matcher: PatternMatcher): boolean {
    const targets = [filename, fullPath];
    
    for (const pattern of matcher.patterns) {
      for (const target of targets) {
        const text = matcher.caseSensitive ? target : target.toLowerCase();
        const pat = matcher.caseSensitive ? pattern : pattern.toLowerCase();
        
        if (this.matchesGlob(text, pat)) {
          return true;
        }
      }
    }
    
    return false;
  }

  private matchesGlob(text: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
  }

  private joinPaths(basePath: string, relativePath: string): string {
    return basePath.replace(/\/$/, '') + '/' + relativePath.replace(/^\//, '');
  }
}
