/**
 * Migration script for existing SyncJob documents
 * Adds new fields to existing jobs with sensible defaults
 */

import connectDB from '@/lib/mongodb';

async function migrateSyncJobs() {
  try {
    await connectDB();
    const { SyncJob } = await import('@/models');
    
    console.log('Starting SyncJob migration...');
    
    // Find all jobs that don't have the new fields
    const jobsToMigrate = await SyncJob.find({
      $or: [
        { targetType: { $exists: false } },
        { syncOptions: { $exists: false } },
        { retrySettings: { $exists: false } }
      ]
    });
    
    console.log(`Found ${jobsToMigrate.length} jobs to migrate`);
    
    for (const job of jobsToMigrate) {
      const updates: Record<string, unknown> = {};
      
      // Set targetType based on localPath
      if (!job.targetType) {
        updates.targetType = job.localPath.startsWith('/data/local') ? 'local' : 'server';
      }
      
      // Add syncOptions with defaults
      if (!job.syncOptions) {
        updates.syncOptions = {
          direction: 'download',
          deleteExtraneous: false,
          preserveTimestamps: true,
          preservePermissions: true,
          compressTransfer: true,
          dryRun: false
        };
      }
      
      // Add retrySettings with defaults
      if (!job.retrySettings) {
        updates.retrySettings = {
          maxRetries: 3,
          retryDelay: 5000
        };
      }
      
      // Update the job
      await SyncJob.findByIdAndUpdate(job._id, { $set: updates });
      console.log(`Migrated job: ${job.name}`);
    }
    
    console.log('Migration completed successfully!');
    
    // Verify migration
    const totalJobs = await SyncJob.countDocuments();
    const migratedJobs = await SyncJob.countDocuments({
      targetType: { $exists: true },
      syncOptions: { $exists: true },
      retrySettings: { $exists: true }
    });
    
    console.log(`Total jobs: ${totalJobs}, Migrated jobs: ${migratedJobs}`);
    
    if (totalJobs === migratedJobs) {
      console.log('✅ All jobs successfully migrated!');
    } else {
      console.log('⚠️ Some jobs may not have been migrated properly');
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

export default migrateSyncJobs;
