import connectDB from './mongodb';
import { ServerProfile, SyncJob, FileState, getModelStats, validateModelRelationships } from '../models';
import { Types } from 'mongoose';

// Database initialization utilities
export class DatabaseInitializer {
  
  /**
   * Initialize the database with indexes and validation
   */
  static async initializeDatabase(): Promise<{ success: boolean; message: string; errors?: string[] }> {
    try {
      console.log('🔄 Initializing database...');
      
      // Connect to database
      await connectDB();
      console.log('✅ Database connection established');
      
      // Ensure indexes are created
      await this.createIndexes();
      console.log('✅ Database indexes created');
      
      // Validate existing data relationships
      const validation = await validateModelRelationships();
      if (!validation.valid) {
        console.warn('⚠️ Found relationship validation issues:', validation.errors);
      }
      
      // Get current statistics
      const stats = await getModelStats();
      console.log('📊 Database statistics:', stats);
      
      return {
        success: true,
        message: 'Database initialized successfully',
        errors: validation.valid ? undefined : validation.errors
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Database initialization failed:', errorMessage);
      return {
        success: false,
        message: 'Database initialization failed',
        errors: [errorMessage]
      };
    }
  }
  
  /**
   * Create database indexes for performance
   */
  static async createIndexes(): Promise<void> {
    try {
      // ServerProfile indexes
      await ServerProfile.collection.createIndex({ name: 1 }, { unique: true });
      await ServerProfile.collection.createIndex({ address: 1, port: 1 });
      
      // SyncJob indexes
      await SyncJob.collection.createIndex({ name: 1 }, { unique: true });
      await SyncJob.collection.createIndex({ serverProfileId: 1 });
      await SyncJob.collection.createIndex({ enabled: 1 });
      await SyncJob.collection.createIndex({ lastScan: 1 });
      await SyncJob.collection.createIndex({ enabled: 1, lastScan: 1 });
      
      // FileState indexes
      await FileState.collection.createIndex({ jobId: 1, relativePath: 1 }, { unique: true });
      await FileState.collection.createIndex({ jobId: 1 });
      await FileState.collection.createIndex({ syncState: 1 });
      await FileState.collection.createIndex({ lastSeen: 1 });
      await FileState.collection.createIndex({ jobId: 1, syncState: 1 });
      await FileState.collection.createIndex({ syncState: 1, 'transfer.retryCount': 1 });
      
      console.log('✅ All database indexes created successfully');
    } catch (error) {
      console.error('❌ Error creating indexes:', error);
      throw error;
    }
  }
  
  /**
   * Seed the database with development data
   */
  static async seedDevelopmentData(): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      console.log('🌱 Seeding development data...');
      
      // Check if data already exists
      const stats = await getModelStats();
      if (stats.totalDocuments > 0) {
        return {
          success: true,
          message: 'Database already contains data, skipping seed',
          data: stats
        };
      }
      
      // Create sample server profile
      const sampleServerProfile = new ServerProfile({
        name: 'Development Server',
        address: '192.168.1.100',
        port: 22,
        user: 'ubuntu',
        authMethod: 'password',
        password: 'development123',
        deluge: {
          host: '192.168.1.100',
          port: 58846,
          username: 'deluge',
          password: 'deluge123'
        }
      });
      
      await sampleServerProfile.save();
      console.log('✅ Sample server profile created');
      
      // Create sample sync job
      const sampleSyncJob = new SyncJob({
        name: 'Development Sync',
        enabled: true,
        serverProfileId: sampleServerProfile._id,
        remotePath: '/home/ubuntu/downloads',
        localPath: '/app/data/local',
        chmod: '755',
        scanInterval: 30,
        autoQueue: {
          enabled: true,
          patterns: ['*.mkv', '*.mp4', '*.avi'],
          excludePatterns: ['*.tmp', '*.part']
        },
        delugeAction: {
          action: 'remove',
          delay: 15
        },
        parallelism: {
          maxConcurrentTransfers: 2,
          maxConnectionsPerTransfer: 3
        }
      });
      
      await sampleSyncJob.save();
      console.log('✅ Sample sync job created');
      
      // Create sample file states
      const sampleFiles = [
        {
          jobId: sampleSyncJob._id,
          relativePath: 'movies/sample-movie.mkv',
          filename: 'sample-movie.mkv',
          remote: {
            size: 1024 * 1024 * 1024 * 2, // 2GB
            modTime: new Date('2024-01-15T10:30:00Z'),
            exists: true
          },
          local: {
            exists: false
          },
          syncState: 'remote_only' as const
        },
        {
          jobId: sampleSyncJob._id,
          relativePath: 'tv-shows/series-s01e01.mp4',
          filename: 'series-s01e01.mp4',
          remote: {
            size: 1024 * 1024 * 500, // 500MB
            modTime: new Date('2024-01-16T14:20:00Z'),
            exists: true
          },
          local: {
            size: 1024 * 1024 * 500,
            modTime: new Date('2024-01-16T14:20:00Z'),
            exists: true
          },
          syncState: 'synced' as const
        },
        {
          jobId: sampleSyncJob._id,
          relativePath: 'documentaries/nature-doc.avi',
          filename: 'nature-doc.avi',
          remote: {
            size: 1024 * 1024 * 800, // 800MB
            modTime: new Date('2024-01-17T09:15:00Z'),
            exists: true
          },
          local: {
            exists: false
          },
          syncState: 'queued' as const
        }
      ];
      
      for (const fileData of sampleFiles) {
        const fileState = new FileState(fileData);
        await fileState.save();
      }
      console.log(`✅ Created ${sampleFiles.length} sample file states`);
      
      // Get final statistics
      const finalStats = await getModelStats();
      
      return {
        success: true,
        message: 'Development data seeded successfully',
        data: {
          seededServerProfiles: 1,
          seededSyncJobs: 1,
          seededFileStates: sampleFiles.length,
          ...finalStats
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Error seeding development data:', errorMessage);
      return {
        success: false,
        message: 'Failed to seed development data',
        data: { error: errorMessage }
      };
    }
  }
  
  /**
   * Test database connectivity and operations
   */
  static async validateConnection(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      console.log('🔍 Validating database connection...');
      
      // Test basic connection
      await connectDB();
      
      // Test model operations
      const testOperations = {
        serverProfileCount: await ServerProfile.countDocuments(),
        syncJobCount: await SyncJob.countDocuments(),
        fileStateCount: await FileState.countDocuments()
      };
      
      // Test model relationships
      const relationshipValidation = await validateModelRelationships();
      
      return {
        success: true,
        message: 'Database connection and operations validated successfully',
        details: {
          operations: testOperations,
          relationships: relationshipValidation
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Database validation failed:', errorMessage);
      return {
        success: false,
        message: 'Database validation failed',
        details: { error: errorMessage }
      };
    }
  }
  
  /**
   * Clean up old file state records
   */
  static async cleanupOldFiles(olderThanDays: number = 30): Promise<{ success: boolean; message: string; deletedCount?: number }> {
    try {
      console.log(`🧹 Cleaning up file states older than ${olderThanDays} days...`);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      // Delete old file states that are no longer relevant
      const deleteResult = await FileState.deleteMany({
        lastSeen: { $lt: cutoffDate },
        syncState: { $in: ['failed', 'synced'] } // Only cleanup failed or synced files
      });
      
      console.log(`✅ Cleaned up ${deleteResult.deletedCount} old file state records`);
      
      return {
        success: true,
        message: `Cleanup completed: ${deleteResult.deletedCount} records removed`,
        deletedCount: deleteResult.deletedCount
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Cleanup failed:', errorMessage);
      return {
        success: false,
        message: 'Cleanup failed',
        deletedCount: 0
      };
    }
  }
  
  /**
   * Reset database (WARNING: Deletes all data)
   */
  static async resetDatabase(): Promise<{ success: boolean; message: string }> {
    try {
      console.log('⚠️ Resetting database - deleting all data...');
      
      await connectDB();
      
      // Delete all documents
      await FileState.deleteMany({});
      await SyncJob.deleteMany({});
      await ServerProfile.deleteMany({});
      
      console.log('✅ Database reset completed');
      
      return {
        success: true,
        message: 'Database reset successfully - all data deleted'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Database reset failed:', errorMessage);
      return {
        success: false,
        message: 'Database reset failed'
      };
    }
  }
}

// Export individual functions for convenience
export const initializeDatabase = DatabaseInitializer.initializeDatabase;
export const seedDevelopmentData = DatabaseInitializer.seedDevelopmentData;
export const validateConnection = DatabaseInitializer.validateConnection;
export const cleanupOldFiles = DatabaseInitializer.cleanupOldFiles;
export const resetDatabase = DatabaseInitializer.resetDatabase;

// Default export
export default DatabaseInitializer;
