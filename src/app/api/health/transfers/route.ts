/**
 * Transfer Health Monitoring API Endpoint
 * Provides health checks and monitoring for the transfer system
 */

import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler, createSuccessResponse } from "@/lib/errors";
import { getRequestLogger, PerformanceTimer } from "@/lib/logger/request";
import { withMiddleware } from "@/lib/auth/middleware";
import { TransferStateManager } from "@/lib/services/transfer-state-manager";
import { JobConcurrencyController } from "@/lib/services/job-concurrency-controller";
import { StateRecoveryService } from "@/lib/services/state-recovery-service";
import { DatabaseSyncedTransferQueue } from "@/lib/services/database-synced-transfer-queue";

/**
 * GET /api/health/transfers
 * Get comprehensive transfer system health information
 */
export const GET = withMiddleware(
  withErrorHandler(async (req: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, "transfer_health_check");

    try {
      logger.info("Performing transfer system health check");

      // Initialize services
      const transferStateManager = TransferStateManager.getInstance();
      const concurrencyController = JobConcurrencyController.getInstance();
      const recoveryService = StateRecoveryService.getInstance();
      const transferQueue = DatabaseSyncedTransferQueue.getInstance();

      // Get active transfers
      const activeTransfers = await transferStateManager.getActiveTransfers();

      // Get transfers by state
      const queuedTransfers = await transferStateManager.getTransfersByState('queued');
      const transferringTransfers = await transferStateManager.getTransfersByState('transferring');
      const failedTransfers = await transferStateManager.getTransfersByState('failed');
      const completedTransfers = await transferStateManager.getTransfersByState('completed');

      // Check for stuck transfers
      const stuckTransfers = await recoveryService.detectStuckTransfers(30); // 30 minutes

      // Check for orphaned transfers
      const orphanedTransfers = await recoveryService.detectOrphanedTransfers();

      // Validate state consistency
      const consistencyCheck = await recoveryService.validateStateConsistency();

      // Get concurrency stats
      const concurrencyStats = concurrencyController.getCacheStats();

      // Calculate health metrics
      const totalTransfers = activeTransfers.length;
      const stuckCount = stuckTransfers.length;
      const orphanedCount = orphanedTransfers.length;
      const failedCount = failedTransfers.length;

      // Determine overall health status
      let healthStatus = 'healthy';
      const issues = [];

      if (stuckCount > 0) {
        issues.push(`${stuckCount} stuck transfers detected`);
        healthStatus = 'warning';
      }

      if (orphanedCount > 0) {
        issues.push(`${orphanedCount} orphaned transfers detected`);
        healthStatus = 'warning';
      }

      if (!consistencyCheck.consistent) {
        issues.push('State consistency issues detected');
        healthStatus = 'unhealthy';
      }

      if (failedCount > totalTransfers * 0.1 && failedCount > 5) {
        issues.push(`High failure rate: ${failedCount} failed transfers`);
        healthStatus = 'warning';
      }

      // Get database health from FileState collection
      const { FileState } = await import("@/models/FileState");

      const dbStats = await FileState.aggregate([
        {
          $group: {
            _id: "$syncState",
            count: { $sum: 1 }
          }
        }
      ]);

      const stateDistribution = dbStats.reduce((acc: any, stat: any) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {});

      // Check queue sync status
      let queueSyncStatus = 'unknown';
      try {
        await transferQueue.syncWithDatabase();
        queueSyncStatus = 'synced';
      } catch (error) {
        queueSyncStatus = 'sync_failed';
        issues.push('Queue sync failed');
        healthStatus = 'unhealthy';
      }

      const healthData = {
        status: healthStatus,
        timestamp: new Date().toISOString(),

        summary: {
          totalActiveTransfers: totalTransfers,
          queuedCount: queuedTransfers.length,
          transferringCount: transferringTransfers.length,
          completedCount: completedTransfers.length,
          failedCount: failedTransfers.length,
          stuckCount,
          orphanedCount,
        },

        systemHealth: {
          stateConsistency: consistencyCheck.consistent,
          queueSync: queueSyncStatus,
          concurrencyManagement: concurrencyStats.totalJobs > 0 ? 'active' : 'idle',
        },

        metrics: {
          stateDistribution,
          concurrency: {
            totalJobs: concurrencyStats.totalJobs,
            activeJobIds: concurrencyStats.jobIds,
          },
          performance: {
            averageTransferTime: null, // Could be calculated from completed transfers
            successRate: totalTransfers > 0 ?
              ((totalTransfers - failedCount) / totalTransfers * 100).toFixed(2) + '%' :
              'N/A',
            throughput: null, // Could be calculated from recent completions
          },
        },

        issues: issues.length > 0 ? issues : null,

        detectedProblems: {
          stuckTransfers: stuckTransfers.length > 0 ? stuckTransfers.map(t => ({
            fileId: t.fileId,
            transferId: t.transferId,
            state: t.state,
            stuckDuration: Math.round(t.stuckDuration / 60000) + ' minutes',
            jobId: t.jobId,
          })) : null,

          orphanedTransfers: orphanedTransfers.length > 0 ? orphanedTransfers.map(t => ({
            fileId: t.fileId,
            transferId: t.transferId,
            state: t.state,
            duration: Math.round(t.stuckDuration / 60000) + ' minutes',
            jobId: t.jobId,
          })) : null,

          consistencyIssues: !consistencyCheck.consistent ? consistencyCheck.issues : null,
        },

        recommendations: [],
      };

      // Add recommendations based on detected issues
      if (stuckCount > 0) {
        healthData.recommendations.push('Run manual recovery for stuck transfers');
      }
      if (orphanedCount > 0) {
        healthData.recommendations.push('Run manual recovery for orphaned transfers');
      }
      if (!consistencyCheck.consistent) {
        healthData.recommendations.push('Perform full system recovery to fix consistency issues');
      }
      if (queueSyncStatus === 'sync_failed') {
        healthData.recommendations.push('Restart transfer queue service');
      }

      logger.info("Transfer health check completed", {
        status: healthStatus,
        totalTransfers,
        issues: issues.length,
        duration: timer.end(),
      });

      return createSuccessResponse(healthData);

    } catch (error) {
      timer.endWithError(error);
      logger.error("Transfer health check failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Return unhealthy status on error
      return createSuccessResponse({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Health check failed",
        summary: {
          totalActiveTransfers: 0,
          queuedCount: 0,
          transferringCount: 0,
          completedCount: 0,
          failedCount: 0,
          stuckCount: 0,
          orphanedCount: 0,
        },
        issues: ['Health check failed to complete'],
        recommendations: ['Check system logs and restart services if necessary'],
      });
    }
  }),
  {
    auth: "optional",
    rateLimit: { limit: 60, windowMs: 15 * 60 * 1000 },
  }
);

