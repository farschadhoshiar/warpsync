/**
 * Dashboard Analytics Hook
 * Manages all dashboard data with real-time updates
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

export interface DashboardStats {
  servers: {
    total: number;
    active: number;
    inactive: number;
  };
  jobs: {
    total: number;
    active: number;
    inactive: number;
  };
  transfers: {
    active: number;
    queued: number;
    completed: number;
    total: number;
  };
  files: {
    total: number;
  };
  system: {
    sshConnections: {
      total: number;
      active: number;
      available: number;
    };
  };
  timestamp: string;
}

export interface ServerAnalytics {
  connectionStatus: Array<{
    status: string;
    count: number;
    fill: string;
  }>;
  authMethods: Array<{
    method: string;
    count: number;
    fill: string;
  }>;
  serverUsage: Array<{
    name: string;
    address: string;
    jobCount: number;
    lastUsed: string;
  }>;
  summary: {
    total: number;
    connected: number;
    disconnected: number;
    testing: number;
    error: number;
  };
  timestamp: string;
}

export interface TransferAnalytics {
  dailyTransfers: Array<{
    date: string;
    successful: number;
    failed: number;
    total: number;
    successRate: string;
  }>;
  fileSizeDistribution: Array<{
    range: string;
    count: number;
    fill: string;
  }>;
  currentQueue: {
    active: number;
    queued: number;
    completed: number;
    failed: number;
    total: number;
  };
  performance: {
    avgTransferSpeed: string;
    totalDataTransferred: string;
    uptime: string;
  };
  summary: {
    totalTransfersLast30Days: number;
    avgSuccessRate: string;
    peakDay: {
      date: string;
      total: number;
    };
  };
  timestamp: string;
}

export interface FileAnalytics {
  fileTypes: Array<{
    type: string;
    count: number;
    extensions: string;
    fill: string;
  }>;
  storageUsage: Array<{
    path: string;
    size: number;
    unit: string;
  }>;
  recentActivity: Array<{
    date: string;
    filesAdded: number;
    filesModified: number;
    filesDeleted: number;
  }>;
  syncStatus: Array<{
    status: string;
    count: number;
    fill: string;
  }>;
  summary: {
    totalFiles: number;
    totalStorage: number;
    syncedPercentage: string;
  };
  timestamp: string;
}

export function useDashboardAnalytics() {
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [serverAnalytics, setServerAnalytics] = useState<ServerAnalytics | null>(null);
  const [transferAnalytics, setTransferAnalytics] = useState<TransferAnalytics | null>(null);
  const [fileAnalytics, setFileAnalytics] = useState<FileAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardStats = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/stats');
      if (!response.ok) {
        throw new Error(`Failed to fetch dashboard stats: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success) {
        setDashboardStats(data.data);
      } else {
        throw new Error(data.error?.message || 'Failed to fetch dashboard stats');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      toast.error(`Error loading dashboard stats: ${errorMessage}`);
    }
  }, []);

  const fetchServerAnalytics = useCallback(async () => {
    try {
      const response = await fetch('/api/analytics/servers');
      if (!response.ok) {
        throw new Error(`Failed to fetch server analytics: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success) {
        setServerAnalytics(data.data);
      } else {
        throw new Error(data.error?.message || 'Failed to fetch server analytics');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('Error fetching server analytics:', errorMessage);
    }
  }, []);

  const fetchTransferAnalytics = useCallback(async (days: number = 30) => {
    try {
      const response = await fetch(`/api/analytics/transfers?days=${days}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch transfer analytics: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success) {
        setTransferAnalytics(data.data);
      } else {
        throw new Error(data.error?.message || 'Failed to fetch transfer analytics');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('Error fetching transfer analytics:', errorMessage);
    }
  }, []);

  const fetchFileAnalytics = useCallback(async () => {
    try {
      const response = await fetch('/api/analytics/files');
      if (!response.ok) {
        throw new Error(`Failed to fetch file analytics: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.success) {
        setFileAnalytics(data.data);
      } else {
        throw new Error(data.error?.message || 'Failed to fetch file analytics');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('Error fetching file analytics:', errorMessage);
    }
  }, []);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    await Promise.all([
      fetchDashboardStats(),
      fetchServerAnalytics(),
      fetchTransferAnalytics(),
      fetchFileAnalytics()
    ]);
    
    setLoading(false);
  }, [fetchDashboardStats, fetchServerAnalytics, fetchTransferAnalytics, fetchFileAnalytics]);

  useEffect(() => {
    fetchAllData();
    
    // Set up periodic refresh for real-time updates
    const interval = setInterval(fetchDashboardStats, 30000); // Update every 30 seconds
    
    return () => clearInterval(interval);
  }, [fetchAllData, fetchDashboardStats]);

  return {
    dashboardStats,
    serverAnalytics,
    transferAnalytics,
    fileAnalytics,
    loading,
    error,
    refetch: fetchAllData,
    refetchDashboard: fetchDashboardStats,
    refetchServers: fetchServerAnalytics,
    refetchTransfers: fetchTransferAnalytics,
    refetchFiles: fetchFileAnalytics
  };
}
