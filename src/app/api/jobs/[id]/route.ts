/**
 * Individual Sync Job API Endpoints
 * Handles operations for specific sync jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { SyncJobUpdateSchema } from '@/lib/validation/schemas';
import { Types } from 'mongoose';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * GET /api/jobs/[id]
 * Retrieve a specific sync job by ID
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get-sync-job');
  
  const { id } = params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Fetching sync job', { jobId: id });
  
  await connectDB();
  const { SyncJob } = await import('@/models');
  
  const syncJob = await SyncJob.findById(id)
    .populate('serverProfileId', 'name address port user authMethod')
    .lean();
  
  if (!syncJob) {
    logger.warn('Sync job not found', { jobId: id });
    return NextResponse.json({
      success: false,
      error: 'Sync job not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  logger.info('Sync job retrieved successfully', {
    jobId: id,
    duration: timer.end()
  });
  
  return NextResponse.json({
    success: true,
    data: syncJob,
    timestamp: new Date().toISOString()
  });
});

/**
 * PUT /api/jobs/[id]
 * Update a specific sync job
 */
export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'update-sync-job');
  
  const { id } = params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Updating sync job', { jobId: id });
  
  const body = await req.json();
  const validatedData = SyncJobUpdateSchema.parse(body);
  
  await connectDB();
  const { SyncJob, ServerProfile } = await import('@/models');
  
  // Check if job exists
  const existingJob = await SyncJob.findById(id);
  if (!existingJob) {
    return NextResponse.json({
      success: false,
      error: 'Sync job not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  // Verify server profile exists if being updated
  if (validatedData.serverProfileId) {
    const serverProfile = await ServerProfile.findById(validatedData.serverProfileId);
    if (!serverProfile) {
      return NextResponse.json({
        success: false,
        error: 'Server profile not found',
        timestamp: new Date().toISOString()
      }, { status: 404 });
    }
  }
  
  // Check for name conflicts if name is being updated
  if (validatedData.name && validatedData.name !== existingJob.name) {
    const nameConflict = await SyncJob.findOne({
      name: validatedData.name,
      _id: { $ne: id }
    });
    
    if (nameConflict) {
      return NextResponse.json({
        success: false,
        error: 'Sync job with this name already exists',
        timestamp: new Date().toISOString()
      }, { status: 409 });
    }
  }
  
  // Prepare update data
  const updateData = Object.keys(validatedData).reduce((acc, key) => {
    const value = (validatedData as any)[key];
    if (value !== undefined) {
      (acc as any)[key] = value;
    }
    return acc;
  }, {} as object);
  
  // Update sync job
  const updatedJob = await SyncJob.findByIdAndUpdate(
    id,
    { ...updateData, updatedAt: new Date() },
    { new: true, runValidators: true }
  ).populate('serverProfileId', 'name address port user authMethod') as any;
  
  logger.info('Sync job updated successfully', {
    jobId: id,
    updatedFields: Object.keys(updateData),
    duration: timer.end()
  });
  
  return NextResponse.json({
    success: true,
    data: updatedJob.toSafeObject(),
    timestamp: new Date().toISOString()
  });
});

/**
 * DELETE /api/jobs/[id]
 * Delete a specific sync job
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'delete-sync-job');
  
  const { id } = params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid job ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Deleting sync job', { jobId: id });
  
  await connectDB();
  const { SyncJob, FileState } = await import('@/models');
  
  // Check if job exists
  const syncJob = await SyncJob.findById(id);
  if (!syncJob) {
    return NextResponse.json({
      success: false,
      error: 'Sync job not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  // Delete associated file states
  const deletedFileStates = await FileState.deleteMany({ jobId: id });
  
  // Delete the sync job
  await SyncJob.findByIdAndDelete(id);
  
  logger.info('Sync job deleted successfully', {
    jobId: id,
    duration: timer.end()
  });  return NextResponse.json({
    success: true,
    message: 'Sync job deleted successfully',
    data: {
      deletedFileStates: deletedFileStates.deletedCount
    },
    timestamp: new Date().toISOString()
  });
});
