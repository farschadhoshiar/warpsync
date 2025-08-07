"use client";

import { Card, CardContent } from '@/components/ui/card';
import { Activity } from 'lucide-react';

export default function QueuePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Transfer Queue</h1>
        <p className="text-muted-foreground">
          Manage and monitor file transfer queue
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Activity className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Queue is empty</h3>
          <p className="text-muted-foreground text-center">
            No files are currently queued for transfer
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
