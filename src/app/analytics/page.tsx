"use client";

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDashboardAnalytics } from '@/hooks/useDashboardAnalytics';
import { 
  BarChart3, 
  TrendingUp, 
  Server, 
  Files, 
  Activity,
  Clock,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { ServerStatusChart } from '@/components/charts/server-status-chart';
import { TransferVolumeChart } from '@/components/charts/transfer-volume-chart';
import { FileSizeDistributionChart } from '@/components/charts/file-size-distribution';
import { TransferSuccessTimeline } from '@/components/charts/transfer-success-timeline';

export default function AnalyticsPage() {
  const { 
    dashboardStats, 
    serverAnalytics, 
    transferAnalytics, 
    fileAnalytics, 
    loading: analyticsLoading 
  } = useDashboardAnalytics();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <BarChart3 className="h-8 w-8" />
          Analytics Dashboard
        </h1>
        <p className="text-muted-foreground">
          Comprehensive analytics and insights for your WarpSync system
        </p>
      </div>

      {/* High-level Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Transfers</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analyticsLoading ? '...' : transferAnalytics?.summary.totalTransfersLast30Days.toLocaleString() || '0'}
            </div>
            <p className="text-xs text-muted-foreground">
              Last 30 days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analyticsLoading ? '...' : `${transferAnalytics?.summary.avgSuccessRate || '0'}%`}
            </div>
            <p className="text-xs text-muted-foreground">
              Average success rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Files</CardTitle>
            <Files className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analyticsLoading ? '...' : fileAnalytics?.summary.totalFiles.toLocaleString() || '0'}
            </div>
            <p className="text-xs text-muted-foreground">
              Files in system
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Storage Used</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analyticsLoading ? '...' : `${((fileAnalytics?.summary.totalStorage || 0) / 1024).toFixed(1)} GB`}
            </div>
            <p className="text-xs text-muted-foreground">
              Total storage used
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Performance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="text-center">
              <div className="text-lg font-semibold">
                {analyticsLoading ? '...' : transferAnalytics?.performance.avgTransferSpeed || 'N/A'}
              </div>
              <p className="text-sm text-muted-foreground">Average Transfer Speed</p>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">
                {analyticsLoading ? '...' : transferAnalytics?.performance.totalDataTransferred || 'N/A'}
              </div>
              <p className="text-sm text-muted-foreground">Total Data Transferred</p>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">
                {analyticsLoading ? '...' : transferAnalytics?.performance.uptime || 'N/A'}
              </div>
              <p className="text-sm text-muted-foreground">System Uptime</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TransferVolumeChart 
          data={transferAnalytics?.dailyTransfers} 
          loading={analyticsLoading}
          className="col-span-full lg:col-span-1"
        />
        <TransferSuccessTimeline 
          data={transferAnalytics?.dailyTransfers} 
          loading={analyticsLoading}
          className="col-span-full lg:col-span-1"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ServerStatusChart 
          data={serverAnalytics?.connectionStatus} 
          loading={analyticsLoading}
          className="col-span-full lg:col-span-1"
        />
        <FileSizeDistributionChart 
          data={transferAnalytics?.fileSizeDistribution} 
          loading={analyticsLoading}
          className="col-span-full lg:col-span-1"
        />
      </div>

      {/* File Analytics */}
      {fileAnalytics && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>File Type Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {fileAnalytics.fileTypes.map((type, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{type.type}</p>
                      <p className="text-sm text-muted-foreground">{type.extensions}</p>
                    </div>
                    <Badge variant="secondary">
                      {type.count.toLocaleString()} files
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Storage Usage by Path</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {fileAnalytics.storageUsage.map((usage, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{usage.path}</p>
                    </div>
                    <Badge variant="outline">
                      {usage.size} {usage.unit}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Current Queue Status */}
      {transferAnalytics?.currentQueue && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Current Queue Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-500">
                  {transferAnalytics.currentQueue.active}
                </div>
                <p className="text-sm text-muted-foreground">Active</p>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-500">
                  {transferAnalytics.currentQueue.queued}
                </div>
                <p className="text-sm text-muted-foreground">Queued</p>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">
                  {transferAnalytics.currentQueue.completed}
                </div>
                <p className="text-sm text-muted-foreground">Completed</p>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-500">
                  {transferAnalytics.currentQueue.failed}
                </div>
                <p className="text-sm text-muted-foreground">Failed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
