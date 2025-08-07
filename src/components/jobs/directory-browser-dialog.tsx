/**
 * Directory Browser Dialog Component
 * Modal dialog for browsing remote directories with tree view
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Folder, File, Home, ArrowLeft, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface FileInfo {
  name: string;
  path: string;
  size: number;
  modTime: string;
  isDirectory: boolean;
  permissions: string;
}

interface DirectoryListing {
  path: string;
  files: FileInfo[];
  scannedAt: string;
  totalFiles: number;
  totalSize: number;
  serverName: string;
}

interface DirectoryBrowserDialogProps {
  serverId: string;
  serverName: string;
  isOpen: boolean;
  onClose: () => void;
  onPathSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
}

export default function DirectoryBrowserDialog({
  serverId,
  serverName,
  isOpen,
  onClose,
  onPathSelect,
  initialPath = '/',
  title = 'Browse Directory'
}: DirectoryBrowserDialogProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [manualPath, setManualPath] = useState(initialPath);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathHistory, setPathHistory] = useState<string[]>([initialPath]);

  // Load directory listing
  const loadDirectory = async (path: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/servers/${serverId}/browse?path=${encodeURIComponent(path)}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to load directory');
      }
      
      setListing(data.data);
      setCurrentPath(path);
      setManualPath(path);
      
      // Update history if this is a new path
      if (!pathHistory.includes(path)) {
        setPathHistory(prev => [...prev, path]);
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load directory';
      setError(errorMessage);
      toast.error('Directory Loading Failed', {
        description: errorMessage
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle file/folder click
  const handleItemClick = (file: FileInfo) => {
    if (file.isDirectory) {
      loadDirectory(file.path);
    }
  };

  // Navigate to parent directory
  const navigateUp = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    loadDirectory(parentPath);
  };

  // Navigate to home directory
  const navigateHome = () => {
    loadDirectory('/');
  };

  // Handle manual path input
  const handleManualPathSubmit = () => {
    if (manualPath !== currentPath) {
      loadDirectory(manualPath);
    }
  };

  // Handle path selection
  const handleSelectPath = () => {
    onPathSelect(currentPath);
    onClose();
    toast.success('Path Selected', {
      description: `Selected: ${currentPath}`
    });
  };

  // Load initial directory when dialog opens
  useEffect(() => {
    if (isOpen && serverId) {
      loadDirectory(initialPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, serverId, initialPath]);

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            {title} - {serverName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={navigateHome}
              disabled={loading || currentPath === '/'}
            >
              <Home className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={navigateUp}
              disabled={loading || currentPath === '/'}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 flex items-center gap-2">
              <Label htmlFor="path-input" className="sr-only">Path</Label>
              <Input
                id="path-input"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualPathSubmit()}
                placeholder="/path/to/directory"
                className="flex-1"
              />
              <Button
                onClick={handleManualPathSubmit}
                disabled={loading || manualPath === currentPath}
                size="sm"
              >
                Go
              </Button>
            </div>
          </div>

          {/* Current path info */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Current: {currentPath}</span>
            {listing && (
              <span>{listing.totalFiles} items ({formatFileSize(listing.totalSize)})</span>
            )}
          </div>

          {/* Error display */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* File listing */}
          <div className="flex-1 border rounded-md overflow-hidden min-h-0">
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="ml-2">Loading directory...</span>
              </div>
            ) : listing ? (
              <div className="h-96 overflow-auto">
                <div className="space-y-1 p-2">
                  {listing.files.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-accent cursor-pointer"
                      onClick={() => handleItemClick(file)}
                    >
                      {file.isDirectory ? (
                        <Folder className="h-4 w-4 text-blue-500" />
                      ) : (
                        <File className="h-4 w-4 text-gray-500" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{file.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {file.permissions} • {new Date(file.modTime).toLocaleDateString()}
                        </div>
                      </div>
                      {!file.isDirectory && (
                        <Badge variant="secondary" className="text-xs">
                          {formatFileSize(file.size)}
                        </Badge>
                      )}
                    </div>
                  ))}
                  {listing.files.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                      Directory is empty
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSelectPath} disabled={loading}>
            Select Path
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
