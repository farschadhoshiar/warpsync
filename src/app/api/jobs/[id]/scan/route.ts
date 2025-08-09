/**
 * Sync Job Scan Operation Endpoint
 * Handles manual directory scanning for a specific sync job
 */

import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { withErrorHandler } from "@/lib/errors";
import { getRequestLogger, PerformanceTimer } from "@/lib/logger/request";
import { Types } from "mongoose";
import { FileScanner } from "@/lib/scanner/file-scanner";
import { emitIfAvailable } from "@/lib/websocket/emitter";

/**
 * POST /api/jobs/[id]/scan
 * Trigger a manual directory scan for a sync job
 */
export const POST = withErrorHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, "manual-scan");

    const { id } = await params;

    // Validate ObjectId
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid job ID format",
          timestamp: new Date().toISOString(),
        },
        { status: 400 },
      );
    }

    logger.info({ jobId: id }, "Triggering manual scan for sync job");

    await connectDB();
    const { SyncJob } = await import("@/models");

    // Check if job exists and is enabled
    const syncJob = await SyncJob.findById(id).populate(
      "serverProfileId",
      "name address port user authMethod password privateKey",
    );

    if (!syncJob) {
      return NextResponse.json(
        {
          success: false,
          error: "Sync job not found",
          timestamp: new Date().toISOString(),
        },
        { status: 404 },
      );
    }

    if (!syncJob.enabled) {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot scan disabled sync job",
          timestamp: new Date().toISOString(),
        },
        { status: 400 },
      );
    }

    // Update last scan time and perform the actual scan
    syncJob.lastScan = new Date();
    await syncJob.save();

    // Perform the actual file scan using our FileScanner
    try {
      logger.info("Creating FileScanner instance");
      const fileScanner = new FileScanner();
      logger.info("FileScanner created successfully");

      // Get server profile for SSH connection
      const serverProfile = syncJob.serverProfileId;
      if (!serverProfile) {
        logger.error({ jobId: id }, "Server profile not found");
        return NextResponse.json(
          {
            success: false,
            error: "Server profile not found for sync job",
            timestamp: new Date().toISOString(),
          },
          { status: 400 },
        );
      }

      logger.info(
        {
          serverName: serverProfile.name,
          address: serverProfile.address,
          port: serverProfile.port,
          authMethod: serverProfile.authMethod,
        },
        "Server profile found",
      );

      // Build SSH config
      const sshConfig = {
        id: `${serverProfile._id}`,
        name: serverProfile.name,
        host: serverProfile.address,
        port: serverProfile.port,
        username: serverProfile.user,
        ...(serverProfile.authMethod === "password"
          ? { password: serverProfile.password }
          : { privateKey: serverProfile.privateKey }),
      };

      // Emit SSH connecting event
      emitIfAvailable("scan:ssh-connecting", {
        jobId: id,
        jobName: syncJob.name,
        serverAddress: sshConfig.host,
        timestamp: new Date().toISOString(),
      });

      // Test SSH connection first
      const connectionTest = await fileScanner.testSSHConnection(sshConfig);
      if (!connectionTest.success) {
        throw new Error(`SSH connection failed: ${connectionTest.message}`);
      }

      // Emit SSH connected event
      emitIfAvailable("scan:ssh-connected", {
        jobId: id,
        jobName: syncJob.name,
        serverAddress: sshConfig.host,
        timestamp: new Date().toISOString(),
      });

      logger.info(
        {
          remotePath: syncJob.remotePath,
          localPath: syncJob.localPath,
          sshHost: sshConfig.host,
          sshPort: sshConfig.port,
        },
        "Starting directory comparison",
      );

      // Emit syncing states event
      emitIfAvailable("scan:syncing-states", {
        jobId: id,
        jobName: syncJob.name,
        remotePath: syncJob.remotePath,
        localPath: syncJob.localPath,
        timestamp: new Date().toISOString(),
      });

      // Perform the scan and wait for completion with timeout
      const scanPromise = fileScanner.compareDirectories(
        syncJob._id.toString(),
        sshConfig,
        syncJob.remotePath,
        syncJob.localPath,
      );

      // Set a timeout for the scan operation (5 minutes)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Scan operation timed out after 5 minutes")),
          5 * 60 * 1000,
        );
      });

      const comparison = (await Promise.race([
        scanPromise,
        timeoutPromise,
      ])) as Awaited<typeof scanPromise>;

      logger.info(
        {
          stats: comparison.stats,
        },
        "Directory comparison completed",
      );

      // Create the response structure that the frontend expects
      const scanResults = {
        jobId: id,
        jobName: syncJob.name,
        remotePath: syncJob.remotePath,
        localPath: syncJob.localPath,
        scanCompleted: comparison.comparedAt.toISOString(),
        status: "completed",
        newFiles: comparison.stats.remoteOnly,
        changedFiles: comparison.stats.desynced,
        syncedFiles: comparison.stats.synced,
        localOnlyFiles: comparison.stats.localOnly,
        totalRemoteFiles: comparison.stats.totalRemote,
        totalLocalFiles: comparison.stats.totalLocal,
        totalRemoteSize: comparison.stats.totalSizeRemote,
        totalLocalSize: comparison.stats.totalSizeLocal,
        totalStatusChanges:
          comparison.stats.remoteOnly +
          comparison.stats.desynced +
          comparison.stats.localOnly,
        statusBreakdown: {
          newFiles: comparison.stats.remoteOnly,
          changedFiles: comparison.stats.desynced,
          syncedFiles: comparison.stats.synced,
          localOnlyFiles: comparison.stats.localOnly,
          newDirectories: comparison.stats.directoriesRemoteOnly,
          changedDirectories: comparison.stats.directoriesDesynced,
        },
      };

      logger.info(
        {
          jobId: id,
          stats: comparison.stats,
          duration: timer.end(),
        },
        "File scan completed successfully",
      );

      return NextResponse.json({
        success: true,
        data: {
          scanResults,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      logger.error(
        {
          jobId: id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to complete scan",
      );

      return NextResponse.json(
        {
          success: false,
          error: "Failed to complete directory scan",
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      );
    }
  },
);
