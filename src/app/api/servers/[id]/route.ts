/**
 * Individual Server Profile API Endpoints
 * Handles operations for specific server profiles
 */

import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import { ServerProfileUpdateSchema } from '@/lib/validation/schemas';
import { Types } from 'mongoose';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * GET /api/servers/[id]
 * Retrieve a specific server profile by ID
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'get_server');
  
  const { id } = await params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid server ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Fetching server profile', { serverId: id });
  
  await connectDB();
  const { ServerProfile } = await import('@/models');
  
  const serverProfile = await ServerProfile.findById(id).lean();
  
  if (!serverProfile) {
    logger.warn('Server profile not found', { serverId: id });
    return NextResponse.json({
      success: false,
      error: 'Server profile not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  // Remove sensitive fields
  const { password, privateKey, ...safeProfile } = serverProfile as any;
  
  logger.info('Server profile retrieved successfully', {
    serverId: id,
    name: (serverProfile as any).name
  });
  
  timer.end({ serverId: id });
  
  return NextResponse.json({
    success: true,
    data: safeProfile,
    timestamp: new Date().toISOString()
  });
});

/**
 * PUT /api/servers/[id]
 * Update a specific server profile
 */
export const PUT = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'update_server');
  
  const { id } = await params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid server ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Updating server profile', { serverId: id });
  
  const body = await req.json();
  const validatedData = ServerProfileUpdateSchema.parse(body);
  
  await connectDB();
  const { ServerProfile } = await import('@/models');
  
  // Check if server exists
  const existingServer = await ServerProfile.findById(id);
  if (!existingServer) {
    return NextResponse.json({
      success: false,
      error: 'Server profile not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  // Check for name conflicts if name is being updated
  if (validatedData.name && validatedData.name !== existingServer.name) {
    const nameConflict = await ServerProfile.findOne({
      name: validatedData.name,
      _id: { $ne: id }
    });
    
    if (nameConflict) {
      return NextResponse.json({
        success: false,
        error: 'Server profile with this name already exists',
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
  
  // Update server profile
  const updatedServer = await ServerProfile.findByIdAndUpdate(
    id,
    { ...updateData, updatedAt: new Date() },
    { new: true, runValidators: true }
  ) as any;
  
  // Remove sensitive fields
  const { password, privateKey, ...safeProfile } = updatedServer.toObject();
  
  logger.info('Server profile updated successfully', {
    serverId: id,
    name: updatedServer.name,
    updatedFields: Object.keys(updateData)
  });
  
  timer.end({ serverId: id });
  
  return NextResponse.json({
    success: true,
    data: safeProfile,
    timestamp: new Date().toISOString()
  });
});

/**
 * DELETE /api/servers/[id]
 * Delete a specific server profile
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'delete_server');
  
  const { id } = await params;
  
  // Validate ObjectId
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      error: 'Invalid server ID format',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
  
  logger.info('Deleting server profile', { serverId: id });
  
  await connectDB();
  const { ServerProfile, SyncJob } = await import('@/models');
  
  // Check if server exists
  const serverProfile = await ServerProfile.findById(id);
  if (!serverProfile) {
    return NextResponse.json({
      success: false,
      error: 'Server profile not found',
      timestamp: new Date().toISOString()
    }, { status: 404 });
  }
  
  // Check for dependent sync jobs
  const dependentJobs = await SyncJob.countDocuments({ serverProfileId: id });
  if (dependentJobs > 0) {
    return NextResponse.json({
      success: false,
      error: `Cannot delete server profile. ${dependentJobs} sync job(s) are using this server profile.`,
      timestamp: new Date().toISOString()
    }, { status: 409 });
  }
  
  // Delete the server profile
  await ServerProfile.findByIdAndDelete(id);
  
  logger.info('Server profile deleted successfully', {
    serverId: id,
    name: serverProfile.name
  });
  
  timer.end({ serverId: id });
  
  return NextResponse.json({
    success: true,
    message: 'Server profile deleted successfully',
    timestamp: new Date().toISOString()
  });
});