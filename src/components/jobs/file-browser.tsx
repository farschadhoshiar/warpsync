"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import TreeView from "@/components/jobs/tree-view";
import { TreeStats } from "@/components/jobs/tree-stats";
import { FileActions } from "@/components/jobs/file-actions";
import { EmptyState } from "@/components/jobs/empty-state";
import { LoadingState } from "@/components/jobs/loading-state";
import { TreeNode } from "@/types/tree";
import {
  Download,
  Upload,
  RotateCcw,
  CheckSquare,
  Square,
  Trash2,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { useWebSocket } from "@/components/providers/websocket-provider";

interface FileBrowserProps {
  jobId: string;
  searchTerm: string;
  syncState: string;
  sortBy: string;
  pathFilter: string;
  jobs?: any[]; // For all jobs mode
}

export function FileBrowser({
  jobId,
  searchTerm,
  syncState,
  sortBy,
  pathFilter,
  jobs = [],
}: FileBrowserProps) {
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  // ✅ No manual room management needed - WebSocketProvider handles this via connection parameters

  // Fetch tree data when jobId changes
  useEffect(() => {
    if (!jobId) {
      setTreeData([]);
      return;
    }

    const fetchTreeData = async () => {
      setLoading(true);
      try {
        if (jobId === "all") {
          // Fetch tree data for all enabled jobs
          const enabledJobs = jobs.filter((job) => job.enabled);
          if (enabledJobs.length === 0) {
            setTreeData([]);
            return;
          }

          const allTreePromises = enabledJobs.map(async (job) => {
            try {
              const response = await fetch(`/api/jobs/${job._id}/tree`);
              if (response.ok) {
                const data = await response.json();
                if (data.success) {
                  // Add job info to each root node
                  return (data.data?.tree || []).map((node: TreeNode) => ({
                    ...node,
                    id: `${job._id}-${node.id}`, // Prefix with job ID to ensure uniqueness
                    jobId: job._id,
                    jobName: job.name,
                  }));
                }
              }
              return [];
            } catch (error) {
              console.error(`Failed to load tree for job ${job._id}:`, error);
              return [];
            }
          });

          const allTrees = await Promise.all(allTreePromises);
          const combinedTree = allTrees.flat();
          setTreeData(combinedTree);
        } else {
          // Fetch tree data for single job
          const response = await fetch(`/api/jobs/${jobId}/tree`);
          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              setTreeData(data.data?.tree || []);
            } else {
              throw new Error(data.error?.message || "Failed to fetch files");
            }
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        }
      } catch (error) {
        console.error("Failed to load tree data:", error);
        toast.error("Failed to load files");
        setTreeData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTreeData();
  }, [jobId, jobs]);

  // Filter tree data based on current filters
  const filteredData = useMemo(() => {
    if (!treeData.length) return [];

    // Apply sync state filter
    const filterBySyncState = (nodes: TreeNode[]): TreeNode[] => {
      return nodes
        .filter((node) => {
          if (syncState === "all") return true;
          return node.syncState === syncState;
        })
        .map((node) => ({
          ...node,
          children: filterBySyncState(node.children),
        }));
    };

    let result = filterBySyncState(treeData);

    // Apply search term filter
    if (searchTerm) {
      const filterBySearch = (nodes: TreeNode[]): TreeNode[] => {
        return nodes
          .filter((node) => {
            const matchesSearch =
              node.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              node.relativePath
                .toLowerCase()
                .includes(searchTerm.toLowerCase());
            const hasMatchingChildren =
              node.children.length > 0 &&
              filterBySearch(node.children).length > 0;
            return matchesSearch || hasMatchingChildren;
          })
          .map((node) => ({
            ...node,
            children: filterBySearch(node.children),
          }));
      };
      result = filterBySearch(result);
    }

    // Apply path filter
    if (pathFilter) {
      const filterByPath = (nodes: TreeNode[]): TreeNode[] => {
        return nodes
          .filter((node) => {
            const matchesPath = node.relativePath
              .toLowerCase()
              .includes(pathFilter.toLowerCase());
            const hasMatchingChildren =
              node.children.length > 0 &&
              filterByPath(node.children).length > 0;
            return matchesPath || hasMatchingChildren;
          })
          .map((node) => ({
            ...node,
            children: filterByPath(node.children),
          }));
      };
      result = filterByPath(result);
    }

    return result;
  }, [treeData, searchTerm, syncState, pathFilter]);

  const stats = useMemo(() => {
    const calculateStats = (
      nodes: TreeNode[],
    ): { files: number; size: number } => {
      let files = 0;
      let size = 0;

      nodes.forEach((node) => {
        if (node.isDirectory) {
          const childStats = calculateStats(node.children);
          files += childStats.files;
          size += childStats.size;
        } else {
          files++;
          size += node.size || 0;
        }
      });

      return { files, size };
    };

    const treeStats = calculateStats(treeData);
    const filteredStats = calculateStats(filteredData);

    return {
      totalFiles: treeStats.files,
      totalSize: treeStats.size,
      selectedCount: selectedFiles.length,
      filteredCount: filteredStats.files,
    };
  }, [treeData, filteredData, selectedFiles]);

  const handleToggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const handleNodeAction = (nodeId: string, action: string) => {
    console.log(`Action ${action} on node ${nodeId}`);
  };

  const handleSelectAll = () => {
    const getAllNodeIds = (nodes: TreeNode[]): string[] => {
      let ids: string[] = [];
      nodes.forEach((node) => {
        ids.push(node.id);
        if (node.children.length > 0) {
          ids = ids.concat(getAllNodeIds(node.children));
        }
      });
      return ids;
    };
    setSelectedFiles(getAllNodeIds(filteredData));
  };

  const handleDeselectAll = () => {
    setSelectedFiles([]);
  };

  const handleFileAction = async (action: string) => {
    setIsLoading(true);
    try {
      // Placeholder for actual API calls
      await new Promise((resolve) => setTimeout(resolve, 1000));
      toast.success(`${action} completed for ${selectedFiles.length} files`);
      setSelectedFiles([]);
    } catch (error) {
      toast.error(`Failed to ${action.toLowerCase()} files`);
    } finally {
      setIsLoading(false);
    }
  };

  if (loading) {
    return <LoadingState type="skeleton" message="Loading files..." />;
  }

  if (!jobId || (jobId !== "all" && !jobId)) {
    return <EmptyState type="no-job" />;
  }

  if (jobId === "all" && (!jobs || jobs.length === 0)) {
    return (
      <EmptyState
        type="no-files"
        message="No jobs available to display files from."
      />
    );
  }

  if (treeData.length === 0) {
    return <EmptyState type="no-files" />;
  }

  if (filteredData.length === 0) {
    return <EmptyState type="no-matches" />;
  }

  const hasSelection = selectedFiles.length > 0;
  const getAllFilteredNodeCount = (nodes: TreeNode[]): number => {
    let count = 0;
    nodes.forEach((node) => {
      count++;
      count += getAllFilteredNodeCount(node.children);
    });
    return count;
  };
  const allSelected =
    selectedFiles.length === getAllFilteredNodeCount(filteredData);

  return (
    <div className="space-y-6">
      <TreeStats {...stats} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Files</span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={allSelected ? handleDeselectAll : handleSelectAll}
              >
                {allSelected ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <CheckSquare className="h-4 w-4" />
                )}
                {allSelected ? "Deselect All" : "Select All"}
              </Button>

              {hasSelection && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFileAction("Download")}
                    disabled={isLoading}
                  >
                    <Download className="h-4 w-4" />
                    Download ({selectedFiles.length})
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFileAction("Upload")}
                    disabled={isLoading}
                  >
                    <Upload className="h-4 w-4" />
                    Upload ({selectedFiles.length})
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFileAction("Resync")}
                    disabled={isLoading}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Resync ({selectedFiles.length})
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFileAction("Queue")}
                    disabled={isLoading}
                  >
                    <Play className="h-4 w-4" />
                    Queue ({selectedFiles.length})
                  </Button>

                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleFileAction("Delete")}
                    disabled={isLoading}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete ({selectedFiles.length})
                  </Button>
                </>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TreeView
            treeData={filteredData}
            searchTerm={searchTerm}
            statusFilter={syncState}
            onNodeAction={handleNodeAction}
            expandedNodes={expandedNodes}
            onToggleNode={handleToggleNode}
            jobId={jobId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
