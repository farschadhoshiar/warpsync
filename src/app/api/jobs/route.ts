/**
 * Sync Job API Endpoints
 * Handles CRUD operations for sync jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { SyncJobCreateSchema, SyncJobUpdateSchema, JobFilterSchema } from '@/lib/validation/schemas';

/**
 * GET /api/jobs
 * Retrieve sync jobs with optional filtering, pagination, and sorting
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get-sync-jobs');
  
  logger.info('Fetching sync jobs');
  
  await connectDB();
  const { SyncJob } = await import('@/models');
  
  // Parse query parameters
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 100);
  const sortBy = url.searchParams.get('sortBy') || 'createdAt';
  const sortOrder = url.searchParams.get('sortOrder') === 'asc' ? 1 : -1;
  
  // Parse filters
  const filterParams = Object.fromEntries(url.searchParams.entries());
  const validatedFilters = JobFilterSchema.parse(filterParams);
  
  // Build MongoDB filter
  const filter: any = {};
  if (validatedFilters.enabled !== undefined) {
    filter.enabled = validatedFilters.enabled;
  }
  if (validatedFilters.serverProfileId) {
    filter.serverProfileId = validatedFilters.serverProfileId;
  }
  if (validatedFilters.search) {
    filter.$or = [
      { name: { $regex: validatedFilters.search, $options: 'i' } },
      { remotePath: { $regex: validatedFilters.search, $options: 'i' } },
      { localPath: { $regex: validatedFilters.search, $options: 'i' } }
    ];
  }
  
  const skip = (page - 1) * limit;
  
  // Execute queries
  const [jobs, total] = await Promise.all([
    SyncJob.find(filter)
      .populate('serverProfileId', 'name address port')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean(),
    SyncJob.countDocuments(filter)
  ]);
  
  const totalPages = Math.ceil(total / limit);
  
    logger.info(`Retrieved ${jobs.length} sync jobs`, {
    jobsCount: jobs.length,
    duration: timer.end()
  });
  
  return NextResponse.json({
    success: true,
    data: jobs,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/jobs
 * Create a new sync job
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'create-sync-job');
  
  logger.info('Creating new sync job');
  
  const body = await req.json();
  const validatedData = SyncJobCreateSchema.parse(body);
  
  await connectDB();
  const { SyncJob, ServerProfile } = await import('@/models');
  
  // Verify server profile exists
  const serverProfile = await ServerProfile.findById(validatedData.serverProfileId);
  if (!serverProfile) {
    return NextResponse.json({
      success: false,
      error: 'Server profile not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  // Check for duplicate job name or path combination
  const existingJob = await SyncJob.findOne({
    $or: [
      { name: validatedData.name },
      { 
        serverProfileId: validatedData.serverProfileId,
        remotePath: validatedData.remotePath,
        localPath: validatedData.localPath
      }
    ]
  });
  
  if (existingJob) {
    return NextResponse.json({
      success: false,
      error: 'Sync job with this name or path combination already exists',
      timestamp: new Date().toISOString()
    }, { status: 409 });
  }
  
  // Create sync job
  const syncJob = new SyncJob(validatedData);
  await syncJob.save();
  
  // Populate server profile for response
  await syncJob.populate('serverProfileId', 'name address port');
  
  logger.info('Sync job created successfully', {
    jobId: syncJob._id,
    duration: timer.end()
  });
  
  return NextResponse.json({
    success: true,
    data: (syncJob as any).toSafeObject(),
    timestamp: new Date().toISOString()
  }, { status: 201 });
});
