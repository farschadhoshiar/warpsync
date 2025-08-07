"use client";

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useServers } from '@/hooks/useServers';
import { useJobs } from '@/hooks/useJobs';
import { Server, FolderSync, Activity, Clock, Plus } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { servers, loading: serversLoading } = useServers();
  const { jobs, loading: jobsLoading } = useJobs();

  const activeJobs = jobs.filter(job => job.enabled);
  const totalServers = servers.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your WarpSync file synchronization system
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Servers</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {serversLoading ? '...' : totalServers}
            </div>
            <p className="text-xs text-muted-foreground">
              Connected remote servers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sync Jobs</CardTitle>
            <FolderSync className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {jobsLoading ? '...' : jobs.length}
            </div>
            <p className="text-xs text-muted-foreground">
              {activeJobs.length} active, {jobs.length - activeJobs.length} disabled
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Transfers</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              Currently transferring files
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Queue</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              Files waiting to sync
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link href="/servers">
              <Button className="w-full justify-start">
                <Plus className="h-4 w-4 mr-2" />
                Add Server Profile
              </Button>
            </Link>
            <Link href="/jobs">
              <Button className="w-full justify-start" variant="outline">
                <FolderSync className="h-4 w-4 mr-2" />
                Create Sync Job
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              No recent activity
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Server Status */}
      {servers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Server Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {servers.map((server) => (
                <div key={server._id} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{server.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {server.user}@{server.address}:{server.port}
                    </p>
                  </div>
                  <Badge variant="outline">Unknown</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Getting Started */}
      {servers.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Welcome to WarpSync</h3>
              <p className="text-muted-foreground mb-4">
                Start by adding your first remote server profile to begin syncing files.
              </p>
              <Link href="/servers">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Server
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
