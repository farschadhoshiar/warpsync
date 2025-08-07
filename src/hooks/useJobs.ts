import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

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
    action: 'none' | 'remove' | 'remove_data' | 'set_label';
    delay: number;
    label?: string;
  };
  parallelism: {
    maxConcurrentTransfers: number;
    maxConnectionsPerTransfer: number;
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

interface JobFormData {
  name: string;
  enabled: boolean;
  serverProfileId: string;
  targetType: 'server' | 'local';
  targetServerId?: string;
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
    action: 'none' | 'remove' | 'remove_data' | 'set_label';
    delay: number;
    label?: string;
  };
  parallelism: {
    maxConcurrentTransfers: number;
    maxConnectionsPerTransfer: number;
  };
}

interface ScanResult {
  jobId: string;
  totalFiles: number;
  newFiles: number;
  changedFiles: number;
  deletedFiles: number;
  duration: number;
  timestamp: string;
}

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/jobs');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch jobs: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (data.success) {
        setJobs(data.data || []);
      } else {
        throw new Error(data.error?.message || 'Failed to fetch jobs');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      toast.error(`Error loading jobs: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const createJob = useCallback(async (jobData: JobFormData): Promise<Job> => {
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jobData),
    });

    if (!response.ok) {
      throw new Error(`Failed to create job: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || 'Failed to create job');
    }

    const newJob = data.data;
    setJobs(prev => [...prev, newJob]);
    toast.success(`Job "${newJob.name}" created successfully`);
    return newJob;
  }, []);

  const updateJob = useCallback(async (id: string, jobData: Partial<JobFormData>): Promise<Job> => {
    const response = await fetch(`/api/jobs/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jobData),
    });

    if (!response.ok) {
      throw new Error(`Failed to update job: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || 'Failed to update job');
    }

    const updatedJob = data.data;
    setJobs(prev => prev.map(job => 
      job._id === id ? updatedJob : job
    ));
    toast.success(`Job "${updatedJob.name}" updated successfully`);
    return updatedJob;
  }, []);

  const deleteJob = useCallback(async (id: string): Promise<void> => {
    const response = await fetch(`/api/jobs/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete job: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || 'Failed to delete job');
    }

    setJobs(prev => prev.filter(job => job._id !== id));
    toast.success('Job deleted successfully');
  }, []);

  const scanJob = useCallback(async (id: string): Promise<ScanResult> => {
    const response = await fetch(`/api/jobs/${id}/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to scan job: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || 'Job scan failed');
    }

    // Update the job's lastScan timestamp
    setJobs(prev => prev.map(job => 
      job._id === id ? { ...job, lastScan: new Date().toISOString() } : job
    ));

    toast.success(`Job "${id}" scanned successfully`);
    return data.data;
  }, []);

  const syncJob = useCallback(async (id: string, fileIds?: string[]): Promise<void> => {
    const response = await fetch(`/api/jobs/${id}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileIds }),
    });

    if (!response.ok) {
      throw new Error(`Failed to start sync: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || 'Sync failed to start');
    }

    toast.success(`Sync started for job "${id}"`);
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  return {
    jobs,
    loading,
    error,
    refetch: fetchJobs,
    createJob,
    updateJob,
    deleteJob,
    scanJob,
    syncJob,
  };
}
