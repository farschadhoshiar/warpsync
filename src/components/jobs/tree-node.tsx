/**
 * TreeNode Component
 * Renders individual tree nodes with expand/collapse functionality
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ChevronRight, ChevronDown, Folder, FolderOpen, File, Download, Upload, AlertCircle } from 'lucide-react';
import { TreeNodeProps } from '@/types/tree';
import { useWebSocket } from '@/components/providers/websocket-provider';
import { toast } from 'sonner';

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  level,
  expandedNodes,
  onToggle,
  onFileAction,
  searchTerm,
  jobId
}) => {
  const indentSize = 20; // pixels per level
  const paddingLeft = level * indentSize;
  const isExpanded = expandedNodes.has(node.id);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [transferId, setTransferId] = useState<string | null>(null);
  const { socket, subscribe, unsubscribe } = useWebSocket();

  // Socket.IO event handlers for transfer progress
  useEffect(() => {
    const handleTransferProgress = (data: unknown) => {
      console.log('Transfer progress received:', data);
      
      // Type guard for transfer progress data
      if (typeof data === 'object' && data !== null &&
          'transferId' in data && 'fileId' in data && 'status' in data) {
        const transferData = data as {
          transferId: string;
          fileId: string;
          progress?: number;
          status: string;
          error?: string;
        };
        
        if (transferData.fileId === node.id && transferData.transferId === transferId) {
          console.log('Progress update for current file:', transferData.progress);
          setDownloadProgress(transferData.progress || 0);
          
          if (transferData.status === 'completed') {
            console.log('Download completed:', transferData);
            setIsDownloading(false);
            setDownloadProgress(null);
            setTransferId(null);
            toast.success('Download completed', {
              description: `${node.name} has been downloaded successfully`
            });
          } else if (transferData.status === 'failed') {
            console.error('Download failed:', transferData);
            setIsDownloading(false);
            setDownloadProgress(null);
            setTransferId(null);
            toast.error('Download failed', {
              description: transferData.error || 'Unknown error occurred'
            });
          }
        }
      }
    };

    const handleFileStateUpdate = (data: unknown) => {
      console.log('File state update received:', data);
      
      // Type guard for file state data
      if (typeof data === 'object' && data !== null &&
          'fileId' in data && 'syncState' in data) {
        const fileData = data as {
          fileId: string;
          syncState: string;
        };
        
        if (fileData.fileId === node.id) {
          console.log('File state update for current file:', fileData);
          // Handle file state changes
          if (fileData.syncState === 'transferring') {
            setIsDownloading(true);
          }
        }
      }
    };

    if (socket) {
      console.log('Subscribing to transfer events for file:', node.id);
      subscribe('transfer:progress', handleTransferProgress);
      subscribe('transfer:status', handleTransferProgress);
      subscribe('file:state', handleFileStateUpdate);
    }

    return () => {
      if (socket) {
        console.log('Unsubscribing from transfer events for file:', node.id);
        unsubscribe('transfer:progress', handleTransferProgress);
        unsubscribe('transfer:status', handleTransferProgress);
        unsubscribe('file:state', handleFileStateUpdate);
      }
    };
  }, [socket, node.id, node.name, transferId, subscribe, unsubscribe]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getStatusBadge = (syncState: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; icon?: React.ReactNode }> = {
      synced: { variant: 'default', label: 'Synced' },
      remote_only: { variant: 'secondary', label: 'Remote Only', icon: <Download className="h-3 w-3" /> },
      local_only: { variant: 'outline', label: 'Local Only', icon: <Upload className="h-3 w-3" /> },
      desynced: { variant: 'destructive', label: 'Desynced' },
      queued: { variant: 'secondary', label: 'Queued' },
      transferring: { variant: 'default', label: 'Transferring' },
      failed: { variant: 'destructive', label: 'Error', icon: <AlertCircle className="h-3 w-3" /> }
    };

    const config = variants[syncState] || { variant: 'outline', label: syncState };
    
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  const highlightSearchTerm = (text: string, searchTerm?: string) => {
    if (!searchTerm) return text;
    
    const regex = new RegExp(`(${searchTerm})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) => 
      regex.test(part) ? (
        <span key={index} className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">
          {part}
        </span>
      ) : part
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

  const handleDownload = async () => {
    if (isDownloading) return;
    
    console.log('Starting download for file:', node.id, node.name);
    setIsDownloading(true);
    setDownloadProgress(0);
    
    try {
      console.log('Making download API request:', {
        fileId: node.id,
        jobId: jobId || 'unknown',
        filename: node.name,
        hasJobId: !!jobId,
        jobIdLength: jobId?.length,
        isValidObjectId: jobId && /^[0-9a-fA-F]{24}$/.test(jobId)
      });
      
      // Debug: Check job data first
      if (jobId && jobId !== 'unknown') {
        try {
          const debugResponse = await fetch(`/api/debug/job/${jobId}`);
          const debugData = await debugResponse.json();
          console.log('Job debug data:', debugData);
        } catch (debugError) {
          console.warn('Failed to get job debug data:', debugError);
        }
      }
      
      const response = await fetch('/api/files/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileId: node.id,
          jobId: jobId || 'unknown',
          priority: 'HIGH'
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Download API error response:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          url: response.url,
          headers: Object.fromEntries(response.headers.entries())
        });
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
          console.log('Parsed error data:', errorData);
        } catch (parseError) {
          console.error('Failed to parse error response as JSON:', parseError);
          errorData = { error: errorText || 'Download request failed' };
        }
        
        const errorMessage = errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}` || 'Download request failed';
        console.error('Final error message:', errorMessage);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log('Download API response:', data);
      
      if (data.success) {
        setTransferId(data.data.transferId);
        console.log('Download queued successfully, transferId:', data.data.transferId);
        toast.success('Download started', {
          description: `${node.name} has been queued for download`
        });
      } else {
        throw new Error(data.error || 'Failed to queue download');
      }
      
    } catch (error) {
      console.error('Download error:', error);
      setIsDownloading(false);
      setDownloadProgress(null);
      toast.error('Download failed', {
        description: error instanceof Error ? error.message : 'Unknown error occurred'
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
          if (e.key === 'Enter' || e.key === ' ') {
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

        {/* Sync State Badge */}
        <div className="shrink-0">
          {getStatusBadge(node.syncState)}
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
            title={node.isDirectory ? 'Download folder' : 'Download file'}
          >
            <Download className={`h-3 w-3 ${isDownloading ? 'animate-pulse' : ''}`} />
          </Button>
          
          {/* Queue Button - only for remote_only files */}
          {!node.isDirectory && node.syncState === 'remote_only' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleFileAction('queue');
              }}
              className="h-6 px-2"
              title="Queue for sync"
            >
              <Upload className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Download Progress Bar */}
      {isDownloading && downloadProgress !== null && (
        <div className="mx-4 mb-2" style={{ paddingLeft: `${paddingLeft + 8}px` }}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Downloading...</span>
            <div className="flex-1">
              <Progress value={downloadProgress} className="h-1" />
            </div>
            <span>{downloadProgress}%</span>
          </div>
        </div>
      )}

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
