/**
 * Test minimal scan endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger } from '@/lib/logger/request';
import { Types } from 'mongoose';

export const POST = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const logger = await getRequestLogger();
  const { id } = await params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Testing minimal scan endpoint', { jobId: id });
  
  try {
    // Test database connection
    await connectDB();
    logger.info('Database connected');
    
    // Test models import
    const { SyncJob } = await import('@/models');
    logger.info('Models imported');
    
    // Test job lookup
    const syncJob = await SyncJob.findById(id).populate('serverProfileId');
    if (!syncJob) {
      return NextResponse.json({
        success: false,
        error: 'Sync job not found',
        timestamp: new Date().toISOString()
      }, { status: 404 });
    }
    
    logger.info('Found sync job', { jobName: syncJob.name });
    
    // Test FileScanner instantiation
    const { FileScanner } = await import('@/lib/scanner/file-scanner');
    const fileScanner = new FileScanner();
    logger.info('FileScanner created successfully');
    
    return NextResponse.json({
      success: true,
      data: {
        message: 'Minimal test successful',
        jobId: id,
        jobName: syncJob.name
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error: unknown) {
    logger.error('Minimal test failed', {
      jobId: id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return NextResponse.json({
      success: false,
      error: `Test failed: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});
