/**
 * FileState Debug API Endpoint
 * Provides debugging information about FileState records
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors';
import { getRequestLogger } from '@/lib/logger/request';
import connectDB from '@/lib/mongodb';
import { Types } from 'mongoose';

/**
 * GET /api/debug/filestates
 * Get FileState records for debugging
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const logger = await getRequestLogger();
  
  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId');
  const fileId = url.searchParams.get('fileId');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
  
  logger.info('FileState debug request', { jobId, fileId, limit });
  
  try {
    await connectDB();
    const { FileState } = await import('@/models');
    
    let results: any[] = [];
    let query: any = {};
    
    if (fileId) {
      // Look up specific file by ID
      if (Types.ObjectId.isValid(fileId)) {
        const fileState = await FileState.findById(fileId);
        results = fileState ? [fileState] : [];
        logger.info('FileState lookup by ID', { 
          fileId, 
          found: !!fileState,
          result: fileState ? {
            _id: fileState._id.toString(),
            filename: fileState.filename,
            relativePath: fileState.relativePath,
            isDirectory: fileState.isDirectory
          } : null
        });
      } else {
        logger.error('Invalid ObjectId format', { fileId });
        return NextResponse.json({
          success: false,
          error: 'Invalid file ID format',
          data: { fileId, isValidObjectId: false }
        }, { status: 400 });
      }
    } else {
      // General query
      if (jobId && Types.ObjectId.isValid(jobId)) {
        query.jobId = jobId;
      }
      
      results = await FileState.find(query)
        .limit(limit)
        .sort({ relativePath: 1 })
        .lean();
      
      logger.info('FileState query results', { 
        query, 
        resultCount: results.length,
        limit 
      });
    }
    
    // Format results for debugging
    const debugResults = results.map(fs => ({
      _id: fs._id.toString(),
      jobId: fs.jobId.toString(),
      filename: fs.filename,
      relativePath: fs.relativePath,
      isDirectory: fs.isDirectory,
      syncState: fs.syncState,
      remote: fs.remote,
      local: fs.local
    }));
    
    return NextResponse.json({
      success: true,
      data: {
        query,
        count: results.length,
        fileStates: debugResults
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('FileState debug request failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return NextResponse.json({
      success: false,
      error: 'Failed to get FileState debug information',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});
