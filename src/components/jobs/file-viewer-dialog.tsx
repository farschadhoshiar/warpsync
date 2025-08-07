/**
 * FileViewerDialog Component
 * Displays file states for a sync job with filtering and actions
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { File, Folder, RefreshCw, Download, Upload, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface FileState {
  _id: string;
  jobId: string;
  relativePath: string;
  filename: string;
  syncState: 'synced' | 'remote_only' | 'local_only' | 'desynced' | 'queued' | 'transferring' | 'failed';
  remote: {
    size?: number;
    modTime?: Date;
    exists: boolean;
  };
  local: {
    size?: number;
    modTime?: Date;
    exists: boolean;
  };
  transfer: {
    progress: number;
    speed?: string;
    eta?: string;
    errorMessage?: string;
    retryCount: number;
    startedAt?: Date;
    completedAt?: Date;
  };
  lastSeen: Date;
  addedAt: Date;
}

interface FileViewerDialogProps {
  jobId: string;
  jobName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function FileViewerDialog({ jobId, jobName, isOpen, onClose }: FileViewerDialogProps) {
  const [files, setFiles] = useState<FileState[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalFiles, setTotalFiles] = useState(0);

  const filesPerPage = 50;

  const fetchFiles = useCallback(async (page: number = 1) => {
    if (!jobId) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: filesPerPage.toString(),
        ...(searchTerm && { search: searchTerm }),
        ...(statusFilter !== 'all' && { syncState: statusFilter })
      });

      const response = await fetch(`/api/jobs/${jobId}/files?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to fetch files');
      }

      setFiles(data.data || []);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotalFiles(data.pagination?.total || 0);
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
      fetchFiles(1);
      setCurrentPage(1);
    }
  }, [isOpen, jobId, fetchFiles]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchFiles(page);
  };

  const handleRefresh = () => {
    fetchFiles(currentPage);
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

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <File className="h-5 w-5" />
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

        {/* File List */}
        <div className="flex-1 overflow-y-auto">
          {loading && files.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Loading files...</p>
              </div>
            </div>
          ) : files.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <File className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No files found</h3>
                <p className="text-muted-foreground">
                  {searchTerm || statusFilter !== 'all' 
                    ? 'Try adjusting your filters or search term'
                    : 'This job has no files yet. Run a scan to discover files.'
                  }
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((file) => {
                // Determine if it's a directory based on filename ending with /
                const isDirectory = file.relativePath.endsWith('/');
                // Get file size from remote or local metadata
                const fileSize = file.remote.size || file.local.size || 0;
                // Use lastSeen as the timestamp for display
                const lastModified = file.lastSeen;
                // Get error message from transfer if exists
                const errorMessage = file.transfer.errorMessage;
                
                return (
                  <Card key={file._id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {isDirectory ? (
                          <Folder className="h-5 w-5 text-blue-500 shrink-0" />
                        ) : (
                          <File className="h-5 w-5 text-gray-500 shrink-0" />
                        )}
                        
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate" title={file.relativePath}>
                            {file.filename}
                          </p>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                            {!isDirectory && (
                              <span>{formatFileSize(fileSize)}</span>
                            )}
                            <span>{formatDate(lastModified.toString())}</span>
                            {errorMessage && (
                              <span className="text-red-500" title={errorMessage}>
                                Error
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="shrink-0">
                        {getStatusBadge(file.syncState)}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Showing {files.length} of {totalFiles} files
            </p>
            
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1 || loading}
              >
                Previous
              </Button>
              
              <span className="text-sm">
                Page {currentPage} of {totalPages}
              </span>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages || loading}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
