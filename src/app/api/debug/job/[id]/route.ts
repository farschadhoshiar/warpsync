/**
 * Debug API Endpoint for SyncJob investigation
 */

import { NextRequest } from 'next/server';
import { withErrorHandler, createSuccessResponse } from '@/lib/errors';
import { getRequestLogger, PerformanceTimer } from '@/lib/logger/request';
import connectDB from '@/lib/mongodb';

/**
 * GET /api/debug/job/[id]
 * Debug job and server profile data
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const logger = await getRequestLogger();
  const timer = new PerformanceTimer(logger, 'debug_job');
  
  const { id: jobId } = await params;
  
  logger.info('Debugging job', { jobId });
  
  try {
    await connectDB();
    const { SyncJob } = await import('@/models');
    
    // Get job without population first
    const jobRaw = await SyncJob.findById(jobId);
    logger.info('Raw job data', {
      found: !!jobRaw,
      serverProfileId: jobRaw?.serverProfileId,
      serverProfileIdType: typeof jobRaw?.serverProfileId
    });
    
    // Get job with population
    const jobPopulated = await SyncJob.findById(jobId).populate('serverProfileId');
    logger.info('Populated job data', {
      found: !!jobPopulated,
      hasServerProfileId: !!jobPopulated?.serverProfileId,
      serverProfileIdType: typeof jobPopulated?.serverProfileId,
      serverProfileKeys: jobPopulated?.serverProfileId ? Object.keys(jobPopulated.serverProfileId) : [],
      serverProfile: jobPopulated?.serverProfileId
    });
    
    // Also try to get the server profile directly
    if (jobRaw?.serverProfileId) {
      const { ServerProfile } = await import('@/models');
      const serverProfile = await ServerProfile.findById(jobRaw.serverProfileId);
      logger.info('Direct server profile lookup', {
        found: !!serverProfile,
        address: serverProfile?.address,
        user: serverProfile?.user,
        serverProfileData: serverProfile
      });
    }
    
    return createSuccessResponse({
      jobRaw: {
        id: jobRaw?._id,
        name: jobRaw?.name,
        serverProfileId: jobRaw?.serverProfileId
      },
      jobPopulated: {
        id: jobPopulated?._id,
        name: jobPopulated?.name,
        serverProfileId: jobPopulated?.serverProfileId,
        serverProfileKeys: jobPopulated?.serverProfileId ? Object.keys(jobPopulated.serverProfileId) : []
      },
      debug: {
        hasRawJob: !!jobRaw,
        hasPopulatedJob: !!jobPopulated,
        hasServerProfile: !!(jobPopulated?.serverProfileId)
      }
    });
    
  } catch (error) {
    timer.endWithError(error);
    throw error;
  }
});
