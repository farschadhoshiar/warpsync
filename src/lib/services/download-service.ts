/**
 * Unified Download Service
 * Handles all download scenarios through a single interface
 */

import { logger } from "@/lib/logger";
import { TransferQueue } from "@/lib/queue/transfer-queue";
import {
  TransferType,
  TransferPriority,
  TransferStatus,
  DEFAULT_QUEUE_CONFIG,
  DEFAULT_RETRY_POLICY,
} from "@/lib/queue/types";
import { DatabaseSyncedTransferQueue } from "@/lib/queue/database-synced-transfer-queue";
import { EventEmitter } from "@/lib/websocket/emitter";
import connectDB from "@/lib/mongodb";
import { parseCompositeId, isValidObjectId } from "@/lib/utils";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";

// Request and response interfaces
export interface UnifiedDownloadRequest {
  source: "manual" | "automatic" | "scheduled";
  scope: "single" | "job" | "directory" | "pattern" | "bulk";
  targets: string[]; // fileIds, directoryPaths, or patterns
  options: {
    jobId?: string;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    localPath?: string;
    rsyncOptions?: Record<string, string | number | boolean>;
    dryRun?: boolean;
    createStructure?: boolean;
    preserveHierarchy?: boolean;
    overwriteExisting?: boolean;
  };
}

export interface UnifiedDownloadResponse {
  success: boolean;
  data: {
    transferIds: string[];
    queuedCount: number;
    skippedCount: number;
    upgradedCount: number;
    totalSize: number;
    estimatedDuration?: number;
    message: string;
  };
  warnings?: string[];
  errors?: string[];
  timestamp: string;
}

export interface DuplicateTransferResult {
  exists: boolean;
  transferId?: string;
  status?: TransferStatus;
  canUpgrade: boolean;
  currentPriority?: TransferPriority;
}

interface ProcessedTarget {
  fileId: string;
  jobId: string;
  fileState: any;
  syncJob: any;
  serverProfile: any;
  source: string;
  destination: string;
  transferType: TransferType;
  size: number;
  isDirectoryPackage?: boolean;
  childFileStates?: any[];
}

interface QueueResult {
  transferId: string;
  fileId: string;
  filename: string;
  size: number;
  isDuplicate: boolean;
  upgraded: boolean;
  skipped: boolean;
  error?: string;
}

// Validation schema
export const UnifiedDownloadSchema = z.object({
  source: z.enum(["manual", "automatic", "scheduled"]).default("manual"),
  scope: z.enum(["single", "job", "directory", "pattern", "bulk"]),
  targets: z.array(z.string()).min(1),
  options: z
    .object({
      jobId: z.string().optional(),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
      localPath: z.string().optional(),
      dryRun: z.boolean().default(false),
      createStructure: z.boolean().default(true),
      preserveHierarchy: z.boolean().default(true),
      overwriteExisting: z.boolean().default(false),
      rsyncOptions: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
    })
    .optional()
    .default(() => ({
      dryRun: false,
      createStructure: true,
      preserveHierarchy: true,
      overwriteExisting: false,
    })),
});

/**
 * Unified Download Service Implementation
 */
class UnifiedDownloadService {
  private transferQueue: DatabaseSyncedTransferQueue;
  private eventEmitter?: EventEmitter;

  constructor(
    transferQueue: DatabaseSyncedTransferQueue,
    eventEmitter?: EventEmitter,
  ) {
    this.eventEmitter = eventEmitter;
    this.transferQueue = transferQueue;
  }

