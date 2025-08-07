// Central export point for all database models
import ServerProfile, { IServerProfile, IServerProfileModel } from './ServerProfile';
import SyncJob, { ISyncJob, ISyncJobModel } from './SyncJob';
import FileState, { IFileState, IFileStateModel } from './FileState';

// Export models
export {
  ServerProfile,
  SyncJob,
  FileState
};

// Export TypeScript interfaces
export type {
  IServerProfile,
  IServerProfileModel,
  ISyncJob,
  ISyncJobModel,
  IFileState,
  IFileStateModel
};

// Export utility types for creating new instances
export type CreateServerProfileInput = Omit<IServerProfile, '_id' | 'createdAt' | 'updatedAt' | keyof Document>;
export type CreateSyncJobInput = Omit<ISyncJob, '_id' | 'createdAt' | 'updatedAt' | 'isActive' | 'nextScanTime' | keyof Document>;
export type CreateFileStateInput = Omit<IFileState, '_id' | 'lastSeen' | 'addedAt' | keyof Document>;

// Utility function to initialize all models
export const initializeModels = async (): Promise<void> => {
  // Models are automatically registered when imported
  // This function can be used to ensure all models are loaded
  console.log('All models initialized:');
  console.log('- ServerProfile');
  console.log('- SyncJob');
  console.log('- FileState');
};

// Utility function to get model statistics
export const getModelStats = async () => {
  try {
    const serverProfileCount = await ServerProfile.countDocuments();
    const syncJobCount = await SyncJob.countDocuments();
    const fileStateCount = await FileState.countDocuments();
    
    return {
      serverProfiles: serverProfileCount,
      syncJobs: syncJobCount,
      fileStates: fileStateCount,
      totalDocuments: serverProfileCount + syncJobCount + fileStateCount
    };
  } catch (error) {
    console.error('Error getting model statistics:', error);
    throw error;
  }
};

// Utility function to validate model relationships
export const validateModelRelationships = async (): Promise<{ valid: boolean; errors: string[] }> => {
  const errors: string[] = [];
  
  try {
    // Check for orphaned sync jobs (referencing non-existent server profiles)
    const syncJobs = await SyncJob.find().populate('serverProfileId');
    for (const job of syncJobs) {
      if (!job.serverProfileId) {
        errors.push(`SyncJob ${job.name} (${job._id}) references non-existent server profile`);
      }
    }
    
    // Check for orphaned file states (referencing non-existent sync jobs)
    const fileStates = await FileState.find().populate('jobId');
    for (const fileState of fileStates) {
      if (!fileState.jobId) {
        errors.push(`FileState ${fileState.relativePath} (${fileState._id}) references non-existent sync job`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  } catch (error) {
    errors.push(`Error validating relationships: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      valid: false,
      errors
    };
  }
};

// Models collection
const models = {
  ServerProfile,
  SyncJob,
  FileState,
  initializeModels,
  getModelStats,
  validateModelRelationships
};

// Default export with all models
export default models;
