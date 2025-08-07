"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, FolderTree, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import TreeView from '@/components/jobs/tree-view';
import { TreeNode, TreeStats } from '@/types/tree';
import { useJobs } from '@/hooks/useJobs';

export default function FilesPage() {
  const searchParams = useSearchParams();
  const { jobs, loading: jobsLoading } = useJobs();
  
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [treeStats, setTreeStats] = useState<TreeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [recalculating, setRecalculating] = useState(false);

  // Pre-select job from URL parameters
  useEffect(() => {
    const jobId = searchParams.get('jobId');
    if (jobId && jobs.length > 0) {
      const jobExists = jobs.some(job => job._id === jobId);
      if (jobExists) {
        setSelectedJobId(jobId);
      }
    }
  }, [searchParams, jobs]);

  const fetchTreeData = useCallback(async () => {
    if (!selectedJobId) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        expandLevel: '2',
        showFiles: 'true',
        ...(searchTerm && { search: searchTerm }),
        ...(statusFilter !== 'all' && { syncState: statusFilter })
      });

      const response = await fetch(`/api/jobs/${selectedJobId}/tree?${params}`);
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
  }, [selectedJobId, searchTerm, statusFilter]);

  useEffect(() => {
    if (selectedJobId) {
      // Reset expanded nodes when changing jobs (start collapsed)
      setExpandedNodes(new Set());
      fetchTreeData();
    } else {
      setTreeData([]);
      setTreeStats(null);
      setExpandedNodes(new Set());
    }
  }, [selectedJobId, fetchTreeData]);

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

  const handleRecalculateStats = async () => {
    if (!selectedJobId) return;

    setRecalculating(true);
    try {
      const response = await fetch(`/api/jobs/${selectedJobId}/recalculate-stats`, {
        method: 'POST',
      });
      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to recalculate directory statistics');
      }

      toast.success('Directory Statistics Updated', {
        description: `Recalculated statistics for ${data.data.directoriesProcessed} directories`
      });

      // Refresh tree data to show updated statistics
      fetchTreeData();

    } catch (error) {
      toast.error('Recalculation Failed', {
        description: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    } finally {
      setRecalculating(false);
    }
  };

  const selectedJob = jobs.find(job => job._id === selectedJobId);

  return (
    <div className="space-y-6">
      {/* File Browser */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderTree className="h-5 w-5" />
            Files {selectedJob && `for "${selectedJob.name}"`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filters and Controls */}
          <div className="flex items-center gap-4 py-4 border-b">
            {/* Job Selector */}
            <div className="flex-1">
              <Select 
                value={selectedJobId} 
                onValueChange={setSelectedJobId}
                disabled={jobsLoading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a sync job to view files..." />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((job) => (
                    <SelectItem key={job._id} value={job._id}>
                      <div className="flex items-center justify-between w-full">
                        <span>{job.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {typeof job.serverProfileId === 'object' 
                            ? job.serverProfileId.name 
                            : 'Unknown Server'
                          }
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div className="flex-1">
              <Input
                placeholder="Search files..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                disabled={!selectedJobId}
              />
            </div>
            
            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter} disabled={!selectedJobId}>
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

            {/* Refresh Button */}
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading || !selectedJobId}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>

            {/* Recalculate Stats Button */}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRecalculateStats} 
              disabled={recalculating || !selectedJobId}
            >
              <Calculator className={`h-4 w-4 mr-2 ${recalculating ? 'animate-pulse' : ''}`} />
              {recalculating ? 'Calculating...' : 'Recalc Stats'}
            </Button>
          </div>

          {/* Job Info */}
          {selectedJob && (
            <div className="flex items-center gap-4 py-2 text-sm text-muted-foreground border-b">
              <span>Remote: {selectedJob.remotePath}</span>
              <span>Local: {selectedJob.localPath}</span>
            </div>
          )}

          {/* Tree Statistics */}
          {selectedJobId && treeStats && (
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
          {selectedJobId ? (
            <div className="mt-4">
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
                  jobId={selectedJobId}
                />
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <FolderTree className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Job Selected</h3>
                <p className="text-muted-foreground">
                  Choose a sync job from the selector above to view its files.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
