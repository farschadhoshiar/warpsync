import { logger } from "@/lib/logger";
import { EventEmitter } from "../websocket/emitter";
import { RemoteScanner } from "./remote-scanner";
import { LocalScanner } from "./local-scanner";
import { SSHConnectionConfig } from "../ssh/types";
import { SSHConnectionManager } from "../ssh/ssh-connection";
import connectDB from "@/lib/mongodb";
import { calculateAllDirectoryStats, FileStateRecord } from "./directory-stats";
import {
  DirectoryComparison,
  FileComparison,
  FileMetadata,
  DirectoryMetadata,
  FileState as ScanFileState,
  ScanOptions,
  ScanProgress,
  ComparisonStats,
  AutoQueueConfig,
  PatternMatcher,
} from "./types";

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
   * Test SSH connection before starting scan
   */
  async testSSHConnection(
    config: SSHConnectionConfig,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const sshManager = SSHConnectionManager.getInstance();
      const result = await sshManager.testConnection(config);
      return result;
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "SSH connection test failed",
      };
    }
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
    autoQueueConfig?: AutoQueueConfig,
  ): Promise<DirectoryComparison> {
    logger.info(
      {
        jobId,
        remotePath,
        localPath,
        options,
      },
      "Starting directory comparison",
    );

    const startTime = Date.now();

    try {
      // Emit scan start via log message
      this.eventEmitter?.emitLogMessage({
        jobId,
        level: "info",
        message: `Starting directory scan: ${remotePath} -> ${localPath}`,
        source: "scanner",
        timestamp: new Date().toISOString(),
      });

      logger.info({ jobId, remotePath }, "Starting remote directory scan");

      // Scan remote directory
      const remoteProgress = (progress: ScanProgress) => {
        this.eventEmitter?.emitLogMessage({
          jobId,
          level: "debug",
          message: `Remote scan: ${progress.currentPath} (${progress.filesScanned} files, ${progress.bytesScanned} bytes)`,
          source: "scanner",
          timestamp: new Date().toISOString(),
        });
      };

      const remoteResult = await this.remoteScanner.scanDirectory(
        config,
        remotePath,
        options,
        remoteProgress,
      );

      logger.info(
        {
          jobId,
          filesFound: remoteResult.files.length,
          totalSize: remoteResult.totalSize,
        },
        "Remote scan completed",
      );

      // Scan local directory
      logger.info({ jobId, localPath }, "Starting local directory scan");

      const localProgress = (progress: ScanProgress) => {
        this.eventEmitter?.emitLogMessage({
          jobId,
          level: "debug",
          message: `Local scan: ${progress.currentPath} (${progress.filesScanned} files, ${progress.bytesScanned} bytes)`,
          source: "scanner",
          timestamp: new Date().toISOString(),
        });
      };

      let localResult;
      try {
        localResult = await this.localScanner.scanDirectory(
          localPath,
          options,
          localProgress,
        );

        logger.info(
          {
            jobId,
            filesFound: localResult.files.length,
            totalSize: localResult.totalSize,
          },
          "Local scan completed",
        );
      } catch (localError) {
        logger.error(
          {
            jobId,
            localPath,
            error:
              localError instanceof Error
                ? localError.message
                : "Unknown error",
            stack: localError instanceof Error ? localError.stack : undefined,
          },
          "Local scan failed",
        );
        throw localError;
      }

      // Create file maps for efficient comparison
      const remoteFiles = this.createFileMap(remoteResult.files, remotePath);
      const localFiles = this.createFileMap(localResult.files, localPath);

      // Create directory maps for directory-level operations
      const remoteDirectories = this.createDirectoryMap(
        remoteResult.files,
        remotePath,
      );
      const localDirectories = this.createDirectoryMap(
        localResult.files,
        localPath,
      );

      // Compare files and determine states
      const comparison = await this.performComparison(
        jobId,
        remotePath,
        localPath,
        remoteFiles,
        localFiles,
        remoteDirectories,
        localDirectories,
        autoQueueConfig,
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
        timestamp: new Date().toISOString(),
      });

      logger.info(
        {
          jobId,
          duration,
          stats: comparison.stats,
        },
        "Directory comparison completed",
      );

      return comparison;
    } catch (error) {
      logger.error(
        {
          jobId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Directory comparison failed",
      );
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
    relativePath: string,
  ): Promise<FileComparison> {
    const remoteFilePath = this.joinPaths(remotePath, relativePath);
    const localFilePath = this.joinPaths(localPath, relativePath);

    try {
      const [remoteExists, localExists] = await Promise.all([
        this.remoteScanner.pathExists(config, remoteFilePath),
        this.localScanner.pathExists(localFilePath),
      ]);

      let remote: FileMetadata | undefined;
      let local: FileMetadata | undefined;

      if (remoteExists) {
        remote = await this.remoteScanner
          .scanDirectory(config, remoteFilePath)
          .then((result) => result.files[0])
          .catch(() => undefined);
      }

      if (localExists) {
        local = await this.localScanner
          .getFileInfo(localFilePath)
          .catch(() => undefined);
      }

      const state = this.determineFileState(remote, local);
      const comparison = this.createFileComparison(
        relativePath,
        remote,
        local,
        state,
      );

      return comparison;
    } catch (error) {
      logger.error(
        {
          relativePath,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Failed to get file comparison",
      );

      return {
        relativePath,
        filename: relativePath.split("/").pop() || relativePath,
        state: ScanFileState.FAILED,
      };
    }
  }

  private async performComparison(
    jobId: string,
    remotePath: string,
    localPath: string,
    remoteFiles: Map<string, FileMetadata>,
    localFiles: Map<string, FileMetadata>,
    remoteDirectories: Map<string, DirectoryMetadata>,
    localDirectories: Map<string, DirectoryMetadata>,
    autoQueueConfig?: AutoQueueConfig,
  ): Promise<DirectoryComparison> {
    const stats: ComparisonStats = {
      totalRemote: remoteFiles.size,
      totalLocal: localFiles.size,
      totalRemoteDirectories: remoteDirectories.size,
      totalLocalDirectories: localDirectories.size,
      synced: 0,
      remoteOnly: 0,
      localOnly: 0,
      desynced: 0,
      directoriesSynced: 0,
      directoriesRemoteOnly: 0,
      directoriesLocalOnly: 0,
      directoriesDesynced: 0,
      totalSizeRemote: 0,
      totalSizeLocal: 0,
    };

    // Calculate total sizes
    for (const file of remoteFiles.values()) {
      stats.totalSizeRemote += file.size;
    }
    for (const file of localFiles.values()) {
      stats.totalSizeLocal += file.size;
    }

    // Get all unique relative paths (files and directories)
    const allFilePaths = new Set([...remoteFiles.keys(), ...localFiles.keys()]);
    const allDirectoryPaths = new Set([
      ...remoteDirectories.keys(),
      ...localDirectories.keys(),
    ]);
    const allPaths = new Set([...allFilePaths, ...allDirectoryPaths]);

    // Emit comparison progress via log
    this.eventEmitter?.emitLogMessage({
      jobId,
      level: "info",
      message: `Comparing ${allPaths.size} items (${allFilePaths.size} files, ${allDirectoryPaths.size} directories) between remote and local`,
      source: "scanner",
      timestamp: new Date().toISOString(),
    });

    let processedFiles = 0;
    const queuedFiles: string[] = [];

    // Connect to database and prepare FileState operations
    await connectDB();
    const { FileState } = await import("@/models");

    // Clear existing FileState records for this job
    await FileState.deleteMany({ jobId });

    // Process files in batches for better performance
    const batchSize = 100;
    const pathArray = Array.from(allPaths);
    const fileStateRecords = [];

    for (let i = 0; i < pathArray.length; i += batchSize) {
      const batch = pathArray.slice(i, i + batchSize);

      for (const relativePath of batch) {
        const remote =
          remoteFiles.get(relativePath) || remoteDirectories.get(relativePath);
        const local =
          localFiles.get(relativePath) || localDirectories.get(relativePath);
        const isDirectory =
          remoteDirectories.has(relativePath) ||
          localDirectories.has(relativePath);
        const state = this.determineFileState(remote, local);

        // Update statistics
        if (isDirectory) {
          switch (state) {
            case ScanFileState.SYNCED:
              stats.directoriesSynced++;
              break;
            case ScanFileState.REMOTE_ONLY:
              stats.directoriesRemoteOnly++;
              break;
            case ScanFileState.LOCAL_ONLY:
              stats.directoriesLocalOnly++;
              break;
            case ScanFileState.DESYNCED:
              stats.directoriesDesynced++;
              break;
          }
        } else {
          switch (state) {
            case ScanFileState.SYNCED:
              stats.synced++;
              break;
            case ScanFileState.REMOTE_ONLY:
              stats.remoteOnly++;
              // Check for auto-queue
              if (
                autoQueueConfig?.enabled &&
                remote &&
                this.shouldAutoQueue(remote, autoQueueConfig)
              ) {
                queuedFiles.push(relativePath);
              }
              break;
            case ScanFileState.LOCAL_ONLY:
              stats.localOnly++;
              break;
            case ScanFileState.DESYNCED:
              stats.desynced++;
              break;
          }
        }

        // Create FileState record
        const filename = relativePath.split("/").pop() || relativePath;
        const parentPath = relativePath.includes("/")
          ? relativePath.substring(0, relativePath.lastIndexOf("/"))
          : "";

        const fileStateRecord = {
          jobId,
          relativePath,
          filename,
          isDirectory,
          parentPath,
          remote: {
            size: remote?.size,
            modTime: remote?.modTime,
            exists: !!remote,
            isDirectory: remote?.isDirectory || false,
          },
          local: {
            size: local?.size,
            modTime: local?.modTime,
            exists: !!local,
            isDirectory: local?.isDirectory || false,
          },
          syncState: this.mapFileStateToSyncState(state),
          transfer: {
            progress: 0,
            retryCount: 0,
          },
          directorySize: isDirectory ? remote?.size || local?.size || 0 : 0,
          fileCount:
            isDirectory && "fileCount" in (remote || local || {})
              ? (remote as DirectoryMetadata)?.fileCount ||
                (local as DirectoryMetadata)?.fileCount ||
                0
              : 0,
          lastSeen: new Date(),
          addedAt: new Date(),
        };

        fileStateRecords.push(fileStateRecord);
        processedFiles++;

        // Emit progress update every 100 files
        if (processedFiles % 100 === 0) {
          this.eventEmitter?.emitLogMessage({
            jobId,
            level: "debug",
            message: `Comparison progress: ${processedFiles}/${allPaths.size} files processed`,
            source: "scanner",
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // Bulk insert FileState records
    if (fileStateRecords.length > 0) {
      await FileState.insertMany(fileStateRecords);
      logger.info(
        {
          jobId,
          count: fileStateRecords.length,
        },
        "Persisted FileState records to database",
      );

      // Calculate and update directory statistics
      logger.info({ jobId }, "Calculating directory statistics");
      try {
        const allFileStates = fileStateRecords as unknown as FileStateRecord[];
        const statsMap = calculateAllDirectoryStats(allFileStates);

        // Update directories with calculated statistics
        const bulkOps = [];
        for (const [directoryPath, stats] of statsMap) {
          bulkOps.push({
            updateOne: {
              filter: {
                jobId,
                relativePath: directoryPath,
                isDirectory: true,
              },
              update: {
                $set: {
                  directorySize: stats.directorySize,
                  fileCount: stats.fileCount,
                },
              },
            },
          });
        }

        if (bulkOps.length > 0) {
          await FileState.bulkWrite(bulkOps);
          logger.info(
            {
              jobId,
              directoriesUpdated: bulkOps.length,
            },
            "Updated directory statistics",
          );
        }
      } catch (error) {
        logger.error(
          {
            jobId,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Failed to calculate directory statistics",
        );
      }
    }

    // Log auto-queued files
    if (queuedFiles.length > 0) {
      logger.info(
        {
          jobId,
          count: queuedFiles.length,
          files: queuedFiles.slice(0, 10), // Log first 10 files
        },
        "Auto-queued files for download",
      );
    }

    return {
      remotePath,
      localPath,
      remoteFiles,
      localFiles,
      remoteDirectories,
      localDirectories,
      comparedAt: new Date(),
      stats,
    };
  }

  private createFileMap(
    files: FileMetadata[],
    basePath: string,
  ): Map<string, FileMetadata> {
    const fileMap = new Map<string, FileMetadata>();

    for (const file of files) {
      if (!file.isDirectory) {
        const relativePath = this.getRelativePath(file.path, basePath);
        fileMap.set(relativePath, file);
      }
    }

    return fileMap;
  }

  private createDirectoryMap(
    files: FileMetadata[],
    basePath: string,
  ): Map<string, DirectoryMetadata> {
    const directoryMap = new Map<string, DirectoryMetadata>();

    for (const file of files) {
      if (file.isDirectory) {
        const relativePath = this.getRelativePath(file.path, basePath);
        const directoryMetadata: DirectoryMetadata = {
          ...file,
          isDirectory: true as const,
          totalSize: file.size,
          fileCount: 0,
          childFiles: [],
          childDirectories: [],
        };
        directoryMap.set(relativePath, directoryMetadata);
      }
    }

    return directoryMap;
  }

  private getRelativePath(fullPath: string, basePath: string): string {
    // Normalize paths and get relative path
    const normalizedBase = basePath.replace(/\\/g, "/").replace(/\/$/, "");
    const normalizedFull = fullPath.replace(/\\/g, "/");

    if (normalizedFull.startsWith(normalizedBase)) {
      return normalizedFull.substring(normalizedBase.length).replace(/^\//, "");
    }

    return normalizedFull;
  }

  private determineFileState(
    remote?: FileMetadata,
    local?: FileMetadata,
  ): ScanFileState {
    if (!remote && !local) {
      return ScanFileState.FAILED;
    }

    if (!remote) {
      return ScanFileState.LOCAL_ONLY;
    }

    if (!local) {
      return ScanFileState.REMOTE_ONLY;
    }

    // Both files exist - check if they're synced
    const sizeDiff = Math.abs(remote.size - local.size);
    const timeDiff = Math.abs(
      remote.modTime.getTime() - local.modTime.getTime(),
    );

    // Consider files synced if size matches and time difference is less than 2 seconds
    if (sizeDiff === 0 && timeDiff < 2000) {
      return ScanFileState.SYNCED;
    }

    return ScanFileState.DESYNCED;
  }

  private createFileComparison(
    relativePath: string,
    remote?: FileMetadata,
    local?: FileMetadata,
    state?: ScanFileState,
  ): FileComparison {
    const filename = relativePath.split("/").pop() || relativePath;
    const actualState = state || this.determineFileState(remote, local);

    const comparison: FileComparison = {
      relativePath,
      filename,
      state: actualState,
      remote,
      local,
    };

    if (remote && local) {
      comparison.sizeDifference = remote.size - local.size;
      comparison.timeDifference =
        remote.modTime.getTime() - local.modTime.getTime();
    }

    return comparison;
  }

  private shouldAutoQueue(
    file: FileMetadata,
    config: AutoQueueConfig,
  ): boolean {
    // Check file size limits
    if (config.minFileSize && file.size < config.minFileSize) {
      return false;
    }
    if (config.maxFileSize && file.size > config.maxFileSize) {
      return false;
    }

    // Check extension filters
    const extension = file.name.split(".").pop()?.toLowerCase() || "";

    if (config.excludeExtensions?.includes(extension)) {
      return false;
    }

    if (
      config.includeExtensions?.length &&
      !config.includeExtensions.includes(extension)
    ) {
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

  private matchesPatternMatcher(
    filename: string,
    fullPath: string,
    matcher: PatternMatcher,
  ): boolean {
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
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
  }

  private joinPaths(basePath: string, relativePath: string): string {
    return basePath.replace(/\/$/, "") + "/" + relativePath.replace(/^\//, "");
  }

  private mapFileStateToSyncState(state: ScanFileState): string {
    switch (state) {
      case ScanFileState.SYNCED:
        return "synced";
      case ScanFileState.REMOTE_ONLY:
        return "remote_only";
      case ScanFileState.LOCAL_ONLY:
        return "local_only";
      case ScanFileState.DESYNCED:
        return "desynced";
      case ScanFileState.FAILED:
        return "failed";
      default:
        return "failed";
    }
  }
}
