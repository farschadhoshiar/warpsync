/**
 * Debug Dashboard Page
 * Development interface for testing and monitoring sync operations
 */

"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Activity, Database, Wifi, HardDrive, RefreshCw, TestTube } from 'lucide-react';
import { toast } from 'sonner';

interface SystemStatus {
  timestamp: string;
  ssh: {
    totalConnections: number;
    activeConnections: number;
    poolStats: {
      total: number;
      inUse: number;
      available: number;
    };
  };
  queue: {
    totalTransfers: number;
    activeTransfers: number;
    queuedTransfers: number;
    completedTransfers: number;
  };
  database: {
    connected: boolean;
    collections: {
      jobs: number;
      servers: number;
      fileStates: number;
    };
  };
  memory: {
    used: string;
    free: string;
    total: string;
  };
}

export default function DebugPage() {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Fetch system status
  const fetchSystemStatus = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/debug/status');
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to fetch system status');
      }
      
      setSystemStatus(data.data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      toast.error('Failed to fetch system status', { description: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  // Create test transfer
  const createTestTransfer = async (testType: string) => {
    try {
      const response = await fetch('/api/debug/test-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testType,
          count: 1,
          priority: 'NORMAL'
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to create test transfer');
      }
      
      toast.success('Test Transfer Created', {
        description: `Created ${testType} test transfer`
      });
      
      // Refresh status after creating test
      fetchSystemStatus();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error('Failed to create test transfer', { description: errorMessage });
    }
  };

  // Clear caches
  const clearCaches = async () => {
    try {
      const response = await fetch('/api/debug/clear-caches', {
        method: 'POST'
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to clear caches');
      }
      
      toast.success('Caches Cleared', {
        description: 'All system caches have been cleared'
      });
      
      fetchSystemStatus();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error('Failed to clear caches', { description: errorMessage });
    }
  };

  // Auto-refresh effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (autoRefresh) {
      interval = setInterval(fetchSystemStatus, 5000); // Refresh every 5 seconds
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  // Initial load
  useEffect(() => {
    fetchSystemStatus();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Debug Dashboard</h1>
          <p className="text-muted-foreground">
            System monitoring and testing interface
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-green-50 border-green-200' : ''}
          >
            <Activity className="h-4 w-4 mr-2" />
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </Button>
          <Button onClick={fetchSystemStatus} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-6">
        {/* System Overview */}
        <div>
          <h2 className="text-xl font-semibold mb-4">System Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* SSH Status */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">SSH Connections</CardTitle>
                <Wifi className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {systemStatus?.ssh?.activeConnections || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  {systemStatus?.ssh?.totalConnections || 0} total connections
                </p>
                {systemStatus && (
                  <div className="mt-2">
                    <Badge variant="secondary" className="text-xs">
                      Pool: {systemStatus.ssh.poolStats.inUse}/{systemStatus.ssh.poolStats.total}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Queue Status */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Transfer Queue</CardTitle>
                <HardDrive className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {systemStatus?.queue?.activeTransfers || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  {systemStatus?.queue?.queuedTransfers || 0} queued
                </p>
                {systemStatus && (
                  <div className="mt-2">
                    <Badge variant="secondary" className="text-xs">
                      {systemStatus.queue.completedTransfers} completed
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Database Status */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Database</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  <Badge variant={systemStatus?.database?.connected ? 'default' : 'destructive'}>
                    {systemStatus?.database?.connected ? 'Connected' : 'Disconnected'}
                  </Badge>
                </div>
                {systemStatus?.database?.collections && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Jobs: {systemStatus.database.collections.jobs}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Servers: {systemStatus.database.collections.servers}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Files: {systemStatus.database.collections.fileStates}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Memory Usage */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {systemStatus?.memory?.used || 'N/A'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {systemStatus?.memory?.free} free of {systemStatus?.memory?.total}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Testing Tools */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Testing Tools</h2>
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Test Transfer Creation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Button
                    onClick={() => createTestTransfer('small-file')}
                    className="flex items-center gap-2"
                  >
                    <TestTube className="h-4 w-4" />
                    Small File Test
                  </Button>
                  <Button
                    onClick={() => createTestTransfer('large-file')}
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    <TestTube className="h-4 w-4" />
                    Large File Test
                  </Button>
                  <Button
                    onClick={() => createTestTransfer('multiple-files')}
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    <TestTube className="h-4 w-4" />
                    Multiple Files Test
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System Maintenance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <Button
                    onClick={clearCaches}
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Clear All Caches
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {systemStatus && (
        <div className="text-xs text-muted-foreground text-center">
          Last updated: {new Date(systemStatus.timestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
}
