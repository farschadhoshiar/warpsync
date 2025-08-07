/**
 * Scheduler API Routes
 * Provides endpoints for managing the background job scheduler
 */

import { NextRequest, NextResponse } from 'next/server';
import { JobScheduler } from '@/lib/scheduler/job-scheduler';
import { SchedulerConfigManager } from '@/lib/scheduler/config';
import { logger } from '@/lib/logger';

/**
 * GET /api/scheduler - Get scheduler status and statistics
 */
export async function GET() {
  try {
    const scheduler = JobScheduler.getInstance();
    const config = SchedulerConfigManager.getInstance();
    
    const status = {
      isRunning: scheduler.isSchedulerRunning(),
      config: config.getConfig(),
      stats: scheduler.getStats(),
      jobs: scheduler.getScheduledJobs()
    };

    return NextResponse.json(status);
  } catch (error) {
    logger.error('Failed to get scheduler status', { error });
    return NextResponse.json(
      { error: 'Failed to get scheduler status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/scheduler - Start or stop the scheduler
 */
export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();
    const scheduler = JobScheduler.getInstance();

    switch (action) {
      case 'start':
        if (!scheduler.isSchedulerRunning()) {
          await scheduler.start();
          logger.info('Scheduler started via API');
          return NextResponse.json({ message: 'Scheduler started successfully' });
        } else {
          return NextResponse.json({ message: 'Scheduler is already running' });
        }

      case 'stop':
        if (scheduler.isSchedulerRunning()) {
          await scheduler.stop();
          logger.info('Scheduler stopped via API');
          return NextResponse.json({ message: 'Scheduler stopped successfully' });
        } else {
          return NextResponse.json({ message: 'Scheduler is not running' });
        }

      case 'restart':
        if (scheduler.isSchedulerRunning()) {
          await scheduler.stop();
        }
        await scheduler.start();
        logger.info('Scheduler restarted via API');
        return NextResponse.json({ message: 'Scheduler restarted successfully' });

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: start, stop, or restart' },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error('Failed to control scheduler', { error });
    return NextResponse.json(
      { error: 'Failed to control scheduler' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/scheduler - Update scheduler configuration
 */
export async function PUT(request: NextRequest) {
  try {
    const newConfig = await request.json();
    const configManager = SchedulerConfigManager.getInstance();
    
    // Validate the new configuration
    const updatedConfig = await configManager.updateConfig(newConfig);
    
    logger.info('Scheduler configuration updated via API', { config: updatedConfig });
    
    return NextResponse.json({
      message: 'Configuration updated successfully',
      config: updatedConfig
    });
  } catch (error) {
    logger.error('Failed to update scheduler configuration', { error });
    return NextResponse.json(
      { error: 'Failed to update configuration' },
      { status: 500 }
    );
  }
}
