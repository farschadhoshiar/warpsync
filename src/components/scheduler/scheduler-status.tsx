/**
 * Scheduler Status Component
 * Displays scheduler status and provides basic controls
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { 
  Play, 
  Square, 
  RotateCcw, 
  RefreshCw, 
  Clock, 
  Activity,
  CheckCircle,
  XCircle,
  AlertTriangle
} from 'lucide-react';

interface SchedulerStatus {
  isRunning: boolean;
  config: {
    checkInterval: number;
    maxConcurrentScans: number;
    scanTimeout: number;
    errorRetryDelay: number;
    maxErrorCount: number;
    healthCheckInterval: number;
  };
  stats: {
    totalJobs: number;
    activeJobs: number;
    scanningJobs: number;
    errorJobs: number;
    nextScanIn: number;
    lastHealthCheck: string;
    uptime: number;
    totalScansCompleted: number;
    totalScansFailed: number;
  };
  jobs: Array<{
    id: string;
    jobId: string;
    jobName: string;
    status: string;
    lastRun?: string;
    nextRun?: string;
    errorCount: number;
  }>;
}

export function SchedulerStatus() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/scheduler');
      if (!response.ok) {
        throw new Error('Failed to fetch scheduler status');
      }
      const data = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const executeAction = async (action: string) => {
    setActionLoading(action);
    try {
      const response = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} scheduler`);
      }

      // Refresh status after action
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  const triggerJobScan = async (jobId: string) => {
    try {
      const response = await fetch('/api/scheduler/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan_now', jobId })
      });

      if (!response.ok) {
        throw new Error('Failed to trigger job scan');
      }

      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const reloadJobs = async () => {
    setActionLoading('reload');
    try {
      const response = await fetch('/api/scheduler/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reload_jobs' })
      });

      if (!response.ok) {
        throw new Error('Failed to reload jobs');
      }

      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    fetchStatus();
    
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const formatInterval = (ms: number) => {
    if (ms >= 60000) return `${Math.floor(ms / 60000)}m`;
    return `${Math.floor(ms / 1000)}s`;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Scheduler Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading scheduler status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Scheduler Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={fetchStatus} className="mt-4">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!status) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              <CardTitle>Scheduler Status</CardTitle>
            </div>
            <Badge 
              variant={status.isRunning ? "default" : "secondary"}
              className={status.isRunning ? "bg-green-600" : "bg-gray-500"}
            >
              {status.isRunning ? "Running" : "Stopped"}
            </Badge>
          </div>
          <CardDescription>
            Background job scheduler for automatic file synchronization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Control Buttons */}
          <div className="flex gap-2">
            {!status.isRunning ? (
              <Button 
                onClick={() => executeAction('start')}
                disabled={actionLoading === 'start'}
                size="sm"
              >
                {actionLoading === 'start' ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Start
              </Button>
            ) : (
              <>
                <Button 
                  onClick={() => executeAction('stop')}
                  disabled={actionLoading === 'stop'}
                  variant="outline"
                  size="sm"
                >
                  {actionLoading === 'stop' ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4 mr-2" />
                  )}
                  Stop
                </Button>
                <Button 
                  onClick={() => executeAction('restart')}
                  disabled={actionLoading === 'restart'}
                  variant="outline"
                  size="sm"
                >
                  {actionLoading === 'restart' ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4 mr-2" />
                  )}
                  Restart
                </Button>
              </>
            )}
            <Button 
              onClick={reloadJobs}
              disabled={actionLoading === 'reload'}
              variant="outline"
              size="sm"
            >
              {actionLoading === 'reload' ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Reload Jobs
            </Button>
          </div>

          <Separator />

          {/* Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{status.stats.totalJobs}</div>
              <div className="text-sm text-muted-foreground">Total Jobs</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{status.stats.activeJobs}</div>
              <div className="text-sm text-muted-foreground">Active</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{status.stats.scanningJobs}</div>
              <div className="text-sm text-muted-foreground">Scanning</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{status.stats.errorJobs}</div>
              <div className="text-sm text-muted-foreground">Errors</div>
            </div>
          </div>

          <Separator />

          {/* Configuration & Runtime Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-semibold mb-2">Configuration</h4>
              <div className="space-y-1 text-muted-foreground">
                <div>Check Interval: {formatInterval(status.config.checkInterval)}</div>
                <div>Max Concurrent: {status.config.maxConcurrentScans}</div>
                <div>Scan Timeout: {formatInterval(status.config.scanTimeout)}</div>
                <div>Max Errors: {status.config.maxErrorCount}</div>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Runtime Stats</h4>
              <div className="space-y-1 text-muted-foreground">
                <div>Uptime: {formatUptime(status.stats.uptime)}</div>
                <div>Scans Completed: {status.stats.totalScansCompleted}</div>
                <div>Scans Failed: {status.stats.totalScansFailed}</div>
                <div>Success Rate: {
                  status.stats.totalScansCompleted + status.stats.totalScansFailed > 0 
                    ? `${Math.round((status.stats.totalScansCompleted / (status.stats.totalScansCompleted + status.stats.totalScansFailed)) * 100)}%`
                    : 'N/A'
                }</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scheduled Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Scheduled Jobs ({status.jobs.length})
          </CardTitle>
          <CardDescription>
            Sync jobs currently managed by the scheduler
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status.jobs.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No scheduled jobs found
            </div>
          ) : (
            <div className="space-y-3">
              {status.jobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1">
                    <div className="font-medium">{job.jobName}</div>
                    <div className="text-sm text-muted-foreground">
                      Status: <Badge variant="outline" className="ml-1">{job.status}</Badge>
                      {job.errorCount > 0 && (
                        <Badge variant="destructive" className="ml-2">
                          {job.errorCount} errors
                        </Badge>
                      )}
                    </div>
                    {job.lastRun && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Last run: {new Date(job.lastRun).toLocaleString()}
                      </div>
                    )}
                    {job.nextRun && (
                      <div className="text-xs text-muted-foreground">
                        Next run: {new Date(job.nextRun).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {job.status === 'active' && (
                      <div className="flex items-center text-green-600">
                        <CheckCircle className="h-4 w-4" />
                      </div>
                    )}
                    {job.status === 'scanning' && (
                      <div className="flex items-center text-orange-600">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      </div>
                    )}
                    {job.status === 'error' && (
                      <div className="flex items-center text-red-600">
                        <XCircle className="h-4 w-4" />
                      </div>
                    )}
                    <Button
                      onClick={() => triggerJobScan(job.jobId)}
                      variant="outline"
                      size="sm"
                    >
                      Scan Now
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
