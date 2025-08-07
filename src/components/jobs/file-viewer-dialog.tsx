/**
 * FileViewerDialog Component
 * Displays file states for a sync job with tree view and filtering
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, FolderTree } from 'lucide-react';
import { toast } from 'sonner';
import TreeView from './tree-view';
import { TreeNode, TreeStats } from '@/types/tree';

interface FileViewerDialogProps {
  jobId: string;
  jobName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function FileViewerDialog({ jobId, jobName, isOpen, onClose }: FileViewerDialogProps) {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [treeStats, setTreeStats] = useState<TreeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const fetchTreeData = useCallback(async () => {
    if (!jobId) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        expandLevel: '2',
        showFiles: 'true',
        ...(searchTerm && { search: searchTerm }),
        ...(statusFilter !== 'all' && { syncState: statusFilter })
      });

      const response = await fetch(`/api/jobs/${jobId}/tree?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to fetch tree data');
      }

      setTreeData(data.data?.tree || []);
      setTreeStats(data.data?.stats || null);
    } catch (error) {
      toast.error('Failed to Load Files', {
        description: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    } finally {
      setLoading(false);
    }
  }, [jobId, searchTerm, statusFilter]);

  useEffect(() => {
    if (isOpen && jobId) {
      fetchTreeData();
    }
  }, [isOpen, jobId, fetchTreeData]);

  const handleToggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const handleRefresh = () => {
    fetchTreeData();
  };

  const handleNodeAction = (nodeId: string, action: string) => {
    // Handle file actions like queue, delete, etc.
    console.log('Node action:', nodeId, action);
    toast.info('Action triggered', {
      description: `${action} action for node ${nodeId}`
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderTree className="h-5 w-5" />
            Files for &quot;{jobName}&quot;
          </DialogTitle>
        </DialogHeader>

        {/* Filters and Controls */}
        <div className="flex items-center gap-4 py-4 border-b">
          <div className="flex-1">
            <Input
              placeholder="Search files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
          </div>
          
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Files</SelectItem>
              <SelectItem value="synced">Synced</SelectItem>
              <SelectItem value="remote_only">Remote Only</SelectItem>
              <SelectItem value="local_only">Local Only</SelectItem>
              <SelectItem value="desynced">Desynced</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="transferring">Transferring</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Tree Statistics */}
        {treeStats && (
          <div className="flex items-center justify-between py-2 border-b">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{treeStats.totalItems} items</span>
              <span>{treeStats.directories} directories</span>
              <span>{treeStats.files} files</span>
              {treeStats.totalSize > 0 && (
                <span>{(treeStats.totalSize / (1024 * 1024)).toFixed(1)} MB total</span>
              )}
            </div>
            
            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchTerm('')}
                disabled={!searchTerm}
                className="text-xs"
              >
                Clear Search
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusFilter('all')}
                disabled={statusFilter === 'all'}
                className="text-xs"
              >
                Clear Filter
              </Button>
            </div>
          </div>
        )}

        {/* Tree View */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Loading files...</p>
              </div>
            </div>
          ) : (
            <TreeView
              treeData={treeData}
              searchTerm={searchTerm}
              statusFilter={statusFilter}
              onNodeAction={handleNodeAction}
              expandedNodes={expandedNodes}
              onToggleNode={handleToggleNode}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
