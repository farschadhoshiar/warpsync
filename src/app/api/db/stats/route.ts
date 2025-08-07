import { NextResponse } from 'next/server';
import { getModelStats } from '@/models';

export async function GET() {
  try {
    const stats = await getModelStats();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Database statistics retrieved successfully',
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database stats error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to retrieve database statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
