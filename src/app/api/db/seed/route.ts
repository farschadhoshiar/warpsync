import { NextResponse } from 'next/server';
import { DatabaseInitializer } from '@/lib/init-db';

export async function POST() {
  try {
    const result = await DatabaseInitializer.seedDevelopmentData();
    
    if (result.success) {
      return NextResponse.json({ 
        success: true, 
        message: result.message,
        data: result.data,
        timestamp: new Date().toISOString()
      });
    } else {
      return NextResponse.json({ 
        success: false, 
        message: result.message,
        data: result.data
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Database seeding error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Database seeding failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