/**
 * POST /api/health/transfers/recovery
 * Trigger automatic recovery for detected issues
 */
export const POST = withMiddleware(
  withErrorHandler(async (req: NextRequest) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, "transfer_auto_recovery");

    try {
      logger.info("Performing automatic transfer recovery");

      const body = await req.json();
      const { autoFix = false, issueTypes = ['stuck', 'orphaned'] } = body;

      if (!autoFix) {
        return NextResponse.json(
          {
            success: false,
            error: "autoFix must be set to true to perform recovery",
          },
          { status: 400 }
        );
      }

      const recoveryService = StateRecoveryService.getInstance();
      const results: any = {
        timestamp: new Date().toISOString(),
        actions: [],
        summary: {
          totalFixed: 0,
          totalFailed: 0,
        },
      };

      // Handle stuck transfers
      if (issueTypes.includes('stuck')) {
        const stuckTransfers = await recoveryService.detectStuckTransfers(30);
        let fixedCount = 0;
        let failedCount = 0;

        for (const transfer of stuckTransfers) {
          const success = await recoveryService.recoverStuckTransfer(transfer);
          if (success) {
            fixedCount++;
          } else {
            failedCount++;
          }
        }

        results.actions.push({
          type: 'stuck_transfer_recovery',
          detected: stuckTransfers.length,
          fixed: fixedCount,
          failed: failedCount,
        });

        results.summary.totalFixed += fixedCount;
        results.summary.totalFailed += failedCount;
      }

      // Handle orphaned transfers
      if (issueTypes.includes('orphaned')) {
        const orphanedTransfers = await recoveryService.detectOrphanedTransfers();
        let fixedCount = 0;
        let failedCount = 0;

        for (const transfer of orphanedTransfers) {
          const success = await recoveryService.cleanupOrphanedTransfer(transfer);
          if (success) {
            fixedCount++;
          } else {
            failedCount++;
          }
        }

        results.actions.push({
          type: 'orphaned_transfer_cleanup',
          detected: orphanedTransfers.length,
          fixed: fixedCount,
          failed: failedCount,
        });

        results.summary.totalFixed += fixedCount;
        results.summary.totalFailed += failedCount;
      }

      // Handle concurrency slot validation
      if (issueTypes.includes('concurrency')) {
        const releasedSlots = await recoveryService.validateConcurrencySlots();

        results.actions.push({
          type: 'concurrency_slot_cleanup',
          releasedSlots,
        });
      }

      logger.info("Automatic transfer recovery completed", {
        totalFixed: results.summary.totalFixed,
        totalFailed: results.summary.totalFailed,
        actions: results.actions.length,
        duration: timer.end(),
      });

      return createSuccessResponse({
        message: "Automatic recovery completed",
        results,
      });

    } catch (error) {
      timer.endWithError(error);
      logger.error("Automatic transfer recovery failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }),
  {
    auth: "required",
    rateLimit: { limit: 5, windowMs: 15 * 60 * 1000 },
  }
);

/**
 * OPTIONS /api/health/transfers
 * Handle preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
