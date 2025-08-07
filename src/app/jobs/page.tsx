"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FolderSync, Plus } from 'lucide-react';
import { toast } from 'sonner';
import JobForm from '@/components/jobs/job-form';
import { useJobs } from '@/hooks/useJobs';
import { SchedulerCard } from '@/components/scheduler/scheduler-card';

interface SyncJobFormData {
  name: string;
  description?: string;
  sourceServerId: string;
  targetType: 'server' | 'local';
  targetServerId?: string;
  sourcePath: string;
  targetPath: string;
  direction: 'download' | 'upload' | 'bidirectional';
  deleteExtraneous: boolean;
  preserveTimestamps: boolean;
  preservePermissions: boolean;
  compressTransfer: boolean;
  dryRun: boolean;
  maxRetries: number;
  retryDelay: number;
}

interface Job {
  _id: string;
  name: string;
  enabled: boolean;
  serverProfileId: string | { _id: string; name: string; address: string; port: number };
  targetType: 'server' | 'local';
  targetServerId?: string | { _id: string; name: string; address: string; port: number };
  remotePath: string;
  localPath: string;
  chmod: string;
  scanInterval: number;
  syncOptions: {
    direction: 'download' | 'upload' | 'bidirectional';
    deleteExtraneous: boolean;
    preserveTimestamps: boolean;
    preservePermissions: boolean;
    compressTransfer: boolean;
    dryRun: boolean;
  };
  retrySettings: {
    maxRetries: number;
    retryDelay: number;
  };
  autoQueue: {
    enabled: boolean;
    patterns: string[];
    excludePatterns: string[];
  };
  delugeAction: {
    action: 'none' | 'remove' | 'removeData' | 'setLabel';
    delayMinutes: number;
    label?: string;
  };
  parallelism: {
    maxTransfers: number;
    maxConnections: number;
  };
  lastScan?: string;
  createdAt: string;
  updatedAt: string;
  serverProfile?: {
    name: string;
    address: string;
    port: number;
  };
}

