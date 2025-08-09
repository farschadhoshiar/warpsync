/**
 * Directory Tree API Endpoint
 * Provides hierarchical directory tree structure for a sync job
 */

import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { withErrorHandler } from "@/lib/errors";
import { getRequestLogger, PerformanceTimer } from "@/lib/logger/request";
import { Types } from "mongoose";

interface FileStateLean {
  _id: string;
  jobId: string;
  filename: string;
  relativePath: string;
  isDirectory: boolean;
  parentPath?: string;
  syncState: string;
  remote: {
    size?: number;
  };
  local: {
    size?: number;
  };
  fileCount?: number;
  directorySize?: number;
  transfer: {
    activeTransferId?: string;
    jobConcurrencySlot?: number;
    lastStateChange?: Date;
    progress?: number;
    speed?: string;
    eta?: string;
    source?: string;
    retryCount?: number;
  };
}

interface TreeNode {
  id: string;
  name: string;
  relativePath: string;
  isDirectory: boolean;
  syncState: string;
  size?: number;
  fileCount?: number;
  directorySize?: number;
  children: TreeNode[];
  parent?: string;
  transferState?: {
    isActive: boolean;
    transferId?: string;
    concurrencySlot?: number;
    lastStateChange?: Date;
    progress?: number;
    speed?: string;
    eta?: string;
    source?: string;
    retryCount?: number;
  };
}

/**
 * GET /api/jobs/[id]/tree
 * Get hierarchical directory tree structure
 */
export const GET = withErrorHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const logger = await getRequestLogger();
    const timer = new PerformanceTimer(logger, "get-directory-tree");

    const { id: jobId } = await params;

    // Validate ObjectId
    if (!Types.ObjectId.isValid(jobId)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid job ID format",
          timestamp: new Date().toISOString(),
        },
        { status: 400 },
      );
    }

    try {
      await connectDB();
      const { SyncJob, FileState } = await import("@/models");

      // Parse query parameters
      const url = new URL(req.url);
      const expandLevel = parseInt(url.searchParams.get("expandLevel") || "2");
      const showFiles = url.searchParams.get("showFiles") !== "false";

      logger.info("Fetching directory tree for sync job", {
        jobId,
        expandLevel,
        showFiles,
      });

      // Verify job exists
      const syncJob = await SyncJob.findById(jobId);
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

      // Query FileState collection with transfer information
      const fileStates = (await FileState.find({ jobId })
        .select(
          "filename relativePath isDirectory parentPath syncState remote local fileCount directorySize transfer",
        )
        .lean()) as unknown as FileStateLean[];

      // Build tree structure
      const nodeMap = new Map<string, TreeNode>();
      const rootNodes: TreeNode[] = [];
      let totalSize = 0;
      let directoriesCount = 0;
      let filesCount = 0;

      // First pass: create all nodes
      for (const fileState of fileStates) {
        if (!showFiles && !fileState.isDirectory) {
          continue;
        }

        const nodeId = fileState._id.toString();
        const node: TreeNode = {
          id: nodeId,
          name: fileState.filename,
          relativePath: fileState.relativePath,
          isDirectory: fileState.isDirectory,
          syncState: fileState.syncState,
          size: fileState.remote.size || fileState.local.size,
          fileCount: fileState.fileCount,
          directorySize: fileState.directorySize,
          children: [],
          parent: fileState.parentPath || undefined,
          transferState: fileState.transfer
            ? {
                isActive: !!(
                  fileState.transfer.activeTransferId &&
                  ["queued", "transferring"].includes(fileState.syncState)
                ),
                transferId: fileState.transfer.activeTransferId,
                concurrencySlot: fileState.transfer.jobConcurrencySlot,
                lastStateChange: fileState.transfer.lastStateChange,
                progress: fileState.transfer.progress,
                speed: fileState.transfer.speed,
                eta: fileState.transfer.eta,
                source: fileState.transfer.source,
                retryCount: fileState.transfer.retryCount,
              }
            : undefined,
        };

        nodeMap.set(fileState.relativePath, node);

        if (fileState.isDirectory) {
          directoriesCount++;
          totalSize += fileState.directorySize || 0;
        } else {
          filesCount++;
          totalSize += fileState.remote.size || fileState.local.size || 0;
        }
      }

      // Second pass: build hierarchy
      for (const node of nodeMap.values()) {
        if (!node.parent || node.parent === "") {
          // Root level node
          rootNodes.push(node);
        } else {
          // Find parent and add as child
          const parentNode = nodeMap.get(node.parent);
          if (parentNode) {
            parentNode.children.push(node);
          } else {
            // Parent not found, treat as root
            rootNodes.push(node);
          }
        }
      }

      // Sort children recursively
      const sortChildren = (nodes: TreeNode[]): void => {
        nodes.sort((a, b) => {
          // Directories first, then files
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          // Then alphabetical
          return a.name.localeCompare(b.name);
        });

        for (const node of nodes) {
          if (node.children.length > 0) {
            sortChildren(node.children);
          }
        }
      };

      sortChildren(rootNodes);

      // Apply expansion level (collapse deep nodes)
      const applyExpansionLevel = (
        nodes: TreeNode[],
        currentLevel: number,
      ): void => {
        for (const node of nodes) {
          if (currentLevel >= expandLevel && node.children.length > 0) {
            // Mark node as collapsed (you can add a collapsed flag if needed)
            // For now, we just keep the children but the frontend can handle expansion
          }
          if (node.children.length > 0) {
            applyExpansionLevel(node.children, currentLevel + 1);
          }
        }
      };

      applyExpansionLevel(rootNodes, 0);

      // Calculate transfer statistics
      const activeTransfersCount = fileStates.filter(
        (fs) =>
          fs.transfer?.activeTransferId &&
          ["queued", "transferring"].includes(fs.syncState),
      ).length;
      const queuedTransfersCount = fileStates.filter(
        (fs) => fs.syncState === "queued",
      ).length;
      const transferringCount = fileStates.filter(
        (fs) => fs.syncState === "transferring",
      ).length;

      const stats = {
        totalItems: fileStates.length,
        directories: directoriesCount,
        files: filesCount,
        totalSize,
        expandLevel,
        showFiles,
        transfers: {
          active: activeTransfersCount,
          queued: queuedTransfersCount,
          transferring: transferringCount,
          total: activeTransfersCount,
        },
      };

      logger.info("Directory tree fetched successfully", {
        jobId,
        stats,
        duration: timer.end(),
      });

      return NextResponse.json({
        success: true,
        data: {
          tree: rootNodes,
          stats,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to fetch directory tree", {
        jobId,
        error: error instanceof Error ? error.message : "Unknown error",
        duration: timer.end(),
      });

      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch directory tree",
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      );
    }
  },
);
