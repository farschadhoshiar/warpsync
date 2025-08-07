/**
 * Scheduler Management Page
 * Provides interface for monitoring and controlling the background job scheduler
 */

import React from 'react';
import { SchedulerStatus } from '@/components/scheduler/scheduler-status';

export default function SchedulerPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Scheduler Management</h1>
        <p className="text-muted-foreground mt-2">
          Monitor and control the background job scheduler that automatically scans and queues files for synchronization.
        </p>
      </div>

      <SchedulerStatus />
    </div>
  );
}
