/**
 * Scheduler Card Component
 * Compact scheduler status and controls for integration into other pages
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Play, 
  Square, 
  RotateCcw, 
  RefreshCw, 
  Activity,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface SchedulerStatus {
  isRunning: boolean;
  config: {
    checkInterval: number;
    maxConcurrentScans: number;
  };
  stats: {
    totalJobs: number;
    activeJobs: number;
    scanningJobs: number;
    errorJobs: number;
    uptime: number;
    totalScansCompleted: number;
    totalScansFailed: number;
  };
  jobs: Array<{
    id: string;
    jobId: string;
    jobName: string;
    status: string;
    errorCount: number;
  }>;
}

export function SchedulerCard() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

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

      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    fetchStatus();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Background Scheduler
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            Loading...
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
            Background Scheduler
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={fetchStatus} size="sm" className="mt-2">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!status) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            <CardTitle>Background Scheduler</CardTitle>
            <Badge 
              variant={status.isRunning ? "default" : "secondary"}
              className={status.isRunning ? "bg-green-600" : "bg-gray-500"}
            >
              {status.isRunning ? "Running" : "Stopped"}
            </Badge>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
        <CardDescription>
          Automatic file scanning and synchronization
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-lg font-bold text-blue-600">{status.stats.totalJobs}</div>
            <div className="text-xs text-muted-foreground">Jobs</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-green-600">{status.stats.activeJobs}</div>
            <div className="text-xs text-muted-foreground">Active</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-orange-600">{status.stats.scanningJobs}</div>
            <div className="text-xs text-muted-foreground">Scanning</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-red-600">{status.stats.errorJobs}</div>
            <div className="text-xs text-muted-foreground">Errors</div>
          </div>
        </div>

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
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="space-y-4">
            {/* Runtime Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="font-medium">Uptime</div>
                <div className="text-muted-foreground">{formatUptime(status.stats.uptime)}</div>
              </div>
              <div>
                <div className="font-medium">Success Rate</div>
                <div className="text-muted-foreground">
                  {status.stats.totalScansCompleted + status.stats.totalScansFailed > 0 
                    ? `${Math.round((status.stats.totalScansCompleted / (status.stats.totalScansCompleted + status.stats.totalScansFailed)) * 100)}%`
                    : 'N/A'
                  }
                </div>
              </div>
            </div>

            {/* Recent Jobs */}
            {status.jobs.length > 0 && (
              <div>
                <div className="font-medium mb-2 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Recent Activity
                </div>
                <div className="space-y-2">
                  {status.jobs.slice(0, 3).map((job) => (
                    <div key={job.id} className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                      <div className="font-medium truncate">{job.jobName}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{job.status}</Badge>
                        {job.errorCount > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            {job.errorCount} errors
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