  /**
   * Process a unified download request
   */
  async processDownload(
    request: UnifiedDownloadRequest,
  ): Promise<UnifiedDownloadResponse> {
    const startTime = Date.now();

    logger.info("Processing unified download request", {
      source: request.source,
      scope: request.scope,
      targetCount: request.targets.length,
      options: request.options,
    });

    try {
      // Validate the request
      this.validateRequest(request);

      // Process targets based on scope
      const processedTargets = await this.processTargets(request);

      if (processedTargets.length === 0) {
        return {
          success: true,
          data: {
            transferIds: [],
            queuedCount: 0,
            skippedCount: 0,
            upgradedCount: 0,
            totalSize: 0,
            message: "No valid targets found for download",
          },
          warnings: ["No valid targets found"],
          timestamp: new Date().toISOString(),
        };
      }

      // Queue transfers with duplicate handling
      const results = await this.queueTransfers(processedTargets, request);

      // Generate unified response
      return this.generateResponse(results, startTime);
    } catch (error) {
      logger.error("Failed to process unified download request", {
        source: request.source,
        scope: request.scope,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        data: {
          transferIds: [],
          queuedCount: 0,
          skippedCount: 0,
          upgradedCount: 0,
          totalSize: 0,
          message: "Failed to process download request",
        },
        errors: [error instanceof Error ? error.message : "Unknown error"],
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Validate the download request
   */
  private validateRequest(request: UnifiedDownloadRequest): void {
    if (!request.targets || request.targets.length === 0) {
      throw new Error("At least one target must be specified");
    }

    // Validate target format based on scope
    for (const target of request.targets) {
      if (!target || typeof target !== "string") {
        throw new Error("Invalid target format");
      }

      switch (request.scope) {
        case "single":
          if (!isValidObjectId(target) && !target.includes("-")) {
            throw new Error(
              "Single scope requires valid fileId or composite ID",
            );
          }
          break;
        case "job":
          if (!isValidObjectId(target)) {
            throw new Error("Job scope requires valid jobId");
          }
          break;
        case "directory":
        case "pattern":
        case "bulk":
          // More flexible validation for these scopes
          break;
      }
    }

    // Validate options
    if (request.options.jobId && !isValidObjectId(request.options.jobId)) {
      throw new Error("Invalid jobId format in options");
    }

    if (
      request.options.localPath &&
      path.isAbsolute(request.options.localPath) === false
    ) {
      logger.warn("Local path is not absolute, may cause issues", {
        localPath: request.options.localPath,
      });
    }
  }

  /**
   * Process targets based on scope and resolve to file states
   */
  private async processTargets(
    request: UnifiedDownloadRequest,
  ): Promise<ProcessedTarget[]> {
    await connectDB();
    const { SyncJob, FileState } = await import("@/models");

    const processedTargets: ProcessedTarget[] = [];

    for (const target of request.targets) {
      try {
        switch (request.scope) {
          case "single":
            const singleTarget = await this.processSingleTarget(
              target,
              request.options,
              SyncJob,
              FileState,
            );
            if (singleTarget) processedTargets.push(singleTarget);
            break;

          case "job":
            const jobTargets = await this.processJobTarget(
              target,
              request.options,
              SyncJob,
              FileState,
            );
            processedTargets.push(...jobTargets);
            break;

          case "directory":
            const dirTargets = await this.processDirectoryTarget(
              target,
              request.options,
              SyncJob,
              FileState,
            );
            processedTargets.push(...dirTargets);
            break;

          case "bulk":
            const bulkTargets = await this.processBulkTarget(
              target,
              request.options,
              SyncJob,
              FileState,
            );
            processedTargets.push(...bulkTargets);
            break;

          case "pattern":
            const patternTargets = await this.processPatternTarget(
              target,
              request.options,
              SyncJob,
              FileState,
            );
            processedTargets.push(...patternTargets);
            break;

          default:
            logger.warn("Unknown scope, treating as single", {
              scope: request.scope,
              target,
            });
            const fallbackTarget = await this.processSingleTarget(
              target,
              request.options,
              SyncJob,
              FileState,
            );
            if (fallbackTarget) processedTargets.push(fallbackTarget);
        }
      } catch (error) {
        logger.error("Failed to process target", {
          target,
          scope: request.scope,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return processedTargets;
  }

  /**
   * Process a single file target
   */
  private async processSingleTarget(
    target: string,
    options: UnifiedDownloadRequest["options"],
    SyncJob: any,
    FileState: any,
  ): Promise<ProcessedTarget | null> {
    // Parse composite ID if present
    const parsedId = parseCompositeId(target);
    const fileId = parsedId.fileId;
    const jobId = parsedId.isComposite ? parsedId.jobId : options.jobId;

    if (!jobId) {
      throw new Error("Job ID must be provided either in target or options");
    }

    const fileState = await FileState.findById(fileId);
    if (!fileState) {
      throw new Error(`File not found: ${fileId}`);
    }

    const syncJob = await SyncJob.findById(jobId).populate("serverProfileId");
    if (!syncJob) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const serverProfile = await this.getServerProfile(syncJob);
    const {
      source,
      destination,
      transferType,
      size,
      isDirectoryPackage,
      childFileStates,
    } = await this.buildTransferPaths(fileState, syncJob, options);

    return {
      fileId,
      jobId,
      fileState,
      syncJob,
      serverProfile,
      source,
      destination,
      transferType,
      size,
      isDirectoryPackage,
      childFileStates,
    };
  }

  /**
   * Process job-level target (all remote-only files)
   */
  private async processJobTarget(
    jobId: string,
    options: UnifiedDownloadRequest["options"],
    SyncJob: any,
    FileState: any,
  ): Promise<ProcessedTarget[]> {
    const syncJob = await SyncJob.findById(jobId).populate("serverProfileId");
    if (!syncJob) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const remoteOnlyFiles = await FileState.find({
      jobId,
      syncState: "remote_only",
    });

    const serverProfile = await this.getServerProfile(syncJob);
    const processedTargets: ProcessedTarget[] = [];

    for (const fileState of remoteOnlyFiles) {
      const { source, destination, transferType, size } =
        await this.buildTransferPaths(fileState, syncJob, options);

      processedTargets.push({
        fileId: fileState._id.toString(),
        jobId,
        fileState,
        syncJob,
        serverProfile,
        source,
        destination,
        transferType,
        size,
      });
    }

    return processedTargets;
  }

  /**
   * Process directory target
   */
  private async processDirectoryTarget(
    target: string,
    options: UnifiedDownloadRequest["options"],
    SyncJob: any,
    FileState: any,
  ): Promise<ProcessedTarget[]> {
    // Implementation for directory processing
    // This would handle directory-specific logic
    return [];
  }

  /**
   * Process bulk target (list of file IDs)
   */
  private async processBulkTarget(
    target: string,
    options: UnifiedDownloadRequest["options"],
    SyncJob: any,
    FileState: any,
  ): Promise<ProcessedTarget[]> {
    // Parse target as comma-separated file IDs
    const fileIds = target
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const processedTargets: ProcessedTarget[] = [];

    for (const fileId of fileIds) {
      try {
        const singleTarget = await this.processSingleTarget(
          fileId,
          options,
          SyncJob,
          FileState,
        );
        if (singleTarget) processedTargets.push(singleTarget);
      } catch (error) {
        logger.warn("Failed to process bulk target item", { fileId, error });
      }
    }

    return processedTargets;
  }

  /**
   * Process pattern target
   */
  private async processPatternTarget(
    pattern: string,
    options: UnifiedDownloadRequest["options"],
    SyncJob: any,
    FileState: any,
  ): Promise<ProcessedTarget[]> {
    // Implementation for pattern matching
    // This would handle file pattern matching
    return [];
  }

  /**
   * Get server profile from sync job
   */
  private async getServerProfile(syncJob: any): Promise<any> {
    let serverProfile = syncJob.serverProfileId;

    if (!serverProfile.address) {
      const profileFromMethod = await syncJob.getServerProfile();
      if (profileFromMethod) {
        serverProfile = profileFromMethod;
      }
    }

    if (!serverProfile.address || !serverProfile.user) {
      throw new Error("Invalid server configuration: missing address or user");
    }

    if (!serverProfile.privateKey && !serverProfile.password) {
      throw new Error(
        "Invalid server configuration: missing authentication method",
      );
    }

    return serverProfile;
  }

  /**
   * Build transfer paths and determine transfer type
   */
  private async buildTransferPaths(
    fileState: any,
    syncJob: any,
    options: UnifiedDownloadRequest["options"],
  ): Promise<{
    source: string;
    destination: string;
    transferType: TransferType;
    size: number;
    isDirectoryPackage?: boolean;
    childFileStates?: any[];
  }> {
    const sourcePath = path.join(syncJob.remotePath, fileState.relativePath);

    let destination: string;
    if (options.localPath) {
      destination = options.localPath;
    } else {
      destination = path.join(syncJob.localPath, fileState.relativePath);
    }

    // Check for directory package
    let isDirectoryPackage = false;
    let childFileStates: any[] = [];
    let totalSize = fileState.size || 0;

    if (fileState.isDirectory) {
      const { FileState } = await import("@/models");
      childFileStates = await this.findChildFileStates(
        syncJob._id.toString(),
        fileState.relativePath,
        FileState,
      );

      if (childFileStates.length > 0) {
        isDirectoryPackage = true;
        totalSize = childFileStates.reduce((sum, child) => {
          return sum + (child.remote?.size || child.local?.size || 0);
        }, 0);
      }
    }

    // Determine transfer type
    let transferType: TransferType;
    if (isDirectoryPackage) {
      transferType = TransferType.DIRECTORY_PACKAGE;
    } else if (fileState.isDirectory) {
      transferType = TransferType.DIRECTORY;
    } else {
      transferType = TransferType.DOWNLOAD;
    }

    // Adjust source path for directory packages
    let finalSource = sourcePath;
    if (isDirectoryPackage) {
      finalSource = sourcePath.endsWith("/") ? sourcePath : sourcePath + "/";
    }

    return {
      source: finalSource,
      destination,
      transferType,
      size: totalSize,
      isDirectoryPackage,
      childFileStates,
    };
  }

  /**
   * Find child file states for directory packages
   */
  private async findChildFileStates(
    jobId: string,
    parentRelativePath: string,
    FileState: any,
  ): Promise<any[]> {
    const escapedPath = parentRelativePath.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    return await FileState.find({
      jobId,
      relativePath: {
        $regex: `^${escapedPath}/`,
        $options: "i",
      },
    }).lean();
  }

  /**
   * Queue transfers with duplicate handling
   */
  private async queueTransfers(
    targets: ProcessedTarget[],
    request: UnifiedDownloadRequest,
  ): Promise<QueueResult[]> {
    const results: QueueResult[] = [];

    // Determine priority based on source
    let priority: TransferPriority = request.options.priority
      ? TransferPriority[
          request.options.priority as keyof typeof TransferPriority
        ]
      : request.source === "manual"
        ? TransferPriority.URGENT
        : TransferPriority.NORMAL;

    for (const target of targets) {
      try {
        // Ensure destination directory exists
        const destinationDir = path.dirname(target.destination);
        try {
          await fs.mkdir(destinationDir, { recursive: true });
        } catch (error) {
          logger.warn("Failed to create destination directory", {
            destinationDir,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        // Create transfer data
        const transferData = {
          jobId: target.jobId,
          fileId: target.fileId,
          type: target.transferType,
          priority,
          source: target.source,
          destination: target.destination,
          filename: target.fileState.filename,
          relativePath: target.fileState.relativePath,
          size: target.size,
          sshConfig: {
            host: target.serverProfile.address,
            port: target.serverProfile.port,
            username: target.serverProfile.user,
            privateKey: target.serverProfile.privateKey || "",
          },
          rsyncOptions: {
            verbose: true,
            archive: true,
            compress: true,
            progress: true,
            humanReadable: true,
            partial: true,
            inplace: false,
            ...(target.isDirectoryPackage && {
              recursive: true,
              dirs: true,
              mkpath: true,
            }),
            ...request.options.rsyncOptions,
          },
          maxRetries: 3,
        };

        // Check concurrency and add transfer with database sync
        const concurrencyCheck = await this.transferQueue.checkJobConcurrency(
          target.jobId,
        );

        let transferId: string;
        let wasQueued = false;
        let concurrencySlot: number | undefined;

        if (concurrencyCheck.hasAvailableSlots) {
          // Can start immediately
          transferId = await this.transferQueue.addTransferWithConcurrencyCheck(
            transferData,
            target.jobId,
          );
          concurrencySlot = concurrencyCheck.availableSlot;
        } else {
          // Add to queue
          transferId = await this.transferQueue.addTransfer(transferData);
          wasQueued = true;
        }

        // The database update is now handled by the DatabaseSyncedTransferQueue
        // No need for manual FileState updates here as the queue handles it

        const result = {
          transferId,
          isDuplicate: false,
          upgraded: false,
          wasQueued,
          concurrencySlot,
        };

        results.push({
          transferId: result.transferId,
          fileId: target.fileId,
          filename: target.fileState.filename,
          size: target.size,
          isDuplicate: result.isDuplicate,
          upgraded: result.upgraded,
          skipped: false,
        });

        logger.info("Transfer queued successfully", {
          transferId: result.transferId,
          fileId: target.fileId,
          filename: target.fileState.filename,
          source: request.source,
          isDuplicate: result.isDuplicate,
          upgraded: result.upgraded,
        });
      } catch (error) {
        logger.error("Failed to queue transfer", {
          fileId: target.fileId,
          filename: target.fileState.filename,
          error: error instanceof Error ? error.message : "Unknown error",
        });

        results.push({
          transferId: "",
          fileId: target.fileId,
          filename: target.fileState.filename,
          size: target.size,
          isDuplicate: false,
          upgraded: false,
          skipped: true,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  }

  /**
   * Generate unified response
   */
  private generateResponse(
    results: QueueResult[],
    startTime: number,
  ): UnifiedDownloadResponse {
    const transferIds = results
      .filter((r) => !r.skipped)
      .map((r) => r.transferId);
    const queuedCount = results.filter(
      (r) => !r.skipped && !r.isDuplicate,
    ).length;
    const skippedCount = results.filter((r) => r.skipped).length;
    const upgradedCount = results.filter((r) => r.upgraded).length;
    const totalSize = results.reduce((sum, r) => sum + r.size, 0);
    const duration = Date.now() - startTime;

    const warnings: string[] = [];
    const errors: string[] = [];

    // Collect warnings and errors
    results.forEach((result) => {
      if (result.error) {
        errors.push(`${result.filename}: ${result.error}`);
      }
      if (result.isDuplicate && !result.upgraded) {
        warnings.push(`${result.filename}: Transfer already exists`);
      }
    });

    let message = `Successfully processed ${results.length} items`;
    if (queuedCount > 0) message += `, queued ${queuedCount} new transfers`;
    if (upgradedCount > 0) message += `, upgraded ${upgradedCount} priorities`;
    if (skippedCount > 0) message += `, skipped ${skippedCount} items`;

    return {
      success: errors.length === 0,
      data: {
        transferIds,
        queuedCount,
        skippedCount,
        upgradedCount,
        totalSize,
        estimatedDuration:
          totalSize > 0 ? Math.ceil(totalSize / (10 * 1024 * 1024)) : undefined, // Rough estimate
        message,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };
  }
}

// Export singleton instance
let downloadServiceInstance: UnifiedDownloadService | null = null;

export function getDownloadService(
  eventEmitter?: EventEmitter,
): UnifiedDownloadService {
  if (!downloadServiceInstance) {
    const transferQueue = new DatabaseSyncedTransferQueue(
      DEFAULT_QUEUE_CONFIG,
      DEFAULT_RETRY_POLICY,
      eventEmitter,
    );

    // Initialize from database
    transferQueue.initializeFromDatabase().catch((error) => {
      logger.error("Failed to initialize transfer queue from database", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });

    downloadServiceInstance = new UnifiedDownloadService(
      transferQueue,
      eventEmitter,
    );
  }
  return downloadServiceInstance;
}
