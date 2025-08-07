/**
 * Simple test to verify database operations work
 */

import connectDB from '../lib/mongodb';

async function testDatabase() {
  try {
    console.log('Testing database connection...');
    
    // Connect to database
    await connectDB();
    console.log('Database connected successfully');
    
    // Import models
    const { FileState, SyncJob } = await import('../models');
    console.log('Models imported successfully');
    
    // Find a sync job
    const syncJob = await SyncJob.findOne();
    if (!syncJob) {
      console.log('No sync jobs found - creating test data would be needed');
      return;
    }
    
    console.log('Found sync job:', syncJob.name);
    
    // Test FileState operations
    console.log('Testing FileState operations...');
    
    // Clear any existing test records
    await FileState.deleteMany({ jobId: syncJob._id });
    console.log('Cleared existing FileState records');
    
    // Create test FileState record
    const testFileState = {
      jobId: syncJob._id,
      relativePath: 'test/file.txt',
      filename: 'file.txt',
      remote: {
        size: 1024,
        modTime: new Date(),
        exists: true
      },
      local: {
        size: 0,
        modTime: new Date(),
        exists: false
      },
      syncState: 'remote_only',
      transfer: {
        progress: 0,
        retryCount: 0
      },
      lastSeen: new Date(),
      addedAt: new Date()
    };
    
    const savedFileState = await FileState.create(testFileState);
    console.log('Created test FileState record:', savedFileState._id);
    
    // Query it back
    const foundFileState = await FileState.findById(savedFileState._id);
    console.log('Retrieved FileState record:', foundFileState?.filename);
    
    // Clean up
    await FileState.deleteOne({ _id: savedFileState._id });
    console.log('Cleaned up test record');
    
    console.log('Database operations test completed successfully!');
    
  } catch (error) {
    console.error('Database test failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
  }
  
  process.exit(0);
}

testDatabase();
