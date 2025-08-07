import { NextResponse } from 'next/server';
import { DatabaseInitializer } from '@/lib/init-db';

export async function POST() {
  try {
    const result = await DatabaseInitializer.initializeDatabase();
    
    if (result.success) {
      return NextResponse.json({ 
        success: true, 
        message: result.message,
        errors: result.errors,
        timestamp: new Date().toISOString()
      });
    } else {
      return NextResponse.json({ 
        success: false, 
        message: result.message,
        errors: result.errors
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Database initialization error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Database initialization failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await DatabaseInitializer.validateConnection();
    
    if (result.success) {
      return NextResponse.json({ 
        success: true, 
        message: result.message,
        details: result.details,
        timestamp: new Date().toISOString()
      });
    } else {
      return NextResponse.json({ 
        success: false, 
        message: result.message,
        details: result.details
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Database validation error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Database validation failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
