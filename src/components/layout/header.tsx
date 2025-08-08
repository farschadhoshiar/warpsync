"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bell, Wifi, Activity } from 'lucide-react';
import { useDashboardAnalytics } from '@/hooks/useDashboardAnalytics';

export function Header() {
  const { dashboardStats, loading } = useDashboardAnalytics();

  return (
    <header className="border-b bg-card px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">WarpSync Dashboard</h2>
        </div>
        
        <div className="flex items-center gap-4">
          {/* System Status Indicators */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Wifi className="h-4 w-4 text-green-500" />
              <Badge variant="secondary" className="text-xs">
                {loading ? '...' : `${dashboardStats?.servers.total || 0} Servers`}
              </Badge>
            </div>
            
            <div className="flex items-center gap-1">
              <Activity className="h-4 w-4 text-blue-500" />
              <Badge variant="secondary" className="text-xs">
                {loading ? '...' : `${dashboardStats?.servers.active || 0} Active`}
              </Badge>
            </div>
          </div>

          {/* Notifications */}
          <Button variant="ghost" size="icon">
            <Bell className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
