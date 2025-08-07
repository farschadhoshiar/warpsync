/**
 * Directory Tree API Endpoint
 * Provides hierarchical directory tree structure for a sync job
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { Types } from 'mongoose';

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
}

/**
 * GET /api/jobs/[id]/tree
 * Get hierarchical directory tree structure
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get-directory-tree');
  
  const { id: jobId } = await params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(jobId)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Fetching directory tree for sync job', { jobId });
  
  await connectDB();
  const { SyncJob, FileState } = await import('@/models');
  
  // Verify job exists
  const syncJob = await SyncJob.findById(jobId);
  if (!syncJob) {
    return NextResponse.json({
      success: false,
      error: 'Sync job not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  // Parse query parameters
  const url = new URL(req.url);
  const expandLevel = parseInt(url.searchParams.get('expandLevel') || '2');
  const showFiles = url.searchParams.get('showFiles') !== 'false';
  const syncStateFilter = url.searchParams.get('syncState');
  
  // Build filter
  const filter: Record<string, unknown> = { jobId };
  if (syncStateFilter) {
    filter.syncState = syncStateFilter;
  }
  
  // Get all file states
  const fileStates = await FileState.find(filter)
    .sort({ 
      isDirectory: -1, // Directories first
      relativePath: 1   // Then alphabetical
    });
  
  if (fileStates.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        tree: [],
        stats: {
          totalItems: 0,
          directories: 0,
          files: 0,
          totalSize: 0
        }
      },
      timestamp: new Date().toISOString()
    });
  }
  
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
    
    const node: TreeNode = {
      id: fileState._id.toString(),
      name: fileState.filename,
      relativePath: fileState.relativePath,
      isDirectory: fileState.isDirectory,
      syncState: fileState.syncState,
      size: fileState.remote.size || fileState.local.size,
      fileCount: fileState.fileCount,
      directorySize: fileState.directorySize,
      children: [],
      parent: fileState.parentPath || undefined
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
  for (const [relativePath, node] of nodeMap) {
    if (!node.parent || node.parent === '') {
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
  const applyExpansionLevel = (nodes: TreeNode[], currentLevel: number): void => {
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
  
  const stats = {
    totalItems: fileStates.length,
    directories: directoriesCount,
    files: filesCount,
    totalSize,
    expandLevel,
    showFiles
  };
  
  logger.info('Directory tree fetched successfully', {
    jobId,
    stats,
    duration: timer.end()
  });
  
  return NextResponse.json({
    success: true,
    data: {
      tree: rootNodes,
      stats
    },
    timestamp: new Date().toISOString()
  });
});
