/**
 * Scheduler Jobs API
 * Manage individual scheduled jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { JobScheduler } from '@/lib/scheduler/job-scheduler';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const scheduler = JobScheduler.getInstance();
    const jobs = scheduler.getScheduledJobs();
    const runningExecutions = scheduler.getRunningExecutions();

    return NextResponse.json({
      scheduledJobs: jobs,
      runningExecutions: runningExecutions,
      totalJobs: jobs.length,
      activeJobs: runningExecutions.length
    });
  } catch (error) {
    logger.error('Failed to get scheduler jobs', { error });
    return NextResponse.json(
      { error: 'Failed to get scheduler jobs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action, jobId } = await request.json();
    const scheduler = JobScheduler.getInstance();

    switch (action) {
      case 'scan_now':
        if (!jobId) {
          return NextResponse.json(
            { error: 'Job ID is required for scan_now action' },
            { status: 400 }
          );
        }
        
        await scheduler.triggerJobScan(jobId);
        logger.info('Manual scan triggered for job', { jobId });
        
        return NextResponse.json({
          message: `Scan triggered for job ${jobId}`
        });

      case 'reload_jobs':
        await scheduler.refreshJobs();
        logger.info('Scheduler jobs reloaded from database');
        
        return NextResponse.json({
          message: 'Jobs reloaded successfully'
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: scan_now, reload_jobs' },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error('Failed to execute scheduler job action', { error });
    return NextResponse.json(
      { error: 'Failed to execute action' },
      { status: 500 }
    );
  }
}
