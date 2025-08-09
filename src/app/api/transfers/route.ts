/**
 * Transfer State Management API Endpoint
 * Provides comprehensive transfer monitoring and management capabilities
 */

import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler, createSuccessResponse } from "@/lib/errors";
import { getRequestLogger, PerformanceTimer } from "@/lib/logger/request";
import { withMiddleware } from "@/lib/auth/middleware";
import { DatabaseSyncedTransferQueue } from "@/lib/services/database-synced-transfer-queue";
import { TransferStateManager } from "@/lib/services/transfer-state-manager";
import { JobConcurrencyController } from "@/lib/services/job-concurrency-controller";
import { StateRecoveryService } from "@/lib/services/state-recovery-service";
import { WebSocketManager } from "@/lib/websocket/websocket-manager";
import { z } from "zod";

// Request validation schemas
const TransferQuerySchema = z.object({
  jobId: z.string().optional(),
  status: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : undefined)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : undefined)),
});

const RecoveryRequestSchema = z.object({
  type: z.enum(["orphaned", "stuck", "consistency", "full"]).default("full"),
  jobId: z.string().optional(),
  dryRun: z.boolean().default(false),
});

/**
 * GET /api/transfers
 * Get active transfers with comprehensive status information
 */
export const GET = withMiddleware(
  withErrorHandler(async (req: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, "get_transfers");

    try {
      logger.info("Getting transfer states");

      const url = new URL(req.url);
      const query = TransferQuerySchema.parse({
        jobId: url.searchParams.get("jobId"),
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit"),
        offset: url.searchParams.get("offset"),
      });

      // Initialize services
      const transferStateManager = TransferStateManager.getInstance();
      const transferQueue = DatabaseSyncedTransferQueue.getInstance();
      await transferQueue.initializeFromDatabase();

      // Get active transfers from state manager
      const activeTransfers = await transferStateManager.getActiveTransfers();

      // Filter active transfers
      let filteredTransfers = activeTransfers;
      if (query.jobId) {
        // Will be filtered in database query below
      }
      if (query.status) {
        filteredTransfers = activeTransfers.filter(
          (t) => t.currentState === query.status.toLowerCase(),
        );
      }

      // Get database state
      const { FileState } = await import("@/models/FileState");

      let dbQuery: any = {
        syncState: { $in: ["queued", "transferring"] },
        "transfer.activeTransferId": { $exists: true, $ne: null },
      };

      if (query.jobId) {
        dbQuery.jobId = query.jobId;
      }

      if (query.status) {
        const statusMap: Record<string, string> = {
          queued: "queued",
          transferring: "transferring",
          QUEUED: "queued",
          TRANSFERRING: "transferring",
        };
        dbQuery.syncState = statusMap[query.status] || query.status;
      }

      const dbTransfers = await FileState.find(dbQuery)
        .populate("jobId", "name enabled")
        .sort({ "transfer.lastStateChange": -1 })
        .skip(query.offset || 0)
        .limit(query.limit || 50);

      const totalCount = await FileState.countDocuments(dbQuery);

      // Combine and enhance transfer information
      const enhancedTransfers = dbTransfers.map((dbTransfer: any) => {
        const activeTransfer = activeTransfers.find(
          (at) => at.fileId === dbTransfer._id.toString(),
        );

        return {
          // Database fields
          fileId: dbTransfer._id.toString(),
          filename: dbTransfer.filename,
          relativePath: dbTransfer.relativePath,
          syncState: dbTransfer.syncState,
          size: dbTransfer.remote?.size || dbTransfer.local?.size || 0,
          isDirectory: dbTransfer.isDirectory,

          // Transfer fields
          transferId: dbTransfer.transfer.activeTransferId,
          progress: dbTransfer.transfer.progress,
          speed: dbTransfer.transfer.speed,
          eta: dbTransfer.transfer.eta,
          retryCount: dbTransfer.transfer.retryCount,
          lastStateChange: dbTransfer.transfer.lastStateChange,
          concurrencySlot: dbTransfer.transfer.jobConcurrencySlot,
          source: dbTransfer.transfer.source,

          // Job information
          job: {
            id: dbTransfer.jobId._id?.toString() || dbTransfer.jobId.toString(),
            name: dbTransfer.jobId.name || "Unknown Job",
            enabled: dbTransfer.jobId.enabled || false,
          },

          // Active transfer status
          isActive: !!activeTransfer,
          activeState: activeTransfer?.currentState,
          activeMetadata: activeTransfer?.metadata,

          // Timing information
          startedAt: dbTransfer.transfer.startedAt,
          completedAt: dbTransfer.transfer.completedAt,
          createdAt: dbTransfer.addedAt,
        };
      });

      // Get concurrency information per job
      const concurrencyController = JobConcurrencyController.getInstance();
      const concurrencyStats = concurrencyController.getCacheStats();

      const response = {
        transfers: enhancedTransfers,
        pagination: {
          total: totalCount,
          limit: query.limit || 50,
          offset: query.offset || 0,
          hasMore: (query.offset || 0) + enhancedTransfers.length < totalCount,
        },
        statistics: {
          activeTransfers: activeTransfers.length,
          totalQueued: dbTransfers.filter((t: any) => t.syncState === "queued")
            .length,
          totalTransferring: dbTransfers.filter(
            (t: any) => t.syncState === "transferring",
          ).length,
          concurrency: concurrencyStats,
        },
        filters: {
          jobId: query.jobId,
          status: query.status,
        },
      };

      logger.info("Transfer states retrieved successfully", {
        transferCount: enhancedTransfers.length,
        totalCount,
        filters: query,
        duration: timer.end(),
      });

      return createSuccessResponse(response);
    } catch (error) {
      timer.endWithError(error);
      logger.error("Failed to get transfer states", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }),
  {
    auth: "optional",
    rateLimit: { limit: 100, windowMs: 15 * 60 * 1000 },
  },
);

/**
 * POST /api/transfers/recover
 * Trigger manual state recovery operations
 */
export const POST = withMiddleware(
  withErrorHandler(async (req: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, "manual_recovery");

    try {
      logger.info("Processing manual recovery request");

      const body = await req.json();
      const request = RecoveryRequestSchema.parse(body);

      logger.info("Manual recovery request validated", request);

      // Initialize services
      const stateManager = TransferStateManager.getInstance();
      const concurrencyController = JobConcurrencyController.getInstance();
      const recoveryService = StateRecoveryService.getInstance();

      let result: any = {};

      switch (request.type) {
        case "orphaned":
          if (request.dryRun) {
            const orphaned = await recoveryService.detectOrphanedTransfers();
            result = {
              type: "orphaned_check",
              orphanedCount: orphaned.length,
              orphanedTransfers: orphaned.map((t: any) => ({
                fileId: t.fileId,
                transferId: t.transferId,
                state: t.state,
                lastStateChange: t.lastStateChange,
                stuckDuration: t.stuckDuration,
              })),
            };
          } else {
            const orphaned = await recoveryService.detectOrphanedTransfers();
            let recoveredCount = 0;
            for (const transfer of orphaned) {
              const success =
                await recoveryService.cleanupOrphanedTransfer(transfer);
              if (success) recoveredCount++;
            }
            result = {
              type: "orphaned_recovery",
              orphanedCount: orphaned.length,
              recoveredCount,
            };
          }
          break;

        case "stuck":
          if (request.dryRun) {
            const stuck = await recoveryService.detectStuckTransfers(60); // 60 minutes
            result = {
              type: "stuck_check",
              stuckCount: stuck.length,
              stuckTransfers: stuck.map((t: any) => ({
                fileId: t.fileId,
                transferId: t.transferId,
                state: t.state,
                lastStateChange: t.lastStateChange,
                stuckDuration: t.stuckDuration,
              })),
            };
          } else {
            const stuck = await recoveryService.detectStuckTransfers(60);
            let recoveredCount = 0;
            for (const transfer of stuck) {
              const success =
                await recoveryService.recoverStuckTransfer(transfer);
              if (success) recoveredCount++;
            }
            result = {
              type: "stuck_recovery",
              stuckCount: stuck.length,
              recoveredCount,
            };
          }
          break;

        case "consistency":
          const validation = await recoveryService.validateStateConsistency();
          result = {
            type: "consistency_check",
            consistent: validation.consistent,
            issues: validation.issues,
            stats: validation.stats,
          };
          break;

        case "full":
          if (request.dryRun) {
            result = {
              type: "full_recovery_preview",
              message: "Dry run not supported for full recovery",
            };
          } else {
            const recoveryResult =
              await recoveryService.performSystemRecovery();
            result = { type: "full_recovery", ...recoveryResult };
          }
          break;

        default:
          throw new Error(`Unknown recovery type: ${request.type}`);
      }

      logger.info("Manual recovery completed", {
        type: request.type,
        dryRun: request.dryRun,
        result,
        duration: timer.end(),
      });

      return createSuccessResponse({
        recovery: result,
        request: {
          type: request.type,
          jobId: request.jobId,
          dryRun: request.dryRun,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      timer.endWithError(error);
      logger.error("Manual recovery failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }),
  {
    auth: "required", // Recovery operations require authentication
    rateLimit: { limit: 10, windowMs: 15 * 60 * 1000 }, // Limited rate for recovery operations
  },
);

/**
 * DELETE /api/transfers
 * Cancel multiple transfers
 */
export const DELETE = withMiddleware(
  withErrorHandler(async (req: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, "cancel_transfers");

    try {
      const body = await req.json();
      const { transferIds, reason = "Manual cancellation" } = body;

      if (!Array.isArray(transferIds) || transferIds.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "transferIds array is required",
          },
          { status: 400 },
        );
      }

      logger.info("Cancelling multiple transfers", {
        transferIds,
        count: transferIds.length,
        reason,
      });

      // Initialize transfer queue
      const transferQueue = DatabaseSyncedTransferQueue.getInstance();
      await transferQueue.initializeFromDatabase();

      const results = [];
      for (const transferId of transferIds) {
        try {
          // Get transfer info first
          const { FileState } = await import("@/models/FileState");
          const transfer = await FileState.findOne({
            "transfer.activeTransferId": transferId,
          });

          if (!transfer) {
            results.push({
              transferId,
              cancelled: false,
              error: "Transfer not found",
            });
            continue;
          }

          const cancelled = await transferQueue.cancelTransfer(
            transferId,
            transfer._id.toString(),
            transfer.jobId.toString(),
            reason,
          );

          results.push({
            transferId,
            cancelled,
            error: cancelled ? null : "Could not cancel transfer",
          });
        } catch (error) {
          results.push({
            transferId,
            cancelled: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      const successCount = results.filter((r) => r.cancelled).length;
      const failureCount = results.length - successCount;

      logger.info("Bulk cancel operation completed", {
        totalRequested: transferIds.length,
        successCount,
        failureCount,
        reason,
        duration: timer.end(),
      });

      return createSuccessResponse({
        cancelled: successCount,
        failed: failureCount,
        results,
        message: `Cancelled ${successCount} of ${transferIds.length} transfers`,
        reason,
      });
    } catch (error) {
      timer.endWithError(error);
      logger.error("Bulk cancel failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }),
  {
    auth: "optional",
    rateLimit: { limit: 20, windowMs: 15 * 60 * 1000 },
  },
);

/**
 * OPTIONS /api/transfers
 * Handle preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
