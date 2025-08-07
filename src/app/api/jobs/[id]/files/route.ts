/**
 * File State API Endpoints
 * Handles file state operations for sync jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { FileFilterSchema } from '@/lib/validation/schemas';
import { Types } from 'mongoose';

/**
 * GET /api/jobs/[jobId]/files
 * Retrieve file states for a sync job with filtering and pagination
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get-file-states');
  
  const { id: jobId } = await params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(jobId)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Fetching file states for sync job', { jobId });
  
  await connectDB();
  const { SyncJob, FileState } = await import('@/models');
  
  // Verify job exists
  const syncJob = await SyncJob.findById(jobId);
  if (!syncJob) {
    return NextResponse.json({
      success: false,
      error: 'Sync job not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  // Parse query parameters
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const sortBy = url.searchParams.get('sortBy') || 'relativePath';
  const sortOrder = url.searchParams.get('sortOrder') === 'asc' ? 1 : -1;
  
  // Parse filters
  const filterParams = Object.fromEntries(url.searchParams.entries());
  const validatedFilters = FileFilterSchema.parse(filterParams);
  
  // Build MongoDB filter
  const filter: any = { jobId };
  
  if (validatedFilters.syncState) {
    if (Array.isArray(validatedFilters.syncState)) {
      filter.syncState = { $in: validatedFilters.syncState };
    } else {
      filter.syncState = validatedFilters.syncState;
    }
  }
  
  if (validatedFilters.search) {
    filter.$or = [
      { filename: { $regex: validatedFilters.search, $options: 'i' } },
      { relativePath: { $regex: validatedFilters.search, $options: 'i' } }
    ];
  }
  
  if (validatedFilters.minSize !== undefined) {
    filter.$or = [
      { 'remote.size': { $gte: validatedFilters.minSize } },
      { 'local.size': { $gte: validatedFilters.minSize } }
    ];
  }
  
  if (validatedFilters.maxSize !== undefined) {
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { 'remote.size': { $lte: validatedFilters.maxSize } },
        { 'local.size': { $lte: validatedFilters.maxSize } }
      ]
    });
  }
  
  const skip = (page - 1) * limit;
  
  // Execute queries
  const [files, total, stateCounts] = await Promise.all([
    FileState.find(filter)
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean(),
    FileState.countDocuments(filter),
    FileState.aggregate([
      { $match: { jobId: new Types.ObjectId(jobId) } },
      { $group: { _id: '$syncState', count: { $sum: 1 } } }
    ])
  ]);
  
  const totalPages = Math.ceil(total / limit);
  
  // Format state counts
  const stateCountsMap = stateCounts.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {} as Record<string, number>);
  
    logger.info(`Retrieved ${files.length} file states`, {
    jobId,
    filesCount: files.length,
    duration: timer.end()
  });
  
  return NextResponse.json({
    success: true,
    data: files,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    },
    summary: {
      stateCounts: stateCountsMap,
      totalFiles: total
    },
    timestamp: new Date().toISOString()
  });
});
