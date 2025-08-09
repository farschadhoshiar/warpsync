'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useJobs, type Job } from '@/hooks/useJobs';

type StatusFilter = 'all' | 'active' | 'inactive';
type SortBy = 'name' | 'created' | 'lastRun';

interface JobListProps {
  onEdit?: (id: string) => void;
  onNew?: () => void;
}

export const JobList: React.FC<JobListProps> = ({ onEdit, onNew }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const { jobs, loading, error, refetch } = useJobs();

  // Filter and sort jobs
  const filteredJobs = jobs
    .filter(job => {
      const matchesSearch = job.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          job.remotePath.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          job.localPath.toLowerCase().includes(searchTerm.toLowerCase());
      
      const isActive = job.enabled && job.serverProfileId; // Simple active check
      const matchesStatus = statusFilter === 'all' || 
                          (statusFilter === 'active' && isActive) ||
                          (statusFilter === 'inactive' && !isActive);
      
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'lastRun':
          const aLastScan = a.lastScan ? new Date(a.lastScan).getTime() : 0;
          const bLastScan = b.lastScan ? new Date(b.lastScan).getTime() : 0;
          return bLastScan - aLastScan;
        default:
          return 0;
      }
    });

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled })
      });

      if (response.ok) {
        await refetch();
      } else {
        throw new Error('Failed to update job');
      }
    } catch (error) {
      console.error('Failed to toggle job:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this job?')) return;

    try {
      const response = await fetch(`/api/jobs/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await refetch();
      } else {
        throw new Error('Failed to delete job');
      }
    } catch (error) {
      console.error('Failed to delete job:', error);
    }
  };

  const handleSync = async (id: string) => {
    try {
      const response = await fetch(`/api/jobs/${id}/sync`, {
        method: 'POST'
      });

      if (response.ok) {
        await refetch();
      } else {
        throw new Error('Failed to start sync');
      }
    } catch (error) {
      console.error('Failed to start sync:', error);
    }
  };

  const getStatusBadge = (job: Job) => {
    const isActive = job.enabled && job.serverProfileId;
    
    if (!job.enabled) {
      return <Badge variant="secondary">Disabled</Badge>;
    }
    
    if (!job.serverProfileId) {
      return <Badge variant="destructive">No Server</Badge>;
    }

    if (job.lastScan) {
      const lastScan = new Date(job.lastScan);
      const hoursAgo = (Date.now() - lastScan.getTime()) / (1000 * 60 * 60);
      
      if (hoursAgo < 1) {
        return <Badge variant="default">Recently Scanned</Badge>;
      } else if (hoursAgo < 24) {
        return <Badge variant="secondary">Idle</Badge>;
      } else {
        return <Badge variant="outline">Stale</Badge>;
      }
    }

    if (isActive) {
      return <Badge variant="outline">Ready</Badge>;
    }

    return <Badge variant="destructive">Inactive</Badge>;
  };

  const formatLastScan = (lastScan?: string) => {
    if (!lastScan) return 'Never';
    const date = new Date(lastScan);
    return date.toLocaleString();
  };

  if (error) {
    return (
      <Alert>
        <AlertDescription>
          Error loading jobs: {error}
          <Button variant="outline" size="sm" onClick={refetch} className="ml-2">
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Sync Jobs</h2>
          <p className="text-muted-foreground">
            Manage your file synchronization jobs
          </p>
        </div>
        {onNew && (
          <Button onClick={onNew}>
            New Job
          </Button>
        )}
      </div>

      {/* Filters and search */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="search">Search Jobs</Label>
              <Input
                id="search"
                placeholder="Search by name or path..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div>
              <Label>Status Filter</Label>
              <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Jobs</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Sort By</Label>
              <Select value={sortBy} onValueChange={(value: SortBy) => setSortBy(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="created">Created</SelectItem>
                  <SelectItem value="lastRun">Last Run</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-end">
              <Button variant="outline" onClick={refetch} disabled={loading}>
                {loading ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Jobs list */}
      {loading ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Loading jobs...</p>
        </div>
      ) : filteredJobs.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                {jobs.length === 0 ? 'No sync jobs found' : 'No jobs match your filters'}
              </p>
              {onNew && jobs.length === 0 && (
                <Button onClick={onNew}>
                  Create your first job
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredJobs.map((job) => (
            <Card key={job._id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{job.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(job)}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          Actions
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleSync(job._id)}>
                          Sync Now
                        </DropdownMenuItem>
                        {onEdit && (
                          <DropdownMenuItem onClick={() => onEdit(job._id)}>
                            Edit
                          </DropdownMenuItem>
                        )}
                        <Separator />
                        <DropdownMenuItem 
                          onClick={() => handleDelete(job._id)}
                          className="text-destructive"
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <Label className="text-muted-foreground">Local Path</Label>
                      <p className="font-mono text-xs">{job.localPath}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Remote Path</Label>
                      <p className="font-mono text-xs">{job.remotePath}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <Label className="text-muted-foreground">Auto Queue</Label>
                      <p>{job.autoQueue.enabled ? 'Enabled' : 'Disabled'}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Scan Interval</Label>
                      <p>{job.scanInterval} minutes</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Last Scan</Label>
                      <p>{formatLastScan(job.lastScan)}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={job.enabled}
                        onCheckedChange={() => handleToggleEnabled(job._id, job.enabled)}
                      />
                      <Label className="text-sm">
                        {job.enabled ? 'Enabled' : 'Disabled'}
                      </Label>
                    </div>
                    
                    <div className="text-sm text-muted-foreground">
                      {job.serverProfile && (
                        <span>Server: {job.serverProfile.name}</span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
