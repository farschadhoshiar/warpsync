/**
 * Migration API Endpoint
 * POST /api/db/migrate-sync-jobs
 */

import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors';
import migrateSyncJobs from '@/lib/migrations/migrate-sync-jobs';

/**
 * POST /api/db/migrate-sync-jobs
 * Run migration for SyncJob schema updates
 */
export const POST = withErrorHandler(async () => {
  try {
    await migrateSyncJobs();
    
    return NextResponse.json({
      success: true,
      message: 'SyncJob migration completed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Migration failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Migration failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});
