import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';

export async function GET() {
  try {
    // Connect to database
    await connectDB();
    
    // Import models after connection is established
    const { ServerProfile, SyncJob, FileState } = await import('@/models');
    
    // Test basic operations
    const serverCount = await ServerProfile.countDocuments();
    const jobCount = await SyncJob.countDocuments();
    const fileCount = await FileState.countDocuments();
    
    return NextResponse.json({
      success: true,
      message: 'Models are working correctly',
      counts: {
        servers: serverCount,
        jobs: jobCount,
        files: fileCount
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Model test error:', error);
    return NextResponse.json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
