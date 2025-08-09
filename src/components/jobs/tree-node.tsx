/**
 * TreeNode Component
 * Renders individual tree nodes with expand/collapse functionality
 */

"use client";

import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  Download,
  Upload,
  AlertCircle,
} from "lucide-react";
import { TreeNodeProps } from "@/types/tree";
import {
  useWebSocket,
  useJobEvents,
} from "@/components/providers/websocket-provider";
import { parseCompositeId } from "@/lib/utils";
import { isValidObjectId } from "@/lib/utils/validation";
import { toast } from "sonner";

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  level,
  expandedNodes,
  onToggle,
  onFileAction,
  searchTerm,
  jobId,
}) => {
  const indentSize = 20; // pixels per level
  const paddingLeft = level * indentSize;
  const isExpanded = expandedNodes.has(node.id);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [transferStats, setTransferStats] = useState<{
    speed?: string;
    eta?: string;
    bytesTransferred?: number;
    totalBytes?: number;
  } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [transferId, setTransferId] = useState<string | null>(null);
  const { socket, subscribe, unsubscribe } = useWebSocket();

  // ✅ Use job events hook for real-time updates
  useJobEvents({
    onProgress: (data: any) => {
      console.log("Job progress received:", data);

      // Handle transfer progress for this specific file
      if (
        data.transferId &&
        data.fileId === node.id &&
        data.transferId === transferId
      ) {
        // Handle both 'progress' and 'percentage' fields for compatibility
        const progressValue = data.progress !== undefined ? data.progress : data.percentage;
        console.log("Progress update for current file:", progressValue);
        setDownloadProgress(progressValue || 0);

        // Update transfer stats
        if (data.speed || data.eta) {
          setTransferStats({
            speed: data.speed,
            eta: data.eta,
            bytesTransferred: data.bytesTransferred,
            totalBytes: data.totalBytes,
          });
        }

        if (data.status === "completed") {
          console.log("Download completed:", data);
          setIsDownloading(false);
          setDownloadProgress(null);
          setTransferId(null);

          toast.success(`Download completed: ${node.name}`);
        } else if (data.status === "error") {
          console.error("Download error:", data.error);
          setIsDownloading(false);
          setDownloadProgress(null);
          setTransferId(null);

          toast.error(`Download failed: ${data.error || "Unknown error"}`);
        }
      }
    },
    onError: (data: any) => {
      if (data.transferId === transferId) {
        console.error("Transfer error:", data);
        setIsDownloading(false);
        setDownloadProgress(null);
        setTransferId(null);

        toast.error(`Transfer error: ${data.error || "Unknown error"}`);
      }
    },
  });

  // ✅ Handle WebSocket events for real-time updates
  useEffect(() => {
    if (!socket) return;
    const handleUnifiedTransferProgress = (data: unknown) => {
      console.log("Unified transfer progress received:", data);

      if (
        typeof data === "object" &&
        data !== null &&
        "transferId" in data &&
        "fileId" in data &&
        ("progress" in data || "percentage" in data)
      ) {
        const progressData = data as {
          transferId: string;
          fileId: string;
          progress?: number;
          percentage?: number;
          speed?: string;
          eta?: string;
          status?: string;
          elapsedTime?: number;
          bytesTransferred?: number;
          totalBytes?: number;
        };

        if (
          progressData.fileId === node.id ||
          (progressData.transferId === transferId && transferId !== null)
        ) {
          // Handle both 'progress' and 'percentage' fields for compatibility
          const progressValue = progressData.progress !== undefined ? progressData.progress : progressData.percentage;
          console.log(
            "Unified progress update for file:",
            node.id,
            "progress:",
            progressValue,
          );
          setDownloadProgress(progressValue || 0);

          // Update transfer stats with rich information
          setTransferStats({
            speed: progressData.speed,
            eta: progressData.eta,
            bytesTransferred: progressData.bytesTransferred,
            totalBytes: progressData.totalBytes,
          });
        }
      }
    };

    // Handle transfer status changes
    const handleTransferStatus = (data: unknown) => {
      console.log("Transfer status received:", data);

      if (
        typeof data === "object" &&
        data !== null &&
        "transferId" in data &&
        "fileId" in data &&
        "newStatus" in data
      ) {
        const statusData = data as {
          transferId: string;
          fileId: string;
          oldStatus: string;
          newStatus: string;
          metadata?: Record<string, unknown>;
        };

        if (
          statusData.fileId === node.id ||
          (statusData.transferId === transferId && transferId !== null)
        ) {
          console.log("Status change for current file:", statusData);

          if (statusData.newStatus === "transferring") {
            setIsDownloading(true);
          } else if (statusData.newStatus === "completed") {
            setIsDownloading(false);
            setDownloadProgress(null);
            setTransferStats(null);
            setTransferId(null);

            toast.success("Download completed", {
              description: `${node.name} has been downloaded successfully`,
            });
          } else if (statusData.newStatus === "failed") {
            setIsDownloading(false);
            setDownloadProgress(null);
            setTransferStats(null);
            setTransferId(null);

            toast.error("Download failed", {
              description:
                (statusData.metadata?.error as string) ||
                "Unknown error occurred",
            });
          }
        }
      }
    };

    const handleFileStateUpdate = (data: unknown) => {
      console.log("File state update received:", data);

      // Type guard for file state data
      if (
        typeof data === "object" &&
        data !== null &&
        "fileId" in data &&
        "syncState" in data
      ) {
        const fileData = data as {
          fileId: string;
          syncState: string;
        };

        if (fileData.fileId === node.id) {
          console.log("File state update for current file:", fileData);
          // Handle file state changes
          if (fileData.syncState === "transferring") {
            setIsDownloading(true);
          }
        }
      }
    };

    // Handle direct rsync progress events
    const handleRsyncProgress = (data: unknown) => {
      console.log("Rsync progress received:", data);

      if (
        typeof data === "object" &&
        data !== null &&
        ("percentage" in data || "progress" in data)
      ) {
        const rsyncData = data as {
          processId?: string;
          percentage?: number;
          progress?: number;
          speed?: string;
          eta?: string;
          status?: string;
        };

        // If this is an active download for this file, update progress
        if (isDownloading && transferId) {
          // Handle both 'progress' and 'percentage' fields
          const progressValue = rsyncData.progress !== undefined ? rsyncData.progress : rsyncData.percentage;
          console.log("Rsync progress update for active download:", progressValue);
          setDownloadProgress(progressValue || 0);

          // Update transfer stats
          if (rsyncData.speed || rsyncData.eta) {
            setTransferStats({
              speed: rsyncData.speed,
              eta: rsyncData.eta,
              bytesTransferred: undefined,
              totalBytes: undefined,
            });
          }
        }
      }
    };

    if (socket) {
      console.log("Subscribing to transfer events for file:", node.id);

      // Subscribe to job:progress events (this is what the server actually emits)
      subscribe("job:progress", (data: any) => {
        console.log("Received job:progress event:", data);

        // Handle different event types within job:progress
        if (data.type === "transfer:progress") {
          handleUnifiedTransferProgress(data);
        } else if (data.type === "transfer:status") {
          handleTransferStatus(data);
        } else if (data.type === "file:state:update") {
          handleFileStateUpdate(data);
        } else if (data.type === "rsync:progress") {
          // Handle direct rsync progress events
          handleRsyncProgress(data);
        }
      });

      // Subscribe to unified events
      subscribe("transfer:progress", handleUnifiedTransferProgress);
      subscribe("transfer:status", handleTransferStatus);
      subscribe("file:state:update", handleFileStateUpdate);
    }

    return () => {
      if (socket) {
        console.log("Unsubscribing from transfer events for file:", node.id);

        // Unsubscribe from job:progress events
        unsubscribe("job:progress", (data: any) => {
          if (data.type === "transfer:progress") {
            handleUnifiedTransferProgress(data);
          } else if (data.type === "transfer:status") {
            handleTransferStatus(data);
          } else if (data.type === "file:state:update") {
            handleFileStateUpdate(data);
          }
        });

        // Unsubscribe from unified events
        unsubscribe("transfer:progress", handleUnifiedTransferProgress);
        unsubscribe("transfer:status", handleTransferStatus);
        unsubscribe("file:state:update", handleFileStateUpdate);
      }
    };
  }, [socket, node.id, node.name, transferId, subscribe, unsubscribe]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getStatusBadge = (syncState: string) => {
    const variants: Record<
      string,
      {
        variant: "default" | "secondary" | "destructive" | "outline";
        label: string;
        icon?: React.ReactNode;
      }
    > = {
      synced: { variant: "default", label: "Synced" },
      remote_only: {
        variant: "secondary",
        label: "Remote Only",
        icon: <Download className="h-3 w-3" />,
      },
      local_only: {
        variant: "outline",
        label: "Local Only",
        icon: <Upload className="h-3 w-3" />,
      },
      desynced: { variant: "destructive", label: "Desynced" },
      queued: { variant: "secondary", label: "Queued" },
      transferring: { variant: "default", label: "Transferring" },
      failed: {
        variant: "destructive",
        label: "Error",
        icon: <AlertCircle className="h-3 w-3" />,
      },
    };

    const config = variants[syncState] || {
      variant: "outline",
      label: syncState,
    };

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  const highlightSearchTerm = (text: string, searchTerm?: string) => {
    if (!searchTerm) return text;

    const regex = new RegExp(`(${searchTerm})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? (
        <span
          key={index}
          className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded"
        >
          {part}
        </span>
      ) : (
        part
      ),
    );
  };

  const handleToggle = () => {
    if (node.isDirectory) {
      onToggle(node.id);
    }
  };

  const handleFileAction = (action: string) => {
    if (onFileAction) {
      onFileAction(node.id, action);
    }
  };

  const handleDownload = async (retryCount = 0) => {
    if (isDownloading) return;

    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    console.log(
      "Starting download for file:",
      node.id,
      node.name,
      retryCount > 0 ? `(retry ${retryCount})` : "",
    );
    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      // Parse composite ID to get actual fileId and jobId
      const parsedId = parseCompositeId(node.id);
      const actualFileId = parsedId.fileId;
      const actualJobId = parsedId.isComposite
        ? parsedId.jobId
        : jobId || "unknown";

      console.log("Parsed ID information:", {
        originalNodeId: node.id,
        parsedFileId: actualFileId,
        originalJobId: jobId,
        actualJobId: actualJobId,
        isComposite: parsedId.isComposite,
        filename: node.name,
        isDirectory: node.isDirectory,
        fileIdValid: isValidObjectId(actualFileId),
        jobIdValid: isValidObjectId(actualJobId),
        retryAttempt: retryCount,
      });

      console.log("Starting download for file:", actualFileId);

      // Validate IDs before making API call
      if (!isValidObjectId(actualFileId)) {
        throw new Error(`Invalid file ID format: ${actualFileId}`);
      }

      if (!isValidObjectId(actualJobId)) {
        throw new Error(`Invalid job ID format: ${actualJobId}`);
      }

      // Debug: Check job data first (only for non-composite IDs to avoid "all" jobId)
      if (!parsedId.isComposite && actualJobId !== "unknown") {
        try {
          const debugResponse = await fetch(`/api/debug/job/${actualJobId}`);
          const debugData = await debugResponse.json();
          console.log("Job debug data:", debugData);
        } catch (debugError) {
          console.warn("Failed to get job debug data:", debugError);
        }
      }

      // Add timeout for large files/directories
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds

      try {
        const response = await fetch("/api/files/download", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileId: node.id, // Send the original node.id (may be composite)
            jobId: actualJobId, // Send the parsed/actual jobId
            priority: "HIGH",
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Download API error response:", {
            status: response.status,
            statusText: response.statusText,
            body: errorText,
            url: response.url,
            headers: Object.fromEntries(response.headers.entries()),
          });

          let errorData;
          try {
            errorData = JSON.parse(errorText);
            console.log("Parsed error data:", errorData);
          } catch (parseError) {
            console.error(
              "Failed to parse error response as JSON:",
              parseError,
            );
            errorData = { error: errorText || "Download request failed" };
          }

          const errorMessage =
            errorData.error ||
            errorData.message ||
            `HTTP ${response.status}: ${response.statusText}` ||
            "Download request failed";
          console.error("Final error message:", errorMessage);
          throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log("Download API response:", data);

        if (data.success) {
          // Extract transfer ID from response - handle both single and multiple transfers
          let transferIdToSet = null;

          if (data.data.transferId) {
            transferIdToSet = data.data.transferId;
          } else if (
            data.data.transferIds &&
            data.data.transferIds.length > 0
          ) {
            transferIdToSet = data.data.transferIds[0]; // Use first transfer ID for directory downloads
          }

          if (transferIdToSet) {
            setTransferId(transferIdToSet);
            console.log(
              "Download queued successfully, transferId:",
              transferIdToSet,
            );
          } else {
            console.warn("No transfer ID received in response:", data);
          }

          toast.success("Download started", {
            description: `${node.name} has been queued for download`,
          });
        } else {
          throw new Error(data.error || "Failed to queue download");
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (error) {
      console.error("Download error:", error);

      // Check if this is an ID parsing error (non-retryable)
      const isIdError =
        error instanceof Error &&
        (error.message.includes("Invalid file ID format") ||
          error.message.includes("Invalid job ID format"));

      // Check if we should retry
      const isRetryableError =
        !isIdError &&
        error instanceof Error &&
        (error.message.includes("NetworkError") ||
          error.message.includes("timeout") ||
          error.message.includes("fetch") ||
          error.name === "AbortError" ||
          (error.message.includes("HTTP") &&
            (error.message.includes("502") ||
              error.message.includes("503") ||
              error.message.includes("504"))));

      if (isRetryableError && retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
        console.log(
          `Retrying download in ${delay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`,
        );

        toast.info("Download retry", {
          description: `Retrying download in ${delay / 1000} seconds... (attempt ${retryCount + 1})`,
        });

        setTimeout(() => {
          handleDownload(retryCount + 1);
        }, delay);
        return;
      }

      // Final failure
      setIsDownloading(false);
      setDownloadProgress(null);

      let errorMessage = "Unknown error occurred";
      if (error instanceof Error) {
        errorMessage = error.message;

        // Provide user-friendly error messages
        if (error.message.includes("timeout") || error.name === "AbortError") {
          errorMessage =
            "Download request timed out. This may be due to large file size or network issues.";
        } else if (
          error.message.includes("NetworkError") ||
          error.message.includes("fetch")
        ) {
          errorMessage =
            "Network error occurred. Please check your connection and try again.";
        } else if (
          error.message.includes("Invalid file ID format") ||
          error.message.includes("Invalid job ID format")
        ) {
          errorMessage =
            "Invalid file or job ID. Please refresh the page and try again.";
        }
      }

      toast.error("Download failed", {
        description:
          retryCount > 0
            ? `Failed after ${retryCount + 1} attempts: ${errorMessage}`
            : errorMessage,
      });
    }
  };

  return (
    <div className="select-none">
      {/* Current Node */}
      <div
        className="flex items-center gap-2 py-2 px-2 hover:bg-accent rounded-md group cursor-pointer"
        style={{ paddingLeft: `${paddingLeft + 8}px` }}
        onClick={handleToggle}
        role={node.isDirectory ? "treeitem" : "listitem"}
        aria-expanded={node.isDirectory ? isExpanded : undefined}
        aria-level={level + 1}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        {/* Expand/Collapse Icon */}
        <div className="w-4 h-4 flex items-center justify-center">
          {node.isDirectory ? (
            node.children.length > 0 ? (
              isExpanded ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )
            ) : null
          ) : null}
        </div>

        {/* Folder/File Icon */}
        <div className="w-5 h-5 flex items-center justify-center">
          {node.isDirectory ? (
            isExpanded ? (
              <FolderOpen className="h-4 w-4 text-blue-500" />
            ) : (
              <Folder className="h-4 w-4 text-blue-500" />
            )
          ) : (
            <File className="h-4 w-4 text-gray-500" />
          )}
        </div>

        {/* File/Directory Name */}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate" title={node.relativePath}>
            {highlightSearchTerm(node.name, searchTerm)}
          </div>

          {/* File/Directory Details */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            {node.isDirectory ? (
              <>
                {node.fileCount !== undefined && (
                  <span>{node.fileCount} items</span>
                )}
                {node.directorySize !== undefined && node.directorySize > 0 && (
                  <span>{formatFileSize(node.directorySize)}</span>
                )}
              </>
            ) : (
              <>
                {node.size !== undefined && (
                  <span>{formatFileSize(node.size)}</span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Sync State Badge with inline progress */}
        <div className="shrink-0 flex items-center gap-2">
          {getStatusBadge(node.syncState)}
          {isDownloading && downloadProgress !== null && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-blue-600">{Math.round(downloadProgress)}%</span>
              {transferStats?.speed && (
                <span className="font-medium text-green-600">{transferStats.speed}</span>
              )}
              {transferStats?.eta && (
                <span className="font-medium text-orange-600">{transferStats.eta}</span>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons (shown on hover) */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          {/* Download Button - always available for files and directories */}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
            disabled={isDownloading}
            className="h-6 px-2"
            title={node.isDirectory ? "Download folder" : "Download file"}
          >
            <Download
              className={`h-3 w-3 ${isDownloading ? "animate-pulse" : ""}`}
            />
          </Button>

          {/* Queue Button - only for remote_only files */}
          {!node.isDirectory && node.syncState === "remote_only" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleFileAction("queue");
              }}
              className="h-6 px-2"
              title="Queue for sync"
            >
              <Upload className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Children (if expanded) */}
      {node.isDirectory && isExpanded && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
              onFileAction={onFileAction}
              searchTerm={searchTerm}
              jobId={jobId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TreeNode;
