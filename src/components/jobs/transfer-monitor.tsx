'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Play as PlayIcon, 
  Pause as PauseIcon, 
  Clock as ClockIcon, 
  CheckCircle as CheckCircleIcon, 
  AlertTriangle as ExclamationTriangleIcon, 
  X as XMarkIcon,
  Square as StopIcon 
} from 'lucide-react';

interface Transfer {
  id: string;
  sourceFile: string;
  targetFile: string;
  size: number;
  transferred: number;
  speed: number;
  eta: number;
  status: 'queued' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  progress: number;
  jobId?: string;
  jobName?: string;
}

interface TransferStats {
  total: number;
  active: number;
  queued: number;
  completed: number;
  failed: number;
  totalTransferred: number;
  totalSize: number;
  overallProgress: number;
}

type StatusFilter = 'all' | 'active' | 'queued' | 'completed' | 'failed' | 'cancelled';

interface TransferMonitorProps {
  jobId?: string; // Optional: monitor transfers for specific job only
  showJobColumn?: boolean; // Show job name column when monitoring all transfers
}

export const TransferMonitor: React.FC<TransferMonitorProps> = ({ 
  jobId, 
  showJobColumn = true 
}) => {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [stats, setStats] = useState<TransferStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchTransfers = async () => {
    try {
      const url = jobId ? `/api/queue?jobId=${jobId}` : '/api/queue';
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch transfers');
      }
      
      const data = await response.json();
      setTransfers(data.data.transfers || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch transfers');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const url = jobId ? `/api/queue/stats?jobId=${jobId}` : '/api/queue/stats';
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch stats');
      }
      
      const data = await response.json();
      setStats(data.data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  useEffect(() => {
    fetchTransfers();
    fetchStats();
  }, [jobId]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchTransfers();
      fetchStats();
    }, 2000); // Refresh every 2 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, jobId]);

  const filteredTransfers = transfers.filter(transfer => {
    if (statusFilter === 'all') return true;
    return transfer.status === statusFilter;
  });

  const handleTransferAction = async (transferId: string, action: 'pause' | 'resume' | 'cancel') => {
    try {
      const response = await fetch(`/api/queue/${transferId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} transfer`);
      }

      await fetchTransfers();
    } catch (err) {
      console.error(`Failed to ${action} transfer:`, err);
    }
  };

  const getStatusIcon = (status: Transfer['status']) => {
    switch (status) {
      case 'active':
        return <PlayIcon className="h-4 w-4 text-blue-500" />;
      case 'paused':
        return <PauseIcon className="h-4 w-4 text-yellow-500" />;
      case 'queued':
        return <ClockIcon className="h-4 w-4 text-gray-500" />;
      case 'completed':
        return <CheckCircleIcon className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />;
      case 'cancelled':
        return <XMarkIcon className="h-4 w-4 text-gray-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: Transfer['status']) => {
    const variants = {
      active: 'default',
      paused: 'secondary', 
      queued: 'outline',
      completed: 'default',
      failed: 'destructive',
      cancelled: 'secondary'
    } as const;

    return (
      <Badge variant={variants[status]} className="flex items-center gap-1">
        {getStatusIcon(status)}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatFileSize = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const formatSpeed = (bytesPerSecond: number) => {
    return `${formatFileSize(bytesPerSecond)}/s`;
  };

  const formatETA = (seconds: number) => {
    if (seconds <= 0) return 'Unknown';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const formatDuration = (startedAt?: string, completedAt?: string) => {
    if (!startedAt) return 'Not started';
    
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const duration = (end.getTime() - start.getTime()) / 1000;
    
    return formatETA(duration);
  };

  if (error) {
    return (
      <Alert>
        <AlertDescription>
          Error loading transfers: {error}
          <Button variant="outline" size="sm" onClick={fetchTransfers} className="ml-2">
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">
            {jobId ? 'Job Transfers' : 'Transfer Monitor'}
          </h2>
          <p className="text-muted-foreground">
            Real-time file transfer monitoring and control
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? 'Auto Refresh: ON' : 'Auto Refresh: OFF'}
          </Button>
          <Button variant="outline" onClick={fetchTransfers} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground">Total Transfers</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-blue-600">{stats.active}</div>
              <p className="text-xs text-muted-foreground">Active</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-yellow-600">{stats.queued}</div>
              <p className="text-xs text-muted-foreground">Queued</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
              <p className="text-xs text-muted-foreground">Completed</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Overall Progress */}
      {stats && stats.totalSize > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Overall Progress</span>
                <span>{Math.round(stats.overallProgress)}%</span>
              </div>
              <Progress value={stats.overallProgress} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatFileSize(stats.totalTransferred)} transferred</span>
                <span>{formatFileSize(stats.totalSize)} total</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Transfers</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              Showing {filteredTransfers.length} of {transfers.length} transfers
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transfers List */}
      {loading ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Loading transfers...</p>
        </div>
      ) : filteredTransfers.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                {transfers.length === 0 ? 'No transfers found' : 'No transfers match your filters'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredTransfers.map((transfer) => (
            <Card key={transfer.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {/* Transfer Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusBadge(transfer.status)}
                      {showJobColumn && transfer.jobName && (
                        <Badge variant="outline" className="text-xs">
                          {transfer.jobName}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {transfer.status === 'active' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTransferAction(transfer.id, 'pause')}
                        >
                          <PauseIcon className="h-4 w-4" />
                        </Button>
                      )}
                      {transfer.status === 'paused' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTransferAction(transfer.id, 'resume')}
                        >
                          <PlayIcon className="h-4 w-4" />
                        </Button>
                      )}
                      {(transfer.status === 'active' || transfer.status === 'paused' || transfer.status === 'queued') && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleTransferAction(transfer.id, 'cancel')}
                        >
                          <StopIcon className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* File Paths */}
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Source</p>
                      <p className="font-mono text-sm truncate">{transfer.sourceFile}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Target</p>
                      <p className="font-mono text-sm truncate">{transfer.targetFile}</p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {transfer.status === 'active' && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Progress</span>
                        <span>{Math.round(transfer.progress)}%</span>
                      </div>
                      <Progress value={transfer.progress} className="h-2" />
                    </div>
                  )}

                  {/* Transfer Details */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Size</p>
                      <p>{formatFileSize(transfer.size)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Transferred</p>
                      <p>{formatFileSize(transfer.transferred)}</p>
                    </div>
                    {transfer.status === 'active' && (
                      <>
                        <div>
                          <p className="text-muted-foreground">Speed</p>
                          <p>{formatSpeed(transfer.speed)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">ETA</p>
                          <p>{formatETA(transfer.eta)}</p>
                        </div>
                      </>
                    )}
                    {(transfer.status === 'completed' || transfer.status === 'failed') && (
                      <div>
                        <p className="text-muted-foreground">Duration</p>
                        <p>{formatDuration(transfer.startedAt, transfer.completedAt)}</p>
                      </div>
                    )}
                  </div>

                  {/* Error Message */}
                  {transfer.status === 'failed' && transfer.errorMessage && (
                    <Alert>
                      <ExclamationTriangleIcon className="h-4 w-4" />
                      <AlertDescription>
                        {transfer.errorMessage}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