export default function JobsPage() {
  const router = useRouter();
  const [showJobForm, setShowJobForm] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [scanningJob, setScanningJob] = useState<string | null>(null);
  const { jobs, loading, createJob, updateJob, refetch } = useJobs();

  const handleCreateJob = async (data: SyncJobFormData) => {
    try {
      // Transform the sync job form data to match the API schema
      const transformedData = {
        name: data.name,
        enabled: true, // Default to enabled
        serverProfileId: data.sourceServerId, // Use source server as the main server
        targetType: data.targetType,
        targetServerId: data.targetServerId,
        remotePath: data.sourcePath,
        localPath: data.targetPath,
        chmod: '755', // Default chmod
        scanInterval: 3600, // Default 1 hour scan interval
        syncOptions: {
          direction: data.direction,
          deleteExtraneous: data.deleteExtraneous,
          preserveTimestamps: data.preserveTimestamps,
          preservePermissions: data.preservePermissions,
          compressTransfer: data.compressTransfer,
          dryRun: data.dryRun
        },
        retrySettings: {
          maxRetries: data.maxRetries,
          retryDelay: data.retryDelay
        },
        autoQueue: {
          enabled: false,
          patterns: [],
          excludePatterns: []
        },
        delugeAction: {
          action: 'none' as const,
          delay: 0
        },
        parallelism: {
          maxConcurrentTransfers: 3,
          maxConnectionsPerTransfer: 2
        }
      };
      
      await createJob(transformedData);
      setShowJobForm(false);
      refetch();
      toast.success('Job Created', {
        description: `Successfully created sync job "${data.name}" ${data.targetType === 'local' ? 'to local directory' : 'between servers'}`
      });
    } catch (error) {
      toast.error('Failed to Create Job', {
        description: error instanceof Error ? error.message : 'Unknown error occurred'
      });
      throw error; // Re-throw to keep form in error state
    }
  };

  const handleEditJob = (job: Job) => {
    console.log('📝 Edit Job clicked - raw job data:', {
      _id: job._id,
      name: job.name,
      serverProfileId: job.serverProfileId,
      targetType: job.targetType,
      remotePath: job.remotePath,
      localPath: job.localPath
    });
    
    setEditingJob(job);
    setShowJobForm(true);
  };

  const handleUpdateJob = async (data: SyncJobFormData) => {
    if (!editingJob) return;
    
    try {
      const transformedData = {
        name: data.name,
        enabled: editingJob.enabled, // Keep current enabled state
        serverProfileId: data.sourceServerId,
        targetType: data.targetType,
        targetServerId: data.targetServerId,
        remotePath: data.sourcePath,
        localPath: data.targetPath,
        chmod: editingJob.chmod,
        scanInterval: editingJob.scanInterval,
        syncOptions: {
          direction: data.direction,
          deleteExtraneous: data.deleteExtraneous,
          preserveTimestamps: data.preserveTimestamps,
          preservePermissions: data.preservePermissions,
          compressTransfer: data.compressTransfer,
          dryRun: data.dryRun
        },
        retrySettings: {
          maxRetries: data.maxRetries,
          retryDelay: data.retryDelay
        },
        autoQueue: editingJob.autoQueue || {
          enabled: false,
          patterns: [],
          excludePatterns: []
        },
        delugeAction: editingJob.delugeAction || {
          action: 'none' as const,
          delay: 0
        },
        parallelism: editingJob.parallelism || {
          maxConcurrentTransfers: 3,
          maxConnectionsPerTransfer: 2
        }
      };
      
      console.log('Sending update data:', transformedData);
      
      await updateJob(editingJob._id, transformedData);
      setShowJobForm(false);
      setEditingJob(null);
      refetch();
      toast.success('Job Updated', {
        description: `Successfully updated sync job "${data.name}"`
      });
    } catch (error) {
      console.error('Update job error:', error);
      toast.error('Failed to Update Job', {
        description: error instanceof Error ? error.message : 'Unknown error occurred'
      });
      throw error;
    }
  };

  const handleViewFiles = (job: { _id: string; name: string }) => {
    router.push(`/files?jobId=${job._id}`);
  };

  const handleCloseJobForm = () => {
    setShowJobForm(false);
    setEditingJob(null);
  };

  const handleScanJob = async (jobId: string, jobName: string) => {
    setScanningJob(jobId);
    
    try {
      const response = await fetch(`/api/jobs/${jobId}/scan`, {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to scan job');
      }
      
      const scanResults = data.data.scanResults;
      
      toast.success('Scan Completed', {
        description: `Found ${scanResults.newFiles} new files, ${scanResults.changedFiles} changes in "${jobName}"`
      });
      
      // Refresh jobs list to update last scan time
      refetch();
      
    } catch (error) {
      toast.error('Scan Failed', {
        description: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    } finally {
      setScanningJob(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Background Scheduler Status */}
      <SchedulerCard />
      
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sync Jobs</h1>
          <p className="text-muted-foreground">
            Manage your file synchronization jobs
          </p>
        </div>
        <Button onClick={() => setShowJobForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Job
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading jobs...</p>
            </div>
          </CardContent>
        </Card>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderSync className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No sync jobs configured</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first sync job to start transferring files between servers
            </p>
            <Button onClick={() => setShowJobForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Job
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {jobs.map((job) => (
            <Card key={job._id}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{job.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {job.serverProfile?.name} • {job.remotePath} → {job.localPath.startsWith('/data/local') ? `Local: ${job.localPath}` : job.localPath}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        job.enabled 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {job.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {job.localPath.startsWith('/data/local') && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          Local Sync
                        </span>
                      )}
                      {job.lastScan && (
                        <span className="text-xs text-muted-foreground">
                          Last scan: {new Date(job.lastScan).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleScanJob(job._id, job.name)}
                      disabled={scanningJob === job._id}
                    >
                      {scanningJob === job._id ? 'Scanning...' : 'Scan Now'}
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleViewFiles(job)}
                    >
                      View Files
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleEditJob(job)}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Job Creation/Edit Dialog */}
      <Dialog open={showJobForm} onOpenChange={setShowJobForm}>
        <DialogContent className="max-w-12xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingJob ? 'Edit Sync Job' : 'Create New Sync Job'}</DialogTitle>
          </DialogHeader>
          <JobForm
            initialData={editingJob ? {
              name: editingJob.name,
              sourceServerId: typeof editingJob.serverProfileId === 'object' && editingJob.serverProfileId && '_id' in editingJob.serverProfileId
                ? String(editingJob.serverProfileId._id) 
                : String(editingJob.serverProfileId),
              targetType: editingJob.targetType || (editingJob.localPath.startsWith('/data/local') ? 'local' : 'server'),
              targetServerId: editingJob.targetServerId ? (
                typeof editingJob.targetServerId === 'object' && editingJob.targetServerId && '_id' in editingJob.targetServerId
                  ? String(editingJob.targetServerId._id)
                  : String(editingJob.targetServerId)
              ) : undefined,
              sourcePath: editingJob.remotePath,
              targetPath: editingJob.localPath,
              direction: editingJob.syncOptions?.direction || 'download',
              deleteExtraneous: editingJob.syncOptions?.deleteExtraneous || false,
              preserveTimestamps: editingJob.syncOptions?.preserveTimestamps || true,
              preservePermissions: editingJob.syncOptions?.preservePermissions || true,
              compressTransfer: editingJob.syncOptions?.compressTransfer || true,
              dryRun: editingJob.syncOptions?.dryRun || false,
              maxRetries: editingJob.retrySettings?.maxRetries || 3,
              retryDelay: editingJob.retrySettings?.retryDelay || 5000,
            } : undefined}
            onSubmit={editingJob ? handleUpdateJob : handleCreateJob}
            onCancel={handleCloseJobForm}
            isEditing={!!editingJob}
            isLoading={false}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
