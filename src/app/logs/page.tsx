"use client";

import { Card, CardContent } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';

export default function LogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">System Logs</h1>
        <p className="text-muted-foreground">
          View real-time system logs and activity
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No logs available</h3>
          <p className="text-muted-foreground text-center">
            System logs will appear here when activity occurs
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
